import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { encodeBase64 } from "https://deno.land/std@0.203.0/encoding/base64.ts"

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const RECORD_ID = Deno.env.get('RECORD_ID') ?? '';
const IMAGE_PATHS_RAW = Deno.env.get('IMAGE_PATHS') ?? '[]';

// --- MODELS (EXACTLY AS SPECIFIED) ---
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

function extractJson(raw: string): string {
  const match = raw.match(/\`\`\`json\s?([\s\S]*?)\s?\`\`\`/) || raw.match(/\`\`\`\s?([\s\S]*?)\s?\`\`\`/);
  return (match ? match[1].trim() : raw.trim());
}

function formatTranscriptionForAI(transcription: any): string {
  let data = transcription;
  if (typeof transcription === 'string') {
    try { data = JSON.parse(transcription); } catch (e) { return "[Error Parsing]"; }
  }
  const qs = data?.questions || (Array.isArray(data) ? data : data?.data?.questions);
  if (!Array.isArray(qs)) return "[No Questions Found]";

  return qs.map((q: any, idx: number) => {
    const id = q.number || q.id || `Ref-${idx}`;
    const type = q.type || 'unknown';
    const text = q.question_text || q.question || q.text || "[No text found]";
    const opts = q.options ? ` | OPTS: ${Array.isArray(q.options) ? q.options.join(', ') : q.options}` : '';
    return `ID: ${id} | TYPE: ${type} | Q: ${text}${opts}`;
  }).join('\n');
}

async function getGeminiKey(supabase: any) {
  const { data, error } = await supabase.from('api_keys')
    .select('id, api_key')
    .eq('service', 'gemini')
    .eq('is_active', true)
    .or(`cooldown_until.is.null,cooldown_until.lt.${new Date().toISOString()}`)
    .order('last_used_at', { ascending: true, nullsFirst: true })
    .limit(1)
    .single();
  if (error || !data) throw new Error("No available Gemini keys");
  await supabase.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', data.id);
  return { id: data.id, key: data.api_key };
}

async function markKeyCooldown(supabase: any, keyId: number) {
  const cooldownTime = new Date(Date.now() + 60000).toISOString();
  await supabase.from('api_keys').update({ cooldown_until: cooldownTime }).eq('id', keyId);
}

async function callGeminiApi(supabase: any, model: string, prompt: string | null, parts?: any[], retryCount = 0): Promise<string> {
  if (retryCount > 5) throw new Error("Max retries reached");
  const { id: keyId, key } = await getGeminiKey(supabase);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const payloadParts = parts || [{ text: prompt }];

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: payloadParts }], generationConfig: { response_mime_type: "application/json" } })
  });

  if (res.status === 429) {
    await markKeyCooldown(supabase, keyId);
    return callGeminiApi(supabase, model === PRIMARY_MODEL ? FALLBACK_MODEL : PRIMARY_MODEL, prompt, parts, retryCount + 1);
  }

  const data = await res.json();
  const finalResponse = data.candidates?.[0]?.content?.parts?.map((p: any) => p.text || "").join('') || "";
  return finalResponse;
}

// --- MAIN EXECUTION LOOP ---
(async () => {
  console.log(`[WORKER] Starting process for Record: ${RECORD_ID}`);
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const paths = JSON.parse(IMAGE_PATHS_RAW);

  try {
    const geminiParts: any[] = [{ text: OCR_PROMPT_TEMPLATE }];
    for (const path of paths) {
      console.log(`[WORKER] Downloading: ${path}`);
      const { data: blob } = await supabase.storage.from('images').download(path);
      if (blob) {
        const buffer = await blob.arrayBuffer();
        geminiParts.push({ inline_data: { mime_type: "image/jpeg", data: encodeBase64(buffer) } });
      }
    }

    console.log("[WORKER] Calling OCR Stage...");
    const ocrRaw = await callGeminiApi(supabase, PRIMARY_MODEL, null, geminiParts);
    const ocrJson = JSON.parse(extractJson(ocrRaw));

    console.log("[WORKER] Calling Solver Stage...");
    const friendlyText = formatTranscriptionForAI(ocrJson);
    const solutionRaw = await callGeminiApi(supabase, PRIMARY_MODEL, SOLVER_PROMPT_TEMPLATE(friendlyText));
    const solutionJson = JSON.parse(extractJson(solutionRaw));

    console.log("[WORKER] Updating Database...");
    await supabase.from('processed_images').update({
      transcription: ocrJson,
      solution_json: solutionJson,
      status: 'completed'
    }).eq('id', RECORD_ID);

    console.log("[WORKER] Done.");
  } catch (err) {
    console.error("[WORKER] FATAL ERROR:", err);
    await supabase.from('processed_images').update({ status: 'error' }).eq('id', RECORD_ID);
    Deno.exit(1);
  }
})();