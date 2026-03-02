import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
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

    // 1. ROTATION LOGIC: Get the least recently used active Gemini key
    const { data: keyData, error: keyError } = await supabase
      .from('api_keys')
      .select('id, api_key')
      .eq('service', 'gemini')
      .eq('is_active', true)
      .or(`cooldown_until.is.null,cooldown_until.lt.${new Date().toISOString()}`)
      .order('last_used_at', { ascending: true })
      .limit(1)
      .single()

    if (keyError || !keyData) throw new Error('No available Gemini API keys.')

    // 2. TASK LOGIC: Get next pending PDF file
    const { data: taskData, error: taskError } = await supabase
      .from('processed_history_pages')
      .select('id, file_name')
      .eq('status', 'pending')
      .limit(1)
      .single()

    if (taskError || !taskData) return new Response(JSON.stringify({ message: 'No pending tasks' }), { status: 200 })

    // 3. UPDATE STATE: Mark key as used and task as processing
    await supabase.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', keyData.id)
    await supabase.from('processed_history_pages').update({ status: 'processing' }).eq('id', taskData.id)

    return new Response(
      JSON.stringify({
        apiKey: keyData.api_key,
        taskId: taskData.id,
        fileName: taskData.file_name
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
})
