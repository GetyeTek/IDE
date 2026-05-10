import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const RECEIVER_URL = "https://lbbhlcigpslqaltbeuce.supabase.co/functions/v1/Receiver"
const BATCH_SIZE = 500 // Reduced from 2500 to 500 for safety

serve(async (req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  try {
    const { data: progress, error: fetchErr } = await supabase
      .from('migration_progress')
      .select('*')
      .eq('is_completed', false)
      .order('updated_at', { ascending: true })
      .limit(1)
      .single()

    if (fetchErr || !progress) {
      return new Response("No pending migrations.")
    }

    const { table_name, last_offset } = progress
    console.log(`[START] ${table_name} at offset ${last_offset}`)

    // 1. Fetch data
    const { data: rows, error: dataErr } = await supabase
      .from(table_name)
      .select('*')
      .range(last_offset, last_offset + BATCH_SIZE - 1)

    if (dataErr) throw dataErr

    if (!rows || rows.length === 0) {
      await supabase.from('migration_progress').update({ is_completed: true }).eq('table_name', table_name)
      return new Response(`Finished ${table_name}`)
    }

    console.log(`[DATA] Fetched ${rows.length} rows. Sending to receiver...`)

    // 2. Send to Receiver with a timeout signal
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 50000) // 50s timeout

    const response = await fetch(RECEIVER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        table: table_name,
        data: rows
      }),
      signal: controller.signal
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Receiver failed: ${errorText}`)
    }

    console.log(`[SUCCESS] Receiver accepted batch. Updating offset...`)

    // 3. Update Progress
    const { error: upErr } = await supabase
      .from('migration_progress')
      .update({ 
        last_offset: last_offset + rows.length,
        updated_at: new Date().toISOString()
      })
      .eq('table_name', table_name)

    if (upErr) throw upErr

    return new Response(`Moved ${rows.length} rows`)

  } catch (err) {
    console.error(`[ERROR]`, err.message)
    return new Response(err.message, { status: 500 })
  }
})