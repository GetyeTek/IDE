import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

Deno.serve(async (req) => {
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  
  // Handle CORS if necessary
  if (req.method === 'OPTIONS') return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } });

  const body = await req.json();
  const { action, file_path, worker_id, error } = body;
  console.log(`[REQUEST] Action: ${action} | Worker: ${worker_id} | Timestamp: ${new Date().toISOString()}`);

  // ACTION: GET_WORK
  if (action === 'get_work') {
    // DEBUG: Comprehensive Table Status Check
    const { data: stats, error: statsErr } = await supabase.from('validation_tracking').select('status');
    if (statsErr) {
      console.error('[DEBUG_DB] Could not even select from table:', statsErr);
    } else {
      const counts = stats.reduce((acc: any, row: any) => {
        acc[row.status] = (acc[row.status] || 0) + 1;
        return acc;
      }, {});
      console.log('[DEBUG_DB] Current Table State (All Rows):', JSON.stringify(counts));
    }

    // 1. Check if we need to sync files (Only if table is TOTALLY empty to avoid collision loops)
    const { count: totalCount, error: countErr } = await supabase.from('validation_tracking').select('*', { count: 'exact', head: true });
    if (countErr) console.error('[DEBUG_SYNC] Count query failed:', countErr);
    console.log(`[DEBUG_SYNC] Total files in tracking table: ${totalCount}`);
    
    if (totalCount === 0 || totalCount === null) {
      console.log('[SYNC] Queue empty. Fetching from inspection_bucket...');
      const { data: files, error: listErr } = await supabase.storage
        .from('inspection_bucket')
        .list('', { limit: 1000 });
      
      if (files) console.log(`[SYNC] Raw Storage objects found: ${files.length}. Names: ${files.map(f => f.name).join(', ')}`);

      if (listErr) {
        console.error('[SYNC_ERR] Storage List:', listErr);
        return new Response(JSON.stringify({ error: 'STORAGE_LIST_FAILED', details: listErr }), { status: 500 });
      }

      console.log(`[SYNC] Storage returned ${files?.length || 0} total items.`);

      if (files && files.length > 0) {
        const filePaths = files
          .filter(f => f.name !== '.emptyFolderPlaceholder' && f.id !== null)
          .map(f => ({
            file_path: f.name,
            status: 'pending',
            updated_at: new Date().toISOString()
          }));

        console.log(`[SYNC] Filtered down to ${filePaths.length} valid files.`);
        
        if (filePaths.length > 0) {
          const { error: upsertErr } = await supabase.from('validation_tracking').upsert(filePaths, { onConflict: 'file_path' });
          if (upsertErr) {
             console.error('[SYNC_ERR] Upsert failed:', upsertErr);
          } else {
             console.log('[SYNC] Successfully populated validation_tracking.');
          }
        }
      } else {
        console.warn('[SYNC] Bucket is empty.');
      }
    }

    // 2. ATOMIC RPC CLAIM
    // This one call handles Zombie Recovery, Collision-Free Claiming, and Key Selection
    console.log('[CLAIM_START] Calling claim_validation_batch RPC...');
    const { data: rpcData, error: rpcErr } = await supabase.rpc('claim_validation_batch', { worker_id_param: worker_id });

    if (rpcErr || !rpcData || rpcData.length === 0) {
      console.warn('[CLAIM_FAIL] RPC returned no work. Error:', rpcErr);
      return new Response(JSON.stringify({ 
        error: 'NO_WORK', 
        debug: rpcErr || 'Queue empty or all keys on cooldown'
      }));
    }

    const work = rpcData[0];
    console.log(`[CLAIM_SUCCESS] Worker ${worker_id} claimed ${work.file_path_out}`);

    return new Response(JSON.stringify({
      file_path: work.file_path_out,
      api_key: work.api_key_out,
      key_id: work.key_id_out
    }));
  }

  // ACTION: MARK_DONE
  if (action === 'mark_done') {
    await supabase.from('validation_tracking')
      .update({ status: 'completed', updated_at: new Date().toISOString() })
      .eq('file_path', file_path);
    return new Response(JSON.stringify({ status: 'ok' }));
  }

  // ACTION: FAIL_WORK
  if (action === 'fail_work') {
    // Get current retry count
    const { data: current } = await supabase.from('validation_tracking')
      .select('retry_count')
      .eq('file_path', file_path)
      .single();
    
    const newRetryCount = (current?.retry_count || 0) + 1;
    const shouldGiveUp = newRetryCount >= 5;

    await supabase.from('validation_tracking')
      .update({
        status: shouldGiveUp ? 'failed_permanently' : 'pending',
        worker_id: null,
        retry_count: newRetryCount,
        last_error: error || 'Unknown Error',
        updated_at: new Date().toISOString()
      })
      .eq('file_path', file_path);

    return new Response(JSON.stringify({ status: shouldGiveUp ? 'abandoned' : 'requeued', retry_count: newRetryCount }));
  }

  return new Response('Invalid Action', { status: 400 });
});