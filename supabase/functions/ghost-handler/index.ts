import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { action, payload, uid } = await req.json()
    const paths = ['path_a', 'path_b', 'path_c']

    if (action === 'dispatch') {
      // ARCHITECTURE FIX: Keep the whole batch in ONE random table to preserve ID sequence
      const target = paths[Math.floor(Math.random() * paths.length)]
      const rows = payload.map((b: number) => ({ b, u: uid }))
      
      const { error } = await supabase.from(target).insert(rows)
      if (error) throw error

      return new Response(JSON.stringify({ status: 'relayed', path: target }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (action === 'sip') {
      let allBytes: any[] = []

      for (const p of paths) {
        // Select including created_at for global sorting
        const { data, error } = await supabase.from(p).select('id, b, u, created_at').limit(200)
        if (error || !data) continue
        
        if (data.length > 0) {
          allBytes.push(...data)
          await supabase.from(p).delete().in('id', data.map(d => d.id))
        }
      }

      // SORTING LOGIC: Sort by time first, then by the table's internal ID
      allBytes.sort((a, b) => {
        const timeA = new Date(a.created_at).getTime()
        const timeB = new Date(b.created_at).getTime()
        return timeA - timeB || a.id - b.id
      })

      return new Response(JSON.stringify({ data: allBytes }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    return new Response('Invalid Action', { status: 400 })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500 
    })
  }
})