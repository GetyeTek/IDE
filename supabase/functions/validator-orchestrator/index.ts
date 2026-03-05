import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

Deno.serve(async (req) => {
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  
  // Handle CORS if necessary
  if (req.method === 'OPTIONS') return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } });

  const { action, file_path, worker_id, error } = await req.json();

  // ACTION: GET_WORK
  if (action === 'get_work') {
    // 1. Check if we need to sync files (Only if queue is empty to save performance)
    const { count } = await supabase.from('validation_tracking').select('*', { count: 'exact', head: true }).eq('status', 'pending');
    
    if (!count || count === 0) {
      console.log('Queue empty. Attempting to sync from inspection_bucket...');
      // List more files (limit 1000) and ignore folders (objects without metadata)
      const { data: files, error: listErr } = await supabase.storage
        .from('inspection_bucket')
        .list('', { limit: 1000 });

      if (listErr) {
        console.error('Storage List Error:', listErr);
        return new Response(JSON.stringify({ error: 'STORAGE_LIST_FAILED', details: listErr }), { status: 500 });
      }

      if (files && files.length > 0) {
        // Filter out folders (placeholders) and only take actual files
        const filePaths = files
          .filter(f => f.metadata) 
          .map(f => ({ file_path: f.name, status: 'pending' }));

        console.log(`Found ${filePaths.length} valid files. Syncing to tracking table...`);
        
        const { error: upsertErr } = await supabase.from('validation_tracking').upsert(filePaths, { onConflict: 'file_path' });
        if (upsertErr) console.error('Upsert Error:', upsertErr);
      } else {
        console.warn('Inspection bucket appears to be empty or inaccessible.');
      }
    }

    // 2. RECOVER ZOMBIES: Unstick files processing for > 10 mins
    const tenMinsAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    await supabase.from('validation_tracking')
      .update({ status: 'pending', worker_id: null })
      .eq('status', 'processing')
      .lt('updated_at', tenMinsAgo);

    // 3. ATOMIC CLAIM: Find oldest pending file
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
      .select()
      .single();

    if (claimErr || !claim) return new Response(JSON.stringify({ error: 'NO_WORK' }));

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

    return new Response(JSON.stringify({
      file_path: claim.file_path,
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