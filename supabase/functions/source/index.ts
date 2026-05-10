import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const RECEIVER_URL = "https://lbbhlcigpslqaltbeuce.supabase.co/functions/v1/Receiver"
const BATCH_SIZE = 2500 // Adjust based on row weight (2k-5k is usually safe for 60s)

serve(async (req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  try {
    // 1. Get the current active table
    const { data: progress, error: fetchErr } = await supabase
      .from('migration_progress')
      .select('*')
      .eq('is_completed', false)
      .order('updated_at', { ascending: true })
      .limit(1)
      .single()

    if (fetchErr || !progress) {
      return new Response(JSON.stringify({ message: "All migrations completed or no tables found." }))
    }

    const { table_name, last_offset } = progress

    // 2. Fetch data batch from source
    console.log(`Migrating ${table_name} from offset ${last_offset}...`)
    const { data: rows, error: dataErr } = await supabase
      .from(table_name)
      .select('*')
      .range(last_offset, last_offset + BATCH_SIZE - 1)
      .order('id', { ascending: true }) // Assumes 'id' exists

    if (dataErr) throw dataErr

    if (!rows || rows.length === 0) {
      // Mark as completed
      await supabase
        .from('migration_progress')
        .update({ is_completed: true, updated_at: new Date().toISOString() })
        .eq('table_name', table_name)
      
      return new Response(`Table ${table_name} finished.`)
    }

    // 3. Send to Receiver
    const response = await fetch(RECEIVER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        table: table_name,
        data: rows,
        primary_key: 'id'
      })
    })

    const result = await response.json()
    if (!response.ok) throw new Error(`Receiver Error: ${JSON.stringify(result)}`)

    // 4. Update offset for next run
    const newOffset = last_offset + rows.length
    const isFinished = rows.length < BATCH_SIZE

    await supabase
      .from('migration_progress')
      .update({ 
        last_offset: newOffset, 
        is_completed: isFinished,
        updated_at: new Date().toISOString() 
      })
      .eq('table_name', table_name)

    return new Response(JSON.stringify({
      table: table_name,
      migrated_total: newOffset,
      batch_size: rows.length,
      status: isFinished ? "Completed" : "In Progress"
    }))

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
})