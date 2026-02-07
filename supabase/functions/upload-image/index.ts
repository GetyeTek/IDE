import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { encodeBase64 } from "https://deno.land/std@0.203.0/encoding/base64.ts"

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

serve(async (req) => {
  const requestId = Math.random().toString(36).substring(7);
  const timestamp = new Date().toISOString();
  console.log(`[${requestId}] [${timestamp}] Incoming Request: ${req.method}`);

  if (req.method === 'OPTIONS') return new Response('ok');

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const contentType = req.headers.get("content-type") || "";
    console.log(`[${requestId}] Content-Type: ${contentType}`);
    
    // --- STAGE 2: SOLVING (Triggered by JSON request or Webhook) ---
    if (contentType.includes("application/json")) {
      const body = await req.json();
      // Webhooks wrap data in 'record'. Direct calls might not.
      const id = body.record?.id || body.id;
      const status = body.record?.status || body.status;

      if (!id) throw new Error("DATA_ERROR: No ID found in JSON or Webhook payload");
      
      // Safety check: only solve if status is 'transcribed'
      if (status !== 'transcribed' && body.record) {
          console.log(`[${requestId}] Webhook ignored: status is ${status}`);
          return new Response(JSON.stringify({ skipped: true }));
      }

      console.log(`[${requestId}] STAGE 2: Processing ID ${id}`);

      const { data: dbRecord, error: fetchError } = await supabase
        .from('processed_images')
        .select('*')
        .eq('id', id)
        .single();

      if (fetchError || !dbRecord) {
        throw new Error(`DB_FETCH_ERROR: Record ${id} not found. ${fetchError?.message}`);
      }

      console.log(`[${requestId}] Record retrieved. Transcription length: ${dbRecord.transcription?.length}`);
      const geminiKey = await getGeminiKey(supabase, requestId);
      
      const solution = await runGeminiSolver(dbRecord.transcription, geminiKey, requestId);
      
      const { error: updateError } = await supabase
        .from('processed_images')
        .update({ solution_json: solution, status: 'completed' })
        .eq('id', id);

      if (updateError) throw new Error(`DB_UPDATE_ERROR: ${updateError.message}`);

      return new Response(JSON.stringify({ success: true, stage: 'solved', data: solution }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // --- STAGE 1: UPLOAD & TRANSCRIBE (Triggered by Multipart Image) ---
    console.log(`[${requestId}] STAGE 1: Parsing Multipart Image`);
    const formData = await req.formData();
    const file = formData.get('file') as File;
    
    if (!file) throw new Error("FORM_ERROR: No file found in request payload");
    console.log(`[${requestId}] File Name: ${file.name}, Size: ${file.size}, Type: ${file.type}`);

    const fileName = `${Date.now()}_${file.name.replace(/\s/g, '_')}`;
    const { data: storageData, error: storageError } = await supabase.storage
      .from('images')
      .upload(fileName, file, { contentType: file.type, upsert: true });
    
    if (storageError) throw new Error(`STORAGE_ERROR: ${storageError.message}`);
    console.log(`[${requestId}] Storage Path: ${storageData.path}`);

    const arrayBuffer = await file.arrayBuffer();
    const base64Image = encodeBase64(arrayBuffer);
    const geminiKey = await getGeminiKey(supabase, requestId);

    console.log(`[${requestId}] Calling Gemini 2.5 Flash for Transcription...`);
    const transcription = await runGeminiTranscription(base64Image, file.type, geminiKey, requestId);

    const { data: row, error: dbError } = await supabase.from('processed_images').insert({
        image_path: storageData.path,
        transcription: transcription,
        status: 'transcribed'
    }).select().single();

    if (dbError) throw new Error(`DB_INSERT_ERROR: ${dbError.message}`);
    console.log(`[${requestId}] STAGE 1 SUCCESS: Created Row ${row.id}`);

    return new Response(JSON.stringify({ 
      success: true, 
      stage: 'transcribed', 
      id: row.id, 
      text: transcription 
    }), { headers: { "Content-Type": "application/json" } });

  } catch (err) {
    const errorDetail = {
      error: err.message,
      requestId: requestId,
      timestamp: new Date().toISOString(),
      hint: "Check Supabase Edge Function logs for details"
    };
    console.error(`[${requestId}] FATAL ERROR:`, JSON.stringify(errorDetail));
    return new Response(JSON.stringify(errorDetail), { 
      status: 500, 
      headers: { "Content-Type": "application/json" } 
    });
  }
});

async function getGeminiKey(supabase: any, requestId: string) {
  console.log(`[${requestId}] Fetching API Key...`);
  const { data, error } = await supabase
    .from('api_keys')
    .select('*')
    .eq('service', 'gemini')
    .eq('is_active', true)
    .order('last_used_at', { ascending: true })
    .limit(1)
    .single();

  if (error || !data) throw new Error(`KEY_ERROR: ${error?.message || 'No active Gemini keys found in api_keys table'}`);
  
  await supabase.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', data.id);
  return data.api_key;
}

async function runGeminiTranscription(b64: string, mime: string, key: string, rid: string) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;
  const prompt = `Task: Extract every question from this image into a structured JSON format.
  
  Strict Instructions:
  1. Exclude all garbage (page numbers, instructions like 'Time allowed', exam headers, blurry artifacts).
  2. DO NOT leave anything out that is part of a question, even if blurry. Try your best to infer.
  3. Preserve the original Question Number exactly as written (e.g., '1.', '4a', 'Question 5').
  4. Categorize into types: 'mc' (multiple choice), 'tf' (true/false), 'fill' (fill in the blank), 'short' (short answer), 'workout' (complex calculation).
  
  JSON Schema:
  {
    "questions": [
      {
        "number": "string",
        "type": "mc | tf | fill | short | workout",
        "question_text": "full text of the question",
        "options": ["A. ...", "B. ..."] // Only for mc
      }
    ]
  }`;

  const res = await fetch(url, {
    method: 'POST',
    body: JSON.stringify({
      contents: [{ parts: [
        { text: prompt },
        { inline_data: { mime_type: mime, data: b64 } }
      ] }],
      generationConfig: { response_mime_type: "application/json" }
    })
  });
  const j = await res.json();
  if (!j.candidates) throw new Error("Stage 1 Error: " + JSON.stringify(j));
  return j.candidates[0].content.parts[0].text;
}

async function runGeminiSolver(transcriptionJson: string, key: string, rid: string) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;
  const prompt = `Task: Solve the questions provided in the JSON transcription.

  Strict Output Rules for TTS (Text-to-Speech):
  1. NO mathematical symbols or notation (No x², no /, no √, no formulas).
  2. Everything must be in NATURAL LANGUAGE. 
     - Instead of 'x²', say 'x squared'.
     - Instead of '1/2', say 'one half' or 'one divided by two'.
     - Instead of '√9', say 'the square root of nine'.
  3. For 'workout' types, provide extremely detailed step-by-step logic in plain English sentences.
  4. For 'mc', return ONLY the correct option letter (e.g., 'C').

  JSON Schema:
  {
    "solutions": [
      {
        "number": "string (matching the input)",
        "answer": "The final answer (Choice letter for MC, True/False for TF, or the text)",
        "explanation": "The detailed natural language steps for TTS"
      }
    ]
  }`;

  const res = await fetch(url, {
    method: 'POST',
    body: JSON.stringify({
      contents: [{ parts: [
        { text: prompt },
        { text: "Input Data: " + transcriptionJson }
      ] }],
      generationConfig: { response_mime_type: "application/json" }
    })
  });
  const j = await res.json();
  if (!j.candidates) throw new Error("Stage 2 Error: " + JSON.stringify(j));
  return JSON.parse(j.candidates[0].content.parts[0].text);
}
