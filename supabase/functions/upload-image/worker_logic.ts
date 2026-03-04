import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { encodeBase64 } from "https://deno.land/std@0.203.0/encoding/base64.ts"

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const RECORD_ID = Deno.env.get('RECORD_ID') ?? '';
const REQUEST_ID = Deno.env.get('REQUEST_ID') ?? 'WORKER';
const IMAGE_PATHS_RAW = Deno.env.get('IMAGE_PATHS') ?? '[]';

// --- MODELS (USER SPECIFIED ORDER) ---
const PRIMARY_MODEL = "gemini-2.5-flash";
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
{ 
  "confidence_score": number, 
  "questions": [ { "number": "string", "type": "string", "question_text": "string", "options": ["string"] } ] 
}

CONFIDENCE SCORE RULES:
- Rate 1-10 based on image clarity, readability, and context completeness.
- 1-4: Unreadable, extremely blurry, or unrelated images.
- 5-6: Partially readable but ambiguous; high risk of hallucination.
- 7-10: Clear text, logically ordered, high certainty.
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
   - For 'mc' (Multiple Choice): Provide the letter AND the full text of the option. Example: "Answer is B, Photosynthesis".
   - For 'tf', 'fill', 'ma', 'sa': Provide ONLY the answer. Example: "Answer is True". No explanations.
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

function formatTranscriptionForAI(transcription: any, requestId: string): string {
  console.log(`[${requestId}] [FORMATTER] Input type: ${typeof transcription}`);
  let data = transcription;
  if (typeof transcription === 'string') {
    try {
      data = JSON.parse(transcription);
      console.log(`[${requestId}] [FORMATTER] Successfully parsed stringified JSON.`);
    } catch (e) {
      console.error(`[${requestId}] [FORMATTER] Failed to parse string transcription:`, transcription);
      return `[Error: Transcription is a non-JSON string: ${transcription.substring(0, 100)}...]`;
    }
  }

  const qs = data?.questions || (Array.isArray(data) ? data : data?.data?.questions);
  if (!Array.isArray(qs)) {
    console.error(`[${requestId}] [FORMATTER] Could not find an array. Data structure:`, JSON.stringify(data));
    return "[Error: Formatter could not find an array of questions in the provided data]";
  }

  console.log(`[${requestId}] [FORMATTER] Found ${qs.length} questions to format.`);
  return qs.map((q: any, idx: number) => {
    const id = q.number || q.id || `Ref-${idx}`;
    const type = q.type || 'unknown';
    const text = q.question_text || q.question || q.text || "[No text found]";
    const opts = q.options ? ` | OPTS: ${Array.isArray(q.options) ? q.options.join(', ') : q.options}` : '';
    return `ID: ${id} | TYPE: ${type} | Q: ${text}${opts}`;
  }).join('\n');
}

async function getGeminiKey(supabase: any, requestId: string) {
  const { data, error } = await supabase.from('api_keys')
    .select('id, api_key')
    .eq('service', 'gemini')
    .eq('is_active', true)
    .or(`cooldown_until.is.null,cooldown_until.lt.${new Date().toISOString()}`)
    .order('last_used_at', { ascending: true, nullsFirst: true })
    .limit(1)
    .single();

  if (error || !data) throw new Error("No available Gemini keys (all may be on cooldown or inactive)");
  await supabase.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', data.id);
  return { id: data.id, key: data.api_key };
}

async function markKeyCooldown(supabase: any, keyId: number, requestId: string) {
  console.warn(`[${requestId}] [COOLDOWN] Marking key ID ${keyId} for 30m cooldown due to 429.`);
  // 30 minutes = 1,800,000 ms
  const cooldownTime = new Date(Date.now() + 1800000).toISOString();
  await supabase.from('api_keys').update({ cooldown_until: cooldownTime }).eq('id', keyId);
}

async function callGeminiApi(supabase: any, model: string, prompt: string | null, parts?: any[], requestId?: string, retryCount = 0): Promise<string> {
  if (retryCount >= 3) throw new Error(`Exceeded maximum retries (3) for ${model}`);

  const { id: keyId, key } = await getGeminiKey(supabase, requestId || "");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const payloadParts = parts || [{ text: prompt }];
  
  console.log(`[${requestId}] [AI_REQUEST] Model: ${model} | Retry: ${retryCount}`);

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      contents: [{ parts: payloadParts }], 
      generationConfig: { response_mime_type: "application/json" } 
    })
  });

  const data = await res.json();
  const errorMessage = data.error?.message || "";

  // 1. Handle Rate Limit (429)
  if (res.status === 429) {
    await markKeyCooldown(supabase, keyId, requestId || "");
    console.warn(`[${requestId}] [RETRY] 429 detected. Rotating key and switching model.`);
    const nextModel = model === PRIMARY_MODEL ? FALLBACK_MODEL : PRIMARY_MODEL;
    return callGeminiApi(supabase, nextModel, prompt, parts, requestId, retryCount + 1);
  }

  // 2. Handle High Demand Spikes (Immediate Retry on same key)
  if (errorMessage.toLowerCase().includes("high demand")) {
    console.warn(`[${requestId}] [RETRY] High demand spike. Retrying immediately without rotation.`);
    return callGeminiApi(supabase, model, prompt, parts, requestId, retryCount + 1);
  }

  if (!res.ok) throw new Error(errorMessage || `AI API returned ${res.status}`);
  
  const finalResponse = data.candidates?.[0]?.content?.parts?.map((p: any) => p.text || "").join('') || "";
  console.log(`[${requestId}] [AI_RAW_RESPONSE_SUCCESS] Length: ${finalResponse.length}`);
  return finalResponse;
}

(async () => {
  console.log(`[${REQUEST_ID}] [START] Worker Logic Activated for Record: ${RECORD_ID}`);
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const paths = JSON.parse(IMAGE_PATHS_RAW);

  try {
    const geminiParts: any[] = [{ text: OCR_PROMPT_TEMPLATE }];
    for (const path of paths) {
      console.log(`[${REQUEST_ID}] [STORAGE] Downloading: ${path}`);
      const { data: blob } = await supabase.storage.from('images').download(path);
      if (blob) {
        const buffer = await blob.arrayBuffer();
        geminiParts.push({ 
          inline_data: { mime_type: "image/jpeg", data: encodeBase64(buffer) } 
        });
      }
    }

    // --- PARALLEL WORLD OCR ---
    const runWorld = async (model: string, name: string) => {
      try {
        const raw = await callGeminiApi(supabase, model, null, geminiParts, REQUEST_ID);
        return { name, model, json: JSON.parse(extractJson(raw)), success: true };
      } catch (e) {
        console.error(`[${REQUEST_ID}] [${name}] OCR Failed:`, e.message);
        return { name, success: false };
      }
    };

    console.log(`[${REQUEST_ID}] [OCR_STAGE] Launching Worlds A and B...`);
    const worldAPromise = runWorld(PRIMARY_MODEL, "World_A");
    const worldBPromise = runWorld(FALLBACK_MODEL, "World_B");

    let results = [];
    const firstResult = await Promise.race([worldAPromise, worldBPromise]);
    results.push(firstResult);

    const timeoutPromise = new Promise(resolve => setTimeout(() => resolve({ timeout: true }), 60000));
    const secondResult = await Promise.race([worldAPromise === firstResult ? worldBPromise : worldAPromise, timeoutPromise]);
    if (!secondResult.timeout) results.push(secondResult);

    const successfulWorlds = results.filter(r => r.success && r.json?.confidence_score);
    if (successfulWorlds.length === 0) throw new Error("Both AI worlds failed to transcribe images.");

    const bestWorld = successfulWorlds.reduce((prev, curr) => (prev.json.confidence_score > curr.json.confidence_score) ? prev : curr);
    const ocrJson = bestWorld.json;
    console.log(`[${REQUEST_ID}] [OCR_STAGE] Winner: ${bestWorld.name} Score: ${ocrJson.confidence_score}`);

    // --- CONFIDENCE GATEKEEPER ---
    if (ocrJson.confidence_score <= 6) {
      console.warn(`[${REQUEST_ID}] REJECTED: Score ${ocrJson.confidence_score} too low.`);
      await supabase.from('processed_images').update({ status: 'low_quality' }).eq('id', RECORD_ID);
      return;
    }

    // --- SOLVER STAGE ---
    const friendlyText = formatTranscriptionForAI(ocrJson, REQUEST_ID);
    // Use the model that won the OCR race for the solver stage
    const solutionRaw = await callGeminiApi(supabase, bestWorld.model, SOLVER_PROMPT_TEMPLATE(friendlyText), undefined, REQUEST_ID);
    const solutionJson = JSON.parse(extractJson(solutionRaw));

    // Merge confidence into final payload for app announcement
    solutionJson.confidence_score = ocrJson.confidence_score;

    await supabase.from('processed_images').update({
      transcription: ocrJson,
      solution_json: solutionJson,
      status: 'completed'
    }).eq('id', RECORD_ID);

    console.log(`[${REQUEST_ID}] [FINISH] Record ${RECORD_ID} completed.`);
  } catch (err) {
    console.error(`[${REQUEST_ID}] [FATAL_ERROR]:`, err);
    await supabase.from('processed_images').update({ status: 'error' }).eq('id', RECORD_ID);
    Deno.exit(1);
  }
})();