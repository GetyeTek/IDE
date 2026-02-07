import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { encodeBase64 } from "https://deno.land/std@0.203.0/encoding/base64.ts"

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// Helper to strip markdown backticks and extract raw JSON
function extractJson(raw: string): string {
  const match = raw.match(/```json\s?([\s\S]*?)\s?```/) || raw.match(/```\s?([\s\S]*?)\s?```/);
  return (match ? match[1].trim() : raw.trim());
}

serve(async (req) => {
  const requestId = Math.random().toString(36).substring(7).toUpperCase();
  console.log(`[${requestId}] --- NEW REQUEST RECEIVED ---`);

  if (req.method === 'OPTIONS') return new Response('ok');

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      const payload = await req.json();
      const record = payload.record || payload;
      const { id, status, transcription } = record;

      if (!id) throw new Error("ID_MISSING");
      if (status !== 'transcribed') return new Response(JSON.stringify({ skipped: true }));

      console.log(`[${requestId}] Solving for ID: ${id}`);
      const geminiKey = await getGeminiKey(supabase, requestId);
      const solutionJson = await runGeminiSolver(transcription, geminiKey, requestId);

      const { error: updateError } = await supabase.from('processed_images')
        .update({ solution_json: solutionJson, status: 'completed' })
        .eq('id', id);

      if (updateError) throw new Error(`DB_UPDATE_ERROR: ${updateError.message}`);
      return new Response(JSON.stringify({ success: true, id }));
    }

    const formData = await req.formData();
    const file = formData.get('file') as File;
    if (!file) throw new Error("UPLOAD_ERROR: No file");

    const fileName = `${Date.now()}_${file.name.replace(/\s/g, '_')}`;
    const { data: storageData, error: storageError } = await supabase.storage
      .from('images').upload(fileName, file, { contentType: file.type, upsert: true });

    if (storageError) throw new Error(`STORAGE_ERROR: ${storageError.message}`);

    const base64Image = encodeBase64(await file.arrayBuffer());
    const geminiKey = await getGeminiKey(supabase, requestId);

    console.log(`[${requestId}] Transcribing...`);
    const transcriptionJson = await runGeminiTranscription(base64Image, file.type, geminiKey, requestId);

    const { data: row, error: dbError } = await supabase.from('processed_images').insert({
        image_path: storageData.path,
        transcription: JSON.parse(extractJson(transcriptionJson)),
        status: 'transcribed'
    }).select().single();

    if (dbError) throw new Error(`DB_INSERT_ERROR: ${dbError.message}`);
    return new Response(JSON.stringify({ success: true, id: row.id }), { headers: { "Content-Type": "application/json" } });

  } catch (err) {
    console.error(`[${requestId}] FATAL:`, err.message);
    return new Response(JSON.stringify({ error: err.message, requestId }), { status: 500 });
  }
});

async function getGeminiKey(supabase: any, rid: string) {
  const { data, error } = await supabase.from('api_keys')
    .select('*').eq('service', 'gemini').eq('is_active', true)
    .order('last_used_at', { ascending: true }).limit(1).single();
  if (error || !data) throw new Error("KEY_ERROR");
  await supabase.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', data.id);
  return data.api_key;
}

async function runGeminiTranscription(base64: string, mime: string, key: string, rid: string) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;
  const prompt = `OCR TASK: Extract all questions. 
  STRICT CATEGORIES: 
  - 'mc' (multiple choice)
  - 'tf' (true/false)
  - 'fill' (blank spaces)
  - 'ma' (matching)
  - 'sa' (short/descriptive)
  - 'wo' (workout/math)
  
  RULES: 
  1. Ignore page footers/headers.
  2. Preserve question numbers.
  3. If a question is a diagram, describe its key components in question_text.
  
  JSON SCHEMA: { "questions": [ { "number": "str", "type": "str", "question_text": "str", "options": ["str"] } ] }`;

  const res = await fetch(url, {
    method: 'POST',
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: base64 } }] }],
      generationConfig: { response_mime_type: "application/json" }
    })
  });
  const json = await res.json();
  return json.candidates[0].content.parts[0].text;
}

async function runGeminiSolver(transcriptionJson: any, key: string, rid: string) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;
  const prompt = `EXAM SOLVER TASK: Solve for Text-to-Speech (TTS).

  PHONETIC RULES:
  1. NO SYMBOLS: Replace symbols with words. Examples: 
     - 'x^2' -> 'x squared'
     - '√' -> 'square root of'
     - '1/2' -> 'one half'
     - '=' -> 'equals'
     - '+' -> 'plus'
  2. Avoid long essays. Keep answers punchy.
  3. For 'wo': Provide steps. Format: 'Step X: [Action]. Write: [Content to dictate]'.
  4. For others: Provide a single direct answer.

  INPUT: ${JSON.stringify(transcriptionJson)}

  JSON SCHEMA: { "solutions": [ { "number": "str", "type": "str", "answer": "str", "steps": ["str"] } ] }`;

  const res = await fetch(url, {
    method: 'POST',
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { response_mime_type: "application/json" }
    })
  });
  const json = await res.json();
  const rawText = json.candidates[0].content.parts[0].text;
  return JSON.parse(extractJson(rawText));
}
