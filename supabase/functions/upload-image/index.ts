import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

serve(async (req) => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  try {
    const formData = await req.formData()
    const file = formData.get('file') as File
    if (!file) return new Response("No file", { status: 400 })

    // 1. UPLOAD IMAGE TO STORAGE
    const fileName = `${Date.now()}_${file.name}`
    const { data: storageData, error: storageError } = await supabase.storage
      .from('images')
      .upload(fileName, file)
    if (storageError) throw storageError

    // 2. GET API KEY (LRU ROTATION)
    const { data: keyData, error: keyError } = await supabase
      .from('api_keys')
      .select('*')
      .eq('service', 'gemini')
      .eq('is_active', true)
      .or(`cooldown_until.is.null,cooldown_until.lt.${new Date().toISOString()}`)
      .order('last_used_at', { ascending: true })
      .limit(1)
      .single()

    if (keyError || !keyData) throw new Error("No active Gemini API keys available")

    // Update key usage
    await supabase.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', keyData.id)

    const GEMINI_API_KEY = keyData.api_key
    const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`

    // 3. PREPARE BASE64
    const arrayBuffer = await file.arrayBuffer()
    const base64Image = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)))

    // 4. STEP 1: TRANSCRIPTION
    const transcribeRes = await fetch(GEMINI_URL, {
      method: 'POST',
      body: JSON.stringify({
        contents: [{ 
          parts: [
            { text: "Transcribe all text from this image exactly. Provide only the transcription, no other text, fillers, or comments." },
            { inline_data: { mime_type: file.type, data: base64Image } }
          ] 
        }]
      })
    })
    const transcribeJson = await transcribeRes.json()
    const rawText = transcribeJson.candidates[0].content.parts[0].text

    // Save progress to DB
    const { data: row, error: dbError } = await supabase.from('processed_images').insert({
        image_path: storageData.path,
        transcription: rawText,
        status: 'transcribed'
    }).select().single()

    // 5. STEP 2: STRUCTURED SOLVING
    const solvePrompt = `
      Analyze the following transcription of an educational assessment. 
      Solve every question and format the response as a strict JSON object.
      
      Transcription: ${rawText}

      Schema:
      {
        "sections": [
          {
            "type": "true_false | multiple_choice | matching | fill_blanks | workout | short_answer",
            "items": [
               { "question": "...", "answer": "...", "explanation": "optional logic for workout" }
            ]
          }
        ]
      }
      If a section type is matching, provide an array of pairs. 
      Return ONLY valid JSON.`

    const solveRes = await fetch(GEMINI_URL, {
      method: 'POST',
      body: JSON.stringify({
        contents: [{ parts: [{ text: solvePrompt }] }],
        generationConfig: { response_mime_type: "application/json" }
      })
    })
    const solveData = await solveRes.json()
    const solutionJson = JSON.parse(solveData.candidates[0].content.parts[0].text)

    // 6. UPDATE DB FINAL STATUS
    await supabase.from('processed_images')
      .update({ solution_json: solutionJson, status: 'completed' })
      .eq('id', row.id)

    return new Response(JSON.stringify({ success: true, id: row.id }), { headers: { 'Content-Type': 'application/json' } })

  } catch (err) {
    console.error(err)
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
})
