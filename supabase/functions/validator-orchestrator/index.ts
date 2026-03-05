import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

Deno.serve(async (req) => {
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { action, file_path, worker_id } = await req.json();

  if (action === 'get_work') {
    // 1. Sync bucket files to tracking table if not exists
    const { data: files } = await supabase.storage.from('inspection_bucket').list();
    if (files) {
      const filePaths = files.map(f => ({ file_path: f.name }));
      await supabase.from('validation_tracking').upsert(filePaths, { onConflict: 'file_path' });
    }

    // 2. Claim a file
    const { data: claim } = await supabase.from('validation_tracking')
      .select('file_path').eq('status', 'pending').limit(1).single();

    if (!claim) return new Response(JSON.stringify({ error: 'NO_WORK' }));

    await supabase.from('validation_tracking').update({ status: 'processing', worker_id, updated_at: new Date().toISOString() }).eq('file_path', claim.file_path);

    // 3. Get API Key (Strictly Gemini)
    const { data: key, error: keyErr } = await supabase.from('api_keys')
      .select('*')
      .eq('service', 'gemini')
      .eq('is_active', true)
      .order('last_used_at', { ascending: true })
      .limit(1)
      .single();

    if (keyErr || !key) return new Response(JSON.stringify({ error: 'NO_API_KEY' }), { status: 404 });

    return new Response(JSON.stringify({ file_path: claim.file_path, api_key: key.api_key, key_id: key.id }));
  }

  if (action === 'mark_done') {
    await supabase.from('validation_tracking').update({ status: 'completed' }).eq('file_path', file_path);
    return new Response(JSON.stringify({ status: 'ok' }));
  }

  return new Response('Invalid Action', { status: 400 });
});