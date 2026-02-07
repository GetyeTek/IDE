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
    
    // --- STAGE 2: SOLVING (Triggered by JSON request with ID) ---
    if (contentType.includes("application/json")) {
      const body = await req.json();
      const { id } = body;
      console.log(`[${requestId}] STAGE 2: Processing ID ${id}`);

      const { data: record, error: fetchError } = await supabase
        .from('processed_images')
        .select('*')
        .eq('id', id)
        .single();

      if (fetchError || !record) {
        throw new Error(`DB_FETCH_ERROR: Record ${id} not found. ${fetchError?.message}`);
      }

      console.log(`[${requestId}] Record retrieved. Transcription length: ${record.transcription?.length}`);
      const geminiKey = await getGeminiKey(supabase, requestId);
      
      const solution = await runGeminiSolver(record.transcription, geminiKey, requestId);
      
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

async function runGeminiTranscription(base64: string, mime: string, key: string, requestId: string) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;
  const payload = {
    contents: [{ parts: [
      { text: "Transcribe all text from this image exactly. Provide ONLY the transcription text. No fillers." },
      { inline_data: { mime_type: mime, data: base64 } }
    ] }]
  };

  const res = await fetch(url, { method: 'POST', body: JSON.stringify(payload) });
  const json = await res.json();

  if (!res.ok || !json.candidates) {
    console.error(`[${requestId}] Gemini API Error:`, JSON.stringify(json));
    throw new Error(`GEMINI_TRANSCRIPTION_API_ERROR: ${res.status}`);
  }

  return json.candidates[0].content.parts[0].text;
}

async function runGeminiSolver(text: string, key: string, requestId: string) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;
  const prompt = `Task: Analyze transcription and solve every question. Return ONLY a JSON object. Transcription: ${text}`;
  
  const res = await fetch(url, {
    method: 'POST',
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { response_mime_type: "application/json" }
    })
  });

  const json = await res.json();
  if (!res.ok || !json.candidates) {
    console.error(`[${requestId}] Gemini Solver Error:`, JSON.stringify(json));
    throw new Error(`GEMINI_SOLVER_API_ERROR: ${res.status}`);
  }

  return JSON.parse(json.candidates[0].content.parts[0].text);
}
