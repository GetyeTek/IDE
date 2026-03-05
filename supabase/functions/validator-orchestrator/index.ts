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
      const { data: files } = await supabase.storage.from('inspection_bucket').list();
      if (files && files.length > 0) {
        const filePaths = files.map(f => ({ file_path: f.name, status: 'pending' }));
        await supabase.from('validation_tracking').upsert(filePaths, { onConflict: 'file_path' });
      }
    }

    // 2. ATOMIC CLAIM: Find oldest pending file and mark as processing in one move
    // We use a subquery/RPC approach or a strictly ordered update
    const { data: claim, error: claimErr } = await supabase
      .from('validation_tracking')
      .update({
        status: 'processing', 
        worker_id, 
        updated_at: new Date().toISOString()
      })
      .match({ status: 'pending' })
      .order('file_path', { ascending: true }) // Ensures sequential processing
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

  // ACTION: FAIL_WORK (The crucial addition for retries)
  if (action === 'fail_work') {
    console.error(`Worker ${worker_id} reported failure on ${file_path}: ${error}`);
    await supabase.from('validation_tracking')
      .update({
        status: 'pending', // Put back in queue
        worker_id: null,
        updated_at: new Date().toISOString()
      })
      .eq('file_path', file_path);
    return new Response(JSON.stringify({ status: 'requeued' }));
  }

  return new Response('Invalid Action', { status: 400 });
});