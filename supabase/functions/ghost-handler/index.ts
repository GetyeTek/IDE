import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const DICT = [" the ", " be ", " to ", " of ", " and ", " a ", " in ", " that ", " have ", " I "]; // Full list here

serve(async (req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '' // Use service role to delete rows
  )

  const { action, payload, uid } = await req.json()

  // --- ACTION: DISPATCH (SEND) ---
  if (action === 'dispatch') {
    let bytes: number[] = []
    
    // Logic: Encode text
    const words = payload.split(' ')
    words.forEach(word => {
      const idx = DICT.indexOf(word.toLowerCase().trim())
      if (idx !== -1) bytes.push(128 + idx)
      else [...word].forEach(c => bytes.push(c.charCodeAt(0)))
      bytes.push(32) // Space
    })

    // Logic: Multi-path splitting
    const paths = ['path_a', 'path_b', 'path_c']
    const target = paths[Math.floor(Math.random() * paths.length)]
    
    const rows = bytes.map(b => ({ b, u: uid }))
    await supabase.from(target).insert(rows)

    return new Response(JSON.stringify({ status: 'relayed' }), { headers: { "Content-Type": "application/json" } })
  }

  // --- ACTION: SIP (RECEIVE & BURN) ---
  if (action === 'sip') {
    const paths = ['path_a', 'path_b', 'path_c']
    let allBytes: any[] = []

    for (const p of paths) {
      const { data } = await supabase.from(p).select('*').limit(50)
      if (data && data.length > 0) {
        allBytes.push(...data)
        // BURN AFTER READING: Delete the bytes so no one else can find them
        const ids = data.map(d => d.id)
        await supabase.from(p).delete().in('id', ids)
      }
    }

    // Sort by ID to ensure message integrity
    allBytes.sort((a, b) => a.id - b.id)

    // Return raw bytes and metadata to the client for rendering
    return new Response(JSON.stringify({ data: allBytes }), { 
      headers: { "Content-Type": "application/json" } 
    })
  }
})
