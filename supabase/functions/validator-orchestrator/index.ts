import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

Deno.serve(async (req) => {
  const reqId = Math.random().toString(36).substring(7);
  console.log(`[ORCHESTRATOR][${reqId}] Received ${req.method} request at ${new Date().toISOString()}`);

  if (req.method === 'OPTIONS') {
    console.log(`[ORCHESTRATOR][${reqId}] Returning CORS OK`);
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } });
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  try {
    const body = await req.json();
    const { action, file_path, worker_id, error } = body;
    console.log(`[ORCHESTRATOR][${reqId}][${worker_id || 'UNKNOWN'}] Action triggered: ${action} | Target File: ${file_path || 'N/A'}`);

    // ==========================================
    // ACTION: GET_WORK
    // ==========================================
    if (action === 'get_work') {
      console.log(`[ORCHESTRATOR][${reqId}] Starting GET_WORK process for ${worker_id}...`);

      // 1. Sync Logic (Only run if table is strictly empty)
      const { count: totalCount, error: countErr } = await supabase.from('validation_tracking').select('*', { count: 'exact', head: true });
      console.log(`[ORCHESTRATOR][${reqId}] Tracking Table Count: ${totalCount} | Count Error: ${countErr ? JSON.stringify(countErr) : 'None'}`);

      if (countErr) {
        console.error(`[ORCHESTRATOR][${reqId}][FATAL] Aborting sync to prevent lock-wiping due to count error:`, countErr);
      } else if (totalCount === 0) {
        console.log(`[ORCHESTRATOR][${reqId}] Table is empty. Initiating sync from inspection_bucket...`);
        const { data: files, error: listErr } = await supabase.storage.from('inspection_bucket').list('', { limit: 1000 });
        
        if (listErr) {
          console.error(`[ORCHESTRATOR][${reqId}][ERROR] Storage list failed:`, listErr);
          return new Response(JSON.stringify({ error: 'STORAGE_LIST_FAILED', details: listErr }), { status: 500 });
        }

        const filePaths = (files ||[])
          .filter(f => f.name !== '.emptyFolderPlaceholder' && f.id !== null)
          .map(f => ({
            file_path: f.name,
            status: 'pending',
            updated_at: new Date().toISOString()
          }));

        console.log(`[ORCHESTRATOR][${reqId}] Found ${filePaths.length} valid files in storage to sync.`);

        if (filePaths.length > 0) {
          // CRITICAL FIX: ignoreDuplicates: true prevents overwriting locked files if a race condition occurs
          console.log(`[ORCHESTRATOR][${reqId}] Upserting files into tracking table...`);
          const { error: upsertErr } = await supabase.from('validation_tracking').upsert(filePaths, { onConflict: 'file_path', ignoreDuplicates: true });
          if (upsertErr) {
            console.error(`[ORCHESTRATOR][${reqId}][ERROR] Sync Upsert failed:`, upsertErr);
          } else {
            console.log(`[ORCHESTRATOR][${reqId}] Sync complete.`);
          }
        }
      } else {
        console.log(`[ORCHESTRATOR][${reqId}] Sync skipped. Existing queue size: ${totalCount}`);
      }

      // 2. Claim RPC
      console.log(`[ORCHESTRATOR][${reqId}] Executing claim_validation_batch RPC...`);
      const { data: rpcData, error: rpcErr } = await supabase.rpc('claim_validation_batch', { worker_id_param: worker_id });

      if (rpcErr) {
        console.error(`[ORCHESTRATOR][${reqId}][ERROR] RPC Exception:`, rpcErr);
        return new Response(JSON.stringify({ error: 'RPC_ERROR', details: rpcErr }), { status: 500 });
      }

      if (!rpcData || rpcData.length === 0) {
        console.warn(`[ORCHESTRATOR][${reqId}] RPC returned no available work/keys.`);
        return new Response(JSON.stringify({ error: 'NO_WORK', message: 'Queue empty or all keys on cooldown' }));
      }

      const work = rpcData[0];
      console.log(`[ORCHESTRATOR][${reqId}] SUCCESS! Assigned File: [${work.file_path_out}] | Key ID:[${work.key_id_out}] to ${worker_id}`);
      return new Response(JSON.stringify({
        file_path: work.file_path_out,
        api_key: work.api_key_out,
        key_id: work.key_id_out
      }));
    }

    // ==========================================
    // ACTION: MARK_DONE
    // ==========================================
    if (action === 'mark_done') {
      console.log(`[ORCHESTRATOR][${reqId}] Marking ${file_path} as completed...`);
      const { error: updateErr } = await supabase.from('validation_tracking')
        .update({ status: 'completed', updated_at: new Date().toISOString() })
        .eq('file_path', file_path);
      
      if (updateErr) console.error(`[ORCHESTRATOR][${reqId}][ERROR] Failed to mark completed:`, updateErr);
      else console.log(`[ORCHESTRATOR][${reqId}] Successfully marked ${file_path} as completed.`);
      
      return new Response(JSON.stringify({ status: 'ok' }));
    }

    // ==========================================
    // ACTION: FAIL_WORK
    // ==========================================
    if (action === 'fail_work') {
      console.log(`[ORCHESTRATOR][${reqId}] Processing FAILURE for ${file_path}. Error provided: ${error}`);
      const { data: current, error: getErr } = await supabase.from('validation_tracking')
        .select('retry_count')
        .eq('file_path', file_path)
        .single();
      
      if (getErr) console.error(`[ORCHESTRATOR][${reqId}][ERROR] Could not fetch retry count:`, getErr);

      const newRetryCount = (current?.retry_count || 0) + 1;
      const shouldGiveUp = newRetryCount >= 5;

      console.log(`[ORCHESTRATOR][${reqId}] File ${file_path} is on retry ${newRetryCount}/5. Should Give Up: ${shouldGiveUp}`);

      const { error: updateErr } = await supabase.from('validation_tracking')
        .update({
          status: shouldGiveUp ? 'failed_permanently' : 'pending',
          worker_id: null,
          retry_count: newRetryCount,
          last_error: error || 'Unknown Error',
          updated_at: new Date().toISOString()
        })
        .eq('file_path', file_path);

      if (updateErr) console.error(`[ORCHESTRATOR][${reqId}][ERROR] Failed to update failed status:`, updateErr);
      console.log(`[ORCHESTRATOR][${reqId}] Failure processed. Action: ${shouldGiveUp ? 'ABANDONED' : 'REQUEUED'}`);
      
      return new Response(JSON.stringify({ status: shouldGiveUp ? 'abandoned' : 'requeued', retry_count: newRetryCount }));
    }

    console.warn(`[ORCHESTRATOR][${reqId}] Unrecognized action received: ${action}`);
    return new Response('Invalid Action', { status: 400 });

  } catch (err) {
    console.error(`[ORCHESTRATOR][${reqId}][FATAL] Top-level error:`, err);
    return new Response(JSON.stringify({ error: 'INTERNAL_SERVER_ERROR', message: err.message }), { status: 500 });
  }
});
