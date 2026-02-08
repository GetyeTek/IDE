import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { encodeBase64 } from "https://deno.land/std@0.203.0/encoding/base64.ts"

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// --- PROMPT TEMPLATES ---

const OCR_PROMPT_TEMPLATE = `
OCR TASK: Extract questions from the image.
  
SCHEMA: { "questions": [ { "number": "1", "type": "mc|tf|fill|ma|sa|wo", "question_text": "...", "options": [] } ] }
  
RULES:
1. mc=Multiple Choice, tf=True/False, fill=Blanks, ma=Matching, sa=Short Answer, wo=Workout/Math.
2. Strip all headers, footers, and page numbers. 
3. Capture ONLY the text of the questions.
4. NEITHER explain nor solve yet. Just transcribe.
`;

const SOLVER_PROMPT_TEMPLATE = (friendlyText: string) => `
EXAM SOLVER (TTS & PARSABLE MODE).
The user will listen to your instructions. Write in natural, fluid language.

INPUT QUESTIONS:
${friendlyText}

STRICT OUTPUT RULES:
1. NATURAL LANGUAGE: Use words, not symbols. Say "plus" instead of "+", "divided by" instead of "/", and "x squared" instead of "x²". This is for a voice engine.
2. NON-WORKOUT (mc, tf, fill, ma, sa): 
   - Provide ONLY the direct answer.
   - The "steps" array MUST be empty []. 
3. WORKOUT (wo) QUESTIONS: 
   - You MUST provide a "steps" array.
   - Each step must follow this exact format: "Step X: [Short sentence describing the action] [write: [The exact math/text to put on paper]]"
   - Example: "Step 1: We first multiply both sides by five to isolate the variable. [write: 5x = 20]"
4. NO FILLER: Do not say "Here are the answers" or "I hope this helps."
5. JSON INTEGRITY: You must return valid JSON. Never break the schema.

SCHEMA: 
{ 
  "solutions": [ 
    { 
      "number": "string", 
      "type": "string", 
      "answer": "string", 
      "steps": ["string"] 
    } 
  ] 
}

CRITICAL: The "steps" key MUST be an empty array [] for every type EXCEPT "wo". This is non-negotiable.
`;

// --- UTILS ---

function extractJson(raw: string): string {
  const match = raw.match(/```json\s?([\s\S]*?)\s?```/) || raw.match(/```\s?([\s\S]*?)\s?```/);
  return (match ? match[1].trim() : raw.trim());
}

function formatTranscriptionForAI(transcription: any): string {
  let data = transcription;

  // Handle case where transcription is a stringified JSON string
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
      // Sometimes it's double-encoded, try one more time if still a string
      if (typeof data === 'string') data = JSON.parse(data);
    } catch (e) {
      console.error("Failed to parse transcription string:", e);
    }
  }

  // Robust extraction: support object with 'questions' key OR direct array
  const qs = data?.questions || (Array.isArray(data) ? data : null);
  
  if (!qs || !Array.isArray(qs) || qs.length === 0) {
    console.error("TRANSCRIPTION_DATA_MISSING: The transcription object did not contain a valid questions array.", JSON.stringify(data));
    return "[ERROR: No questions were extracted from the image. Please try a clearer photo.]";
  }
  
  return qs.map((q: any) => {
    const id = q.number || q.id || "?";
    const type = q.type || "unknown";
    const qText = q.question_text || q.text || "[Missing Text]";
    
    let text = `ID: ${id} | TYPE: ${type} | QUESTION: ${qText}`;
    if (q.options && Array.isArray(q.options) && q.options.length > 0) {
      text += ` | OPTIONS: ${q.options.join(', ')}`;
    }
    return text;
  }).join('\n');
}

// --- CORE LOGIC ---

serve(async (req) => {
  const requestId = Math.random().toString(36).substring(7).toUpperCase();
  if (req.method === 'OPTIONS') return new Response('ok');

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const contentType = req.headers.get("content-type") || "";

    // --- SOLVER STAGE (Webhook or JSON Payload) ---
    if (contentType.includes("application/json")) {
      const payload = await req.json();
      const record = payload.record || payload;
      const { id, status, transcription } = record;

      console.log(`[${requestId}] WEBHOOK RECEIVED: ID=${id}, Status=${status}`);
      if (status !== 'transcribed') {
          console.log(`[${requestId}] SKIPPING: Status is not 'transcribed'`);
          return new Response(JSON.stringify({ skipped: true }));
      }

      console.log(`[${requestId}] RAW TRANSCRIPTION FROM DB:`, JSON.stringify(transcription));
      
      const friendlyText = formatTranscriptionForAI(transcription);
      console.log(`[${requestId}] FRIENDLY TEXT FOR AI:`, friendlyText);

      const geminiKey = await getGeminiKey(supabase);
      const solutionJson = await runGeminiSolver(friendlyText, geminiKey, requestId);

      console.log(`[${requestId}] FINAL JSON TO SAVE:`, JSON.stringify(solutionJson));

      const { error: updateError } = await supabase.from('processed_images')
        .update({ solution_json: solutionJson, status: 'completed' })
        .eq('id', id);

      if (updateError) {
          console.error(`[${requestId}] DB UPDATE ERROR:`, updateError);
          throw updateError;
      }
      
      console.log(`[${requestId}] SUCCESS: Record ${id} updated.`);
      return new Response(JSON.stringify({ success: true }));
    }

    // --- OCR STAGE (Image Upload) ---
    const formData = await req.formData();
    const file = formData.get('file') as File;
    if (!file) throw new Error("No file uploaded");

    const fileName = `${Date.now()}_${file.name.replace(/\s/g, '_')}`;
    const { data: storageData, error: storageError } = await supabase.storage
      .from('images').upload(fileName, file, { contentType: file.type, upsert: true });

    if (storageError) throw storageError;

    const base64Image = encodeBase64(await file.arrayBuffer());
    const geminiKey = await getGeminiKey(supabase);

    console.log(`[${requestId}] TRANSCRIBING: ${fileName}`);
    const transcriptionRaw = await runGeminiTranscription(base64Image, file.type, geminiKey);
    const transcriptionJson = JSON.parse(extractJson(transcriptionRaw));

    const { data: row, error: dbError } = await supabase.from('processed_images').insert({
        image_path: storageData.path,
        transcription: transcriptionJson,
        status: 'transcribed'
    }).select().single();

    if (dbError) throw dbError;
    return new Response(JSON.stringify({ success: true, id: row.id }));

  } catch (err) {
    console.error(`[${requestId}] FATAL:`, err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});

// --- AI MODELS ---
const PRIMARY_MODEL = "gemini-2.5-flash";
const FALLBACK_MODEL = "gemini-3-flash-preview";

// --- AI FUNCTIONS ---

async function getGeminiKey(supabase: any) {
  const { data, error } = await supabase.from('api_keys')
    .select('*').eq('service', 'gemini').eq('is_active', true)
    .order('last_used_at', { ascending: true }).limit(1).single();
  if (error || !data) throw new Error("No active Gemini API key found");
  await supabase.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', data.id);
  return data.api_key;
}

async function callGeminiApi(model: string, key: string, prompt: string, mime?: string, base64?: string) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const parts: any[] = [{ text: prompt }];
  
  if (mime && base64) {
    parts.push({ inline_data: { mime_type: mime, data: base64 } });
  }

  const res = await fetch(url, {
    method: 'POST', 
    body: JSON.stringify({
      contents: [{ parts }],
      safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
      ],
      generationConfig: { response_mime_type: "application/json" }
    })
  });

  // Check for Quota Exceeded (429)
  if (res.status === 429 && model !== FALLBACK_MODEL) {
    console.warn(`[QUOTA] ${model} exhausted. Retrying with ${FALLBACK_MODEL}...`);
    return callGeminiApi(FALLBACK_MODEL, key, prompt, mime, base64);
  }

  const data = await res.json();
  if (!data.candidates || !data.candidates[0]) {
    throw new Error(data.error?.message || "Empty Gemini response");
  }
  return data.candidates[0].content.parts[0].text;
}

async function runGeminiTranscription(base64: string, mime: string, key: string) {
  try {
    return await callGeminiApi(PRIMARY_MODEL, key, OCR_PROMPT_TEMPLATE, mime, base64);
  } catch (err) {
    console.error("Transcription Failure:", err.message);
    throw err;
  }
}

async function runGeminiSolver(friendlyText: string, key: string, requestId: string) {
  const prompt = SOLVER_PROMPT_TEMPLATE(friendlyText);
  console.log(`[${requestId}] CALLING SOLVER (with fallback logic)...`);

  try {
    const rawText = await callGeminiApi(PRIMARY_MODEL, key, prompt);
    console.log(`[${requestId}] EXTRACTED TEXT:`, rawText);
    const cleanedJson = extractJson(rawText);
    return JSON.parse(cleanedJson);
  } catch (e) {
    console.error(`[${requestId}] SOLVER ERROR:`, e.message);
    throw e;
  }
}
