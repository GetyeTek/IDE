import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { encodeBase64 } from "https://deno.land/std@0.203.0/encoding/base64.ts"

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok');

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    if (!file) throw new Error("No file provided");

    // 1. STORAGE
    const fileName = `${Date.now()}_${file.name.replace(/\s/g, '_')}`;
    const { data: storageData, error: storageError } = await supabase.storage
      .from('images')
      .upload(fileName, file, { contentType: file.type });
    if (storageError) throw storageError;

    // 2. KEY ROTATION (Get freshest key for the workflow)
    const { data: keyData } = await supabase
      .from('api_keys')
      .select('*')
      .eq('service', 'gemini')
      .eq('is_active', true)
      .order('last_used_at', { ascending: true })
      .limit(1)
      .single();

    if (!keyData) throw new Error("No active Gemini keys");
    await supabase.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', keyData.id);

    const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${keyData.api_key}`;

    // --- PASS 1: TRANSCRIPTION ONLY ---
    const arrayBuffer = await file.arrayBuffer();
    const base64Image = encodeBase64(arrayBuffer);

    const transcribeRes = await fetch(GEMINI_URL, {
      method: 'POST',
      body: JSON.stringify({
        contents: [{ 
          parts: [
            { text: "Transcribe all text from this image exactly. Provide ONLY the transcription text. No fillers, no introduction, no comments." },
            { inline_data: { mime_type: file.type, data: base64Image } }
          ] 
        }]
      })
    });

    const transcribeJson = await transcribeRes.json();
    if (!transcribeJson.candidates) throw new Error("Transcription Failed: " + JSON.stringify(transcribeJson));
    const rawTranscription = transcribeJson.candidates[0].content.parts[0].text;

    // Store intermediate result
    const { data: row, error: insertError } = await supabase.from('processed_images').insert({
        image_path: storageData.path,
        transcription: rawTranscription,
        status: 'transcribed'
    }).select().single();
    if (insertError) throw insertError;

    // --- PASS 2: SOLVING & STRUCTURING ---
    const solvePrompt = `
      Task: Analyze the following transcription and solve every question.
      Transcription: ${rawTranscription}

      Identify and organize the output based on these possible sections:
      - True or false
      - Fill in the blank space
      - Multiple choices
      - Matching (provide as pairs)
      - Workout (provide step-by-step logic)
      - Short answers

      Return ONLY a JSON object. If a section is missing from the text, skip it.
      Schema:
      {
        "sections": [
          {
            "type": "string (e.g., 'True/False')",
            "items": [
               { "question": "string", "answer": "string", "steps": "optional for workout" }
            ]
          }
        ]
      }`;

    const solveRes = await fetch(GEMINI_URL, {
      method: 'POST',
      body: JSON.stringify({
        contents: [{ parts: [{ text: solvePrompt }] }],
        generationConfig: { response_mime_type: "application/json" }
      })
    });

    const solveJson = await solveRes.json();
    if (!solveJson.candidates) throw new Error("Solving Failed");
    const finalResult = JSON.parse(solveJson.candidates[0].content.parts[0].text);

    // Update final result
    await supabase.from('processed_images')
      .update({ solution_json: finalResult, status: 'completed' })
      .eq('id', row.id);

    return new Response(JSON.stringify({ success: true, id: row.id }), { headers: { "Content-Type": "application/json" } });

  } catch (err) {
    console.error("PIPELINE_ERROR:", err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
