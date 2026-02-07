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
  if (!transcription.questions) return "No questions found.";
  return transcription.questions.map((q: any) => {
    let text = `ID: ${q.number} | TYPE: ${q.type} | QUESTION: ${q.question_text}`;
    if (q.options && q.options.length > 0) {
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

      if (status !== 'transcribed') return new Response(JSON.stringify({ skipped: true }));

      console.log(`[${requestId}] SOLVING: ID ${id}`);
      const friendlyText = formatTranscriptionForAI(transcription);
      const geminiKey = await getGeminiKey(supabase);
      
      const solutionJson = await runGeminiSolver(friendlyText, geminiKey);

      const { error: updateError } = await supabase.from('processed_images')
        .update({ solution_json: solutionJson, status: 'completed' })
        .eq('id', id);

      if (updateError) throw updateError;
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

// --- AI FUNCTIONS ---

async function getGeminiKey(supabase: any) {
  const { data, error } = await supabase.from('api_keys')
    .select('*').eq('service', 'gemini').eq('is_active', true)
    .order('last_used_at', { ascending: true }).limit(1).single();
  if (error || !data) throw new Error("No active Gemini API key found");
  await supabase.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', data.id);
  return data.api_key;
}

async function runGeminiTranscription(base64: string, mime: string, key: string) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`;
  
  const res = await fetch(url, {
    method: 'POST',
    body: JSON.stringify({
      contents: [{ parts: [{ text: OCR_PROMPT_TEMPLATE }, { inline_data: { mime_type: mime, data: base64 } }] }],
      generationConfig: { response_mime_type: "application/json" }
    })
  });
  const data = await res.json();
  return data.candidates[0].content.parts[0].text;
}

async function runGeminiSolver(friendlyText: string, key: string) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`;
  
  const res = await fetch(url, {
    method: 'POST',
    body: JSON.stringify({
      contents: [{ parts: [{ text: SOLVER_PROMPT_TEMPLATE(friendlyText) }] }],
      generationConfig: { response_mime_type: "application/json" }
    })
  });
  
  const json = await res.json();
  const rawText = json.candidates[0].content.parts[0].text;
  return JSON.parse(extractJson(rawText));
}
