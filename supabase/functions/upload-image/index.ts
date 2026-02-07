import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { encodeBase64 } from "https://deno.land/std@0.203.0/encoding/base64.ts"

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

serve(async (req) => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  try {
    const formData = await req.formData()
    const file = formData.get('file') as File
    if (!file) return new Response("No file", { status: 400 })

    // 1. UPLOAD IMAGE
    const fileName = `${Date.now()}_${file.name}`
    const { data: storageData, error: storageError } = await supabase.storage
      .from('images')
      .upload(fileName, file)
    if (storageError) throw storageError

    // 2. KEY ROTATION
    const { data: keyData, error: keyError } = await supabase
      .from('api_keys')
      .select('*')
      .eq('service', 'gemini')
      .eq('is_active', true)
      .or(`cooldown_until.is.null,cooldown_until.lt.${new Date().toISOString()}`)
      .order('last_used_at', { ascending: true })
      .limit(1)
      .single()

    if (keyError || !keyData) throw new Error("No active Gemini API keys")
    await supabase.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', keyData.id)

    const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${keyData.api_key}`
    const base64Image = encodeBase64(await file.arrayBuffer())

    // 3. STEP 1: TRANSCRIPTION
    const transcribeRes = await fetch(GEMINI_URL, {
      method: 'POST',
      body: JSON.stringify({
        contents: [{ 
          parts: [
            { text: "Transcribe all text from this image exactly. Return only the text." },
            { inline_data: { mime_type: file.type, data: base64Image } }
          ] 
        }]
      })
    })
    const transcribeJson = await transcribeRes.json()
    if (!transcribeJson.candidates) throw new Error(`Transcription Failed: ${JSON.stringify(transcribeJson)}`)
    const rawText = transcribeJson.candidates[0].content.parts[0].text

    const { data: row } = await supabase.from('processed_images').insert({
        image_path: storageData.path,
        transcription: rawText,
        status: 'transcribed'
    }).select().single()

    // 4. STEP 2: STRUCTURED SOLVING WITH THINKING MODE
    const solvePrompt = `Solve these questions from the transcription. Return JSON ONLY.\nTranscription: ${rawText}\nSchema: { "sections": [ { "type": "string", "items": [ { "question": "string", "answer": "string" } ] } ] }`

    const solveRes = await fetch(GEMINI_URL, {
      method: 'POST',
      body: JSON.stringify({
        contents: [{ parts: [{ text: solvePrompt }] }],
        generationConfig: {
            response_mime_type: "application/json"
        },
        // Enabling reasoning capabilities of Gemini 2.5 Flash
        thinking_config: {
            include_thoughts: false 
        }
      })
    })
    const solveData = await solveRes.json()
    if (!solveData.candidates) throw new Error("Solving Failed")

    const solutionJson = JSON.parse(solveData.candidates[0].content.parts[0].text)

    await supabase.from('processed_images')
      .update({ solution_json: solutionJson, status: 'completed' })
      .eq('id', row.id)

    return new Response(JSON.stringify({ success: true, id: row.id }), { headers: { 'Content-Type': 'application/json' } })

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
})
