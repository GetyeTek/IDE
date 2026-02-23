import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const contentType = req.headers.get('content-type') || '';

    // 1. Handle JSON Pings (Status Check)
    if (contentType.includes('application/json')) {
      const { type, uid } = await req.json();
      return new Response(JSON.stringify({ status: "online", uid }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    // 2. Handle Binary Bursts (Chat/Image Data)
    const arrayBuffer = await req.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);

    if (data.length < 1) {
      throw new Error("Empty payload");
    }

    // Byte 0 is the User ID, the rest is the message/image data
    const uid = data[0];
    const payload = data.slice(1);
    
    // Distribution Logic: Split the payload across the 6 data lanes
    const lanes = ['path_a', 'path_b', 'path_c', 'path_d', 'path_e', 'path_f'];
    
    // Create batches for each lane to optimize database inserts
    const inserts = lanes.map((lane, index) => {
      const laneData = [];
      for (let i = 0; i < payload.length; i++) {
        // Distribute bytes based on index (Round Robin)
        if (i % 6 === index) {
          laneData.push({ b: payload[i] });
        }
      }
      
      if (laneData.length > 0) {
        return supabase.from(lane).insert(laneData);
      }
      return Promise.resolve();
    });

    await Promise.all(inserts);

    return new Response(JSON.stringify({ success: true, rx: payload.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
})