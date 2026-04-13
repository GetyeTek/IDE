import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS for browser-based debugging/calls
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Detect GZIP (The Android app uses GZIP for large uploads)
    const isGzip = req.headers.get('content-encoding') === 'gzip'
    let body;

    if (isGzip) {
      // Decompress stream
      const decompressedStream = req.body?.pipeThrough(new DecompressionStream("gzip"));
      const text = await new Response(decompressedStream).text();
      body = JSON.parse(text);
    } else {
      body = await req.json();
    }

    const { action, deviceId, payload } = body;

    if (!action || !deviceId) {
      return new Response(JSON.stringify({ error: "Missing action or deviceId" }), { status: 400 });
    }

    let result;
    let error;

    switch (action) {
      // 1. Upload Device Stats (replaces CloudManager & HealthWorker)
      case "upload_stats":
        ({ data: result, error } = await supabase
          .from('device_stats')
          .insert({ ...payload, device_id: deviceId }));
        break;

      // 2. Fetch Pending Commands (replaces CommandProcessor GET)
      case "get_commands":
        ({ data: result, error } = await supabase
          .from('file_commands')
          .select('*')
          .eq('device_id', deviceId)
          .eq('status', 'PENDING'));
        break;

      // 3. Update Command Status (replaces CommandProcessor PATCH)
      case "update_command":
        ({ data: result, error } = await supabase
          .from('file_commands')
          .update({ status: payload.status, error_log: payload.errorMsg })
          .eq('id', payload.id)
          .eq('device_id', deviceId));
        break;

      // 4. Fetch Config (replaces ConfigSyncWorker)
      case "get_config":
        ({ data: result, error } = await supabase
          .from('device_config')
          .select('config_json')
          .eq('device_id', deviceId)
          .maybeSingle());
        break;

      // 5. Fetch Rules (replaces RuleSyncWorker)
      case "get_rules":
        ({ data: result, error } = await supabase
          .from('monitoring_rules')
          .select('*'));
        break;

      // 6. Beacon/Ping (replaces CloudManager.sendPing)
      case "ping":
        ({ data: result, error } = await supabase
          .from('device_stats')
          .insert({ 
            device_id: deviceId, 
            trigger: "BEACON", 
            note: payload.note,
            summary_stats: { status: "ONLINE" } 
          }));
        break;

      // 7. Upload File Skeleton (replaces storage backup)
      case "upload_skeleton":
        ({ data: result, error } = await supabase
          .from('storage_backups')
          .insert({ ...payload, device_id: device_id }));
        break;

      // 8. Send Command (Trigger actions from external scripts/UI)
      case "send_command":
        ({ data: result, error } = await supabase
          .from('file_commands')
          .insert({
            device_id: deviceId,
            file_name: payload.command,
            content: payload.content || "",
            status: "PENDING"
          }));
        break;

      default:
        return new Response(JSON.stringify({ error: "Invalid action" }), { status: 400 });
    }

    if (error) throw error;

    return new Response(JSON.stringify({ success: true, data: result }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (err) {
    console.error("Gateway Error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})