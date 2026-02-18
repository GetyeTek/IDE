import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { encodeBase64 } from "https://deno.land/std@0.203.0/encoding/base64.ts"

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// --- MODELS (USER SPECIFIED ORDER) ---
const PRIMARY_MODEL = "gemini-3-flash-preview";
const FALLBACK_MODEL = "gemini-2.5-flash";

const OCR_PROMPT_TEMPLATE = `
BATCH OCR & SPATIAL MAPPING TASK:
You are provided with multiple images of an exam paper. 

YOUR GOAL:
1. STITCHING: Compare all images to create a master list of unique questions. 
2. ORDERING: Use the physical layout (top-to-bottom, left-to-right) to determine the logical order. If a question is numbered '1' and another '2', 1 MUST come first.
3. DEDUPLICATION: If Question 5 appears in three photos, only transcribe the clearest version once.
4. CLARITY: If text is unreadable, use [unreadable] but attempt to infer from context.

CATEGORIES:
- mc: Multiple Choice
- tf: True/False
- fill: Fill in the blanks
- ma: Matching
- sa: Short Answer
- wo: Mathematical Workout / Long Form

OUTPUT JSON:
{ "questions": [ { "number": "string", "type": "string", "question_text": "string", "options": ["string"] } ] }
`;

const SOLVER_PROMPT_TEMPLATE = (friendlyText: string) => `
EXAM SOLVER (PHONETIC TTS MODE).
You are an expert tutor providing answers for a student to listen to and write down.

INPUT QUESTIONS:
${friendlyText}

STRICT TTS RULES:
1. PHONETIC MATH: Never use symbols. Translate all math to English words.
   - Instead of '√x', say 'the square root of x'.
   - Instead of 'x²', say 'x squared'.
   - Instead of '1/2', say 'one half'.
   - Instead of '∫', say 'the integral of'.
2. STEALTH & SPEED:
   - For 'mc', 'tf', 'fill', 'ma', 'sa': Provide ONLY the answer. Example: "Answer is B" or "Answer is True". No explanations.
3. WORKOUT MODE ('wo'):
   - Provide a 'steps' array where each step is a short instruction the student can follow while writing.
   - Format: "First, write down the formula...", "Next, substitute three for x...", "The result is five."
4. NO MARKDOWN: Never use bold, italics, or LaTeX.

JSON SCHEMA:
{ "solutions": [ { "number": "string", "type": "string", "answer": "string", "steps": ["string"] } ] }
`;

// --- UTILS ---

function extractJson(raw: string): string {
  const match = raw.match(/\`\`\`json\s?([\s\S]*?)\s?\`\`\`/) || raw.match(/\`\`\`\s?([\s\S]*?)\s?\`\`\`/);
  return (match ? match[1].trim() : raw.trim());
}

function formatTranscriptionForAI(transcription: any): string {
  const qs = transcription?.questions || transcription;
  if (!Array.isArray(qs)) return "[Error formatting questions]";
  return qs.map((q: any) => `ID: ${q.number} | TYPE: ${q.type} | Q: ${q.question_text} ${q.options ? '| OPTS: ' + q.options.join(', ') : ''}`).join('\n');
}

serve(async (req) => {
  const requestId = Math.random().toString(36).substring(7).toUpperCase();
  console.log(`[${requestId}] Incoming Request: ${req.method}`);

  if (req.method === 'OPTIONS') return new Response('ok');

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const contentType = req.headers.get("content-type") || "";
    console.log(`[${requestId}] Content-Type: ${contentType}`);

    // --- SOLVER STAGE (Webhook/JSON) ---
    if (contentType.includes("application/json")) {
      console.log(`[${requestId}] Triggering Solver Stage...`);
      const payload = await req.json();
      const record = payload.record || payload;
      
      if (record.status !== 'transcribed') {
        console.log(`[${requestId}] Skipping: Record status is ${record.status}`);
        return new Response(JSON.stringify({ skipped: true }));
      }

      const friendlyText = formatTranscriptionForAI(record.transcription);
      console.log(`[${requestId}] Formatted Transcription for AI. Length: ${friendlyText.length}`);

      const geminiKey = await getGeminiKey(supabase, requestId);
      console.log(`[${requestId}] Calling AI Solver with model: ${PRIMARY_MODEL}`);
      
      const solutionRaw = await callGeminiApi(PRIMARY_MODEL, geminiKey, SOLVER_PROMPT_TEMPLATE(friendlyText), undefined, requestId);
      const extracted = extractJson(solutionRaw);
      
      console.log(`[${requestId}] Updating Database with solution...`);
      const { error } = await supabase.from('processed_images')
        .update({ 
          solution_json: JSON.parse(extracted), 
          status: 'completed' 
        })
        .eq('id', record.id);

      if (error) throw error;
      console.log(`[${requestId}] Successfully completed solver flow.`);
      return new Response(JSON.stringify({ success: true }));
    }

    // --- BATCH OCR STAGE (Image Upload) ---
    console.log(`[${requestId}] Triggering Batch OCR Stage...`);
    const formData = await req.formData();
    const files = formData.getAll('file') as unknown as File[];
    
    if (files.length === 0) throw new Error("No files uploaded");
    console.log(`[${requestId}] Received ${files.length} image(s) for processing.`);

    const geminiParts: any[] = [{ text: OCR_PROMPT_TEMPLATE }];
    
    for (const file of files) {
      console.log(`[${requestId}] Processing file: ${file.name} (${file.type})`);
      const buffer = await file.arrayBuffer();
      const b64 = encodeBase64(buffer);
      
      geminiParts.push({ 
        inline_data: { 
          mime_type: file.type || "image/jpeg", 
          data: b64 
        } 
      });

      // Async storage upload (non-blocking for the AI flow, but logged)
      const storagePath = `${Date.now()}_${file.name}`;
      supabase.storage.from('images').upload(storagePath, buffer, { contentType: file.type })
        .then(({ error }) => {
          if (error) console.error(`[${requestId}] Storage Upload Error:`, error.message);
          else console.log(`[${requestId}] Image archived to storage: ${storagePath}`);
        });
    }

    const geminiKey = await getGeminiKey(supabase, requestId);
    console.log(`[${requestId}] Requesting OCR from AI: ${PRIMARY_MODEL}`);
    
    const ocrRaw = await callGeminiApi(PRIMARY_MODEL, geminiKey, null, geminiParts, requestId);
    const ocrExtracted = extractJson(ocrRaw);
    const ocrJson = JSON.parse(ocrExtracted);

    console.log(`[${requestId}] OCR Complete. Inserting record to DB...`);
    const { data: row, error: dbError } = await supabase.from('processed_images').insert({
        transcription: ocrJson,
        status: 'transcribed'
    }).select().single();

    if (dbError) throw dbError;
    console.log(`[${requestId}] Success. Created record ID: ${row.id}`);
    
    return new Response(JSON.stringify({ success: true, id: row.id }));

  } catch (err) {
    console.error(`[${requestId}] FATAL ERROR:`, err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});

// --- AI FUNCTIONS ---

async function getGeminiKey(supabase: any, requestId: string) {
  const { data, error } = await supabase.from('api_keys').select('api_key').eq('service', 'gemini').eq('is_active', true).limit(1).single();
  if (error || !data) {
    console.error(`[${requestId}] API Key retrieval failed.`);
    throw new Error("No active Gemini key found in database");
  }
  return data.api_key;
}

async function callGeminiApi(model: string, key: string, prompt: string | null, parts?: any[], requestId?: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const payloadParts = parts || [{ text: prompt }];
  
  console.log(`[${requestId}] Fetching Gemini API (${model})...`);
  
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      contents: [{ parts: payloadParts }], 
      generationConfig: { response_mime_type: "application/json" } 
    })
  });

  if (res.status === 429 && model !== FALLBACK_MODEL) {
    console.warn(`[${requestId}] [QUOTA EXHAUSTED] ${model} failed. Retrying with ${FALLBACK_MODEL}...`);
    return callGeminiApi(FALLBACK_MODEL, key, prompt, parts, requestId);
  }

  const data = await res.json();
  if (!res.ok) {
    console.error(`[${requestId}] Gemini API Error:`, JSON.stringify(data));
    throw new Error(data.error?.message || `AI API returned ${res.status}`);
  }

  if (!data.candidates || !data.candidates[0]) {
    throw new Error("Empty Gemini response - no candidates found");
  }
  
  const responseParts = data.candidates[0].content.parts;
  if (!responseParts || responseParts.length === 0) {
    throw new Error("No parts found in Gemini response content");
  }
  
  const finalResponse = responseParts.map((p: any) => p.text || "").join('');
  console.log(`[${requestId}] Gemini response received successfully.`);
  return finalResponse;
}
