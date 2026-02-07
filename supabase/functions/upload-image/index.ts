import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { encodeBase64 } from "https://deno.land/std@0.203.0/encoding/base64.ts"

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

serve(async (req) => {
  const requestId = Math.random().toString(36).substring(7).toUpperCase();
  console.log(`[${requestId}] --- NEW REQUEST RECEIVED ---`);

  if (req.method === 'OPTIONS') return new Response('ok');

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const contentType = req.headers.get("content-type") || "";

    /**
     * STAGE 2: THE BACKGROUND SOLVER
     * Triggered by Supabase Webhook when a record is inserted with status 'transcribed'
     */
    if (contentType.includes("application/json")) {
      const payload = await req.json();
      console.log(`[${requestId}] Detected Stage 2 (JSON/Webhook)`);
      
      // Webhooks wrap data in 'record'. Direct calls use the body directly.
      const record = payload.record || payload;
      const { id, status, transcription } = record;

      if (!id) throw new Error("ID_MISSING: No record ID found in payload");
      
      // Only run if the record is in the correct state to avoid loops
      if (status !== 'transcribed') {
        console.log(`[${requestId}] Status is '${status}'. Ignoring Webhook.`);
        return new Response(JSON.stringify({ skipped: true }));
      }

      console.log(`[${requestId}] Beginning TTS-Optimized Solution for ID: ${id}`);
      const geminiKey = await getGeminiKey(supabase, requestId);
      const solutionJson = await runGeminiSolver(transcription, geminiKey, requestId);

      const { error: updateError } = await supabase.from('processed_images')
        .update({ solution_json: solutionJson, status: 'completed' })
        .eq('id', id);

      if (updateError) throw new Error(`DB_UPDATE_ERROR: ${updateError.message}`);
      
      console.log(`[${requestId}] STAGE 2 COMPLETE: Record marked as 'completed'`);
      return new Response(JSON.stringify({ success: true, id }));
    }

    /**
     * STAGE 1: UPLOAD & STRUCTURAL OCR
     * Triggered by the Android App sending a Multipart Form (Image)
     */
    console.log(`[${requestId}] Detected Stage 1 (Multipart/Upload)`);
    const formData = await req.formData();
    const file = formData.get('file') as File;
    if (!file) throw new Error("UPLOAD_ERROR: No file found in form data");

    console.log(`[${requestId}] Uploading image: ${file.name} (${file.size} bytes)`);
    const fileName = `${Date.now()}_${file.name.replace(/\s/g, '_')}`;
    const { data: storageData, error: storageError } = await supabase.storage
      .from('images').upload(fileName, file, { contentType: file.type, upsert: true });

    if (storageError) throw new Error(`STORAGE_ERROR: ${storageError.message}`);

    const base64Image = encodeBase64(await file.arrayBuffer());
    const geminiKey = await getGeminiKey(supabase, requestId);

    console.log(`[${requestId}] Running Structural OCR with Gemini 2.5 Flash...`);
    const transcriptionJson = await runGeminiTranscription(base64Image, file.type, geminiKey, requestId);

    const { data: row, error: dbError } = await supabase.from('processed_images').insert({
        image_path: storageData.path,
        transcription: transcriptionJson,
        status: 'transcribed'
    }).select().single();

    if (dbError) throw new Error(`DB_INSERT_ERROR: ${dbError.message}`);
    
    console.log(`[${requestId}] STAGE 1 COMPLETE: Created Record ${row.id}`);
    return new Response(JSON.stringify({ success: true, id: row.id, message: "Transcription saved. Solving in background." }), { 
        headers: { "Content-Type": "application/json" } 
    });

  } catch (err) {
    const errorBody = { error: err.message, requestId, time: new Date().toISOString() };
    console.error(`[${requestId}] FATAL_ERROR:`, JSON.stringify(errorBody));
    return new Response(JSON.stringify(errorBody), { 
        status: 500, 
        headers: { "Content-Type": "application/json" } 
    });
  }
});

async function getGeminiKey(supabase: any, rid: string) {
  const { data, error } = await supabase.from('api_keys')
    .select('*').eq('service', 'gemini').eq('is_active', true)
    .order('last_used_at', { ascending: true }).limit(1).single();

  if (error || !data) throw new Error("KEY_ERROR: No active Gemini key found in database.");
  
  // Update rotation
  await supabase.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', data.id);
  return data.api_key;
}

async function runGeminiTranscription(base64: string, mime: string, key: string, rid: string) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;
  const prompt = `Task: Extract every question from the image into JSON. \nRules:\n1. Exclude garbage (headers, page numbers, instructions).\n2. Keep original question numbers.\n3. Categorize as: 'mc', 'tf', 'fill', 'short', 'workout'.\n4. Do not omit anything that is part of a question text.\n\nJSON Schema: { "questions": [ { "number": "str", "type": "str", "question_text": "str", "options": ["str"] } ] }`;

  const res = await fetch(url, {
    method: 'POST',
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: base64 } }] }],
      generationConfig: { response_mime_type: "application/json" }
    })
  });

  const json = await res.json();
  if (!res.ok || !json.candidates) throw new Error(`GEMINI_T_API_ERROR: ${res.status} - ${JSON.stringify(json)}`);
  return json.candidates[0].content.parts[0].text;
}

async function runGeminiSolver(transcriptionJson: string, key: string, rid: string) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;
  const prompt = `Task: Solve these questions for Text-to-Speech (TTS) usage.\n\nSTRICT RULES:\n1. NO MATH SYMBOLS (No symbols like x², √, /, +, =).\n2. Use NATURAL LANGUAGE (e.g., 'x squared', 'divided by', 'plus', 'is equal to').\n3. For 'workout' questions, provide step-by-step logic in full English sentences.\n4. For 'mc', return the letter answer (e.g., 'B').\n\nInput JSON: ${transcriptionJson}\n\nJSON Schema: { "solutions": [ { "number": "str", "answer": "str", "explanation": "str (natural language logic)" } ] }`;

  const res = await fetch(url, {
    method: 'POST',
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { response_mime_type: "application/json" }
    })
  });

  const json = await res.json();
  if (!res.ok || !json.candidates) throw new Error(`GEMINI_S_API_ERROR: ${res.status} - ${JSON.stringify(json)}`);
  return JSON.parse(json.candidates[0].content.parts[0].text);
}
