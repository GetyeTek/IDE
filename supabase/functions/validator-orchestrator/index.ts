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

    // 1. Check if we need to sync files
    const { count, error: countErr } = await supabase.from('validation_tracking').select('*', { count: 'exact', head: true }).eq('status', 'pending');
    if (countErr) console.error('[DEBUG_SYNC] Count query failed:', countErr);
    console.log(`[DEBUG_SYNC] Pending count reported as: ${count}`);
    
    if (count === 0 || count === null) {
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

    // 2. RECOVER ZOMBIES: Unstick files processing for > 10 mins
    const tenMinsAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    await supabase.from('validation_tracking')
      .update({ status: 'pending', worker_id: null })
      .eq('status', 'processing')
      .lt('updated_at', tenMinsAgo);

    // 3. ATOMIC CLAIM: Find oldest pending file
    console.log('[CLAIM_START] Attempting to claim 1 pending row...');
    
    // Detailed Step: Let's see exactly what the oldest pending file is BEFORE updating
    const { data: peek } = await supabase.from('validation_tracking').select('file_path, status').eq('status', 'pending').order('file_path', { ascending: true }).limit(1);
    console.log('[CLAIM_PEEK] Oldest pending row found by SELECT:', peek ? JSON.stringify(peek) : 'NONE');

    const { data: claim, error: claimErr } = await supabase
      .from('validation_tracking')
      .update({
        status: 'processing', 
        worker_id, 
        updated_at: new Date().toISOString()
      })
      .match({ status: 'pending' })
      .order('file_path', { ascending: true })
      .limit(1)
      .select(); // Removed .single() to see the raw array result first

    if (claimErr) {
      console.error('[CLAIM_ERR] Update query failed:', claimErr);
    }

    if (!claim || claim.length === 0) {
      console.warn('[CLAIM_FAIL] No rows were updated. This usually means RLS blocked the update OR the status was changed by another worker millisecond ago.');
      return new Response(JSON.stringify({ 
        error: 'NO_WORK', 
        debug_info: { 
          peek_result: peek, 
          claim_result: claim,
          claim_error: claimErr
        } 
      }));
    }

    const claimData = claim[0];
    console.log('[CLAIM_SUCCESS] Claimed file:', claimData.file_path);

    // 3. Get API Key
    const { data: key, error: keyErr } = await supabase.from('api_keys')
      .select('*')
      .eq('service', 'gemini')
      .eq('is_active', true)
      .or(`cooldown_until.is.null,cooldown_until.lt.${new Date().toISOString()}`)
      .order('last_used_at', { ascending: true, nullsFirst: true })
      .limit(1)
      .single();

    if (keyErr || !key) return new Response(JSON.stringify({ error: 'NO_API_KEY' }), { status: 404 });

    console.log('[WORK_READY] Dispatching work to worker.');
    return new Response(JSON.stringify({
      file_path: claimData.file_path,
      api_key: key.api_key,
      key_id: key.id
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