import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // 1. Handle CORS Preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { action, payload, uid } = await req.json()
    const paths = ['path_a', 'path_b', 'path_c']

    // --- ACTION: DISPATCH (SEND) ---
    if (action === 'dispatch') {
      const target = paths[Math.floor(Math.random() * paths.length)]
      const rows = payload.map((b: number) => ({ b, u: uid }))
      
      const { error } = await supabase.from(target).insert(rows)
      if (error) throw error

      return new Response(JSON.stringify({ status: 'relayed' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    // --- ACTION: SIP (RECEIVE & BURN) ---
    if (action === 'sip') {
      let allBytes: any[] = []

      for (const p of paths) {
        const { data, error } = await supabase.from(p).select('*').limit(100)
        if (error) continue
        
        if (data && data.length > 0) {
          allBytes.push(...data)
          // Burn after reading
          const ids = data.map(d => d.id)
          await supabase.from(p).delete().in('id', ids)
        }
      }

      // Sort by global sequence (id) to maintain message integrity
      allBytes.sort((a, b) => a.id - b.id)

      return new Response(JSON.stringify({ data: allBytes }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})