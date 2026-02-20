import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  
  try {
    const { action, paths } = await req.json()
    
    if (action === 'process_staged_images') {
      // 1. Create a tracking record
      const { data: record, error: insError } = await supabase
        .from('processed_images')
        .insert([{ status: 'processing' }])
        .select().single()

      if (insError) throw insError

      // 2. Offload AI processing to background (async)
      // In a real Edge Function, we'd use a queue, but here we'll process and update status
      (async () => {
        try {
          const images = []
          for (const path of paths) {
            const { data } = await supabase.storage.from('images').download(path)
            if (data) images.push(data)
          }
          
          // CALL YOUR AI MODEL HERE WITH images[]
          // For now, simulate success:
          await supabase.from('processed_images')
            .update({ status: 'completed', solution_json: { solutions: [] } })
            .eq('id', record.id)
            
        } catch (err) {
          await supabase.from('processed_images').update({ status: 'error' }).eq('id', record.id)
        }
      })()

      return new Response(JSON.stringify({ id: record.id }), { headers: { 'Content-Type': 'application/json' } })
    }

    return new Response("Invalid Action", { status: 400 })
  } catch (e) {
    return new Response(e.message, { status: 500 })
  }
})
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

function formatTranscriptionForAI(transcription: any, requestId: string): string {
  console.log(`[${requestId}] [FORMATTER] Input type: ${typeof transcription}`);
  
  let data = transcription;

  // 1. If it's a string, try to parse it first
  if (typeof transcription === 'string') {
    try {
      data = JSON.parse(transcription);
      console.log(`[${requestId}] [FORMATTER] Successfully parsed stringified JSON.`);
    } catch (e) {
      console.error(`[${requestId}] [FORMATTER] Failed to parse string transcription:`, transcription);
      return `[Error: Transcription is a non-JSON string: ${transcription.substring(0, 100)}...]`;
    }
  }

  // 2. Locate the array of questions
  // Checks: data.questions, data.data.questions, or the object itself if it's an array
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

serve(async (req) => {
  const requestId = Math.random().toString(36).substring(7).toUpperCase();
  console.log(`[${requestId}] [START] Incoming Request: ${req.method}`);

  if (req.method === 'OPTIONS') return new Response('ok');

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const contentType = req.headers.get("content-type") || "";

    // --- JSON HANDLER (Staging Trigger or Solver Webhook) ---
    if (contentType.includes("application/json")) {
      const payload = await req.json();

      // NEW: STAGING PATTERN HANDLER
      if (payload.action === 'process_staged_images') {
        console.log(`[${requestId}] [STAGING] Processing ${payload.paths?.length} paths from storage`);
        
        const { data: record, error: insError } = await supabase
          .from('processed_images')
          .insert([{ status: 'processing' }])
          .select().single();
        if (insError) throw insError;

        // Process in background to prevent timeout
        (async () => {
          try {
            // 1. Download & Encode Images sequentially (Memory Safe)
            const geminiParts: any[] = [{ text: OCR_PROMPT_TEMPLATE }];
            for (const path of payload.paths) {
              const { data: blob } = await supabase.storage.from('images').download(path);
              if (blob) {
                const buffer = await blob.arrayBuffer();
                geminiParts.push({ 
                  inline_data: { mime_type: "image/jpeg", data: encodeBase64(buffer) } 
                });
              }
            }

            // 2. OCR Stage
            const ocrRaw = await callGeminiApi(supabase, PRIMARY_MODEL, null, geminiParts, requestId);
            const ocrJson = JSON.parse(extractJson(ocrRaw));
            
            // 3. Solver Stage (Immediate pipe)
            const friendlyText = formatTranscriptionForAI(ocrJson, requestId);
            const solutionRaw = await callGeminiApi(supabase, PRIMARY_MODEL, SOLVER_PROMPT_TEMPLATE(friendlyText), undefined, requestId);
            const solutionJson = JSON.parse(extractJson(solutionRaw));

            // 4. Update Final Result
            await supabase.from('processed_images')
              .update({ 
                transcription: ocrJson, 
                solution_json: solutionJson, 
                status: 'completed' 
              })
              .eq('id', record.id);

            console.log(`[${requestId}] [STAGING] Batch complete for record: ${record.id}`);
          } catch (err) {
            console.error(`[${requestId}] [STAGING_ERR]`, err);
            await supabase.from('processed_images').update({ status: 'error' }).eq('id', record.id);
          }
        })();

        return new Response(JSON.stringify({ id: record.id }));
      }

      // EXISTING: SOLVER WEBHOOK LOGIC
      const record = payload.record || payload;
      if (record.status === 'transcribed') {
        const friendlyText = formatTranscriptionForAI(record.transcription, requestId);
        const solutionRaw = await callGeminiApi(supabase, PRIMARY_MODEL, SOLVER_PROMPT_TEMPLATE(friendlyText), undefined, requestId);
        const solutionJson = JSON.parse(extractJson(solutionRaw));
        await supabase.from('processed_images').update({ solution_json: solutionJson, status: 'completed' }).eq('id', record.id);
        return new Response(JSON.stringify({ success: true }));
      }
      return new Response(JSON.stringify({ success: false, reason: 'Status not actionable' }));
    }

    // --- BATCH OCR STAGE (Image Upload) ---
    console.log(`[${requestId}] [OCR_STAGE] Processing FormData Images...`);
    const formData = await req.formData();
    const files = formData.getAll('file') as unknown as File[];
    
    if (files.length === 0) throw new Error("No files uploaded");

    const geminiParts: any[] = [{ text: OCR_PROMPT_TEMPLATE }];
    
    for (const file of files) {
      const buffer = await file.arrayBuffer();
      const b64 = encodeBase64(buffer);
      
      geminiParts.push({ 
        inline_data: { mime_type: file.type || "image/jpeg", data: b64 } 
      });

      const storagePath = `${Date.now()}_${file.name}`;
      supabase.storage.from('images').upload(storagePath, buffer, { contentType: file.type })
        .then(({ error }) => {
          if (error) console.error(`[${requestId}] [STORAGE_UPLOAD] Error:`, error.message);
          else console.log(`[${requestId}] [STORAGE_UPLOAD] Saved: ${storagePath}`);
        });
    }

    const ocrRaw = await callGeminiApi(supabase, PRIMARY_MODEL, null, geminiParts, requestId);
    const ocrExtracted = extractJson(ocrRaw);
    
    try {
      const ocrJson = JSON.parse(ocrExtracted);
      console.log(`[${requestId}] [OCR_STAGE] Successfully parsed OCR JSON.`);

      const { data: row, error: dbError } = await supabase.from('processed_images').insert({
          transcription: ocrJson,
          status: 'transcribed'
      }).select().single();

      if (dbError) throw dbError;
      console.log(`[${requestId}] [OCR_STAGE] Created Database Row: ${row.id}`);
      return new Response(JSON.stringify({ success: true, id: row.id }));
    } catch (parseErr) {
      console.error(`[${requestId}] [OCR_STAGE] FAILED TO PARSE AI OCR RESPONSE:`, ocrExtracted);
      throw parseErr;
    }

  } catch (err) {
    console.error(`[${requestId}] [FATAL_ERROR]:`, err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});

// --- AI FUNCTIONS ---

async function getGeminiKey(supabase: any, requestId: string) {
  // Fetch the key that hasn't been used for the longest time and isn't cooling down
  const { data, error } = await supabase.from('api_keys')
    .select('id, api_key')
    .eq('service', 'gemini')
    .eq('is_active', true)
    .or(`cooldown_until.is.null,cooldown_until.lt.${new Date().toISOString()}`)
    .order('last_used_at', { ascending: true, nullsFirst: true })
    .limit(1)
    .single();

  if (error || !data) throw new Error("No available Gemini keys (all may be on cooldown or inactive)");

  // Update last_used_at immediately to push it to the end of the rotation
  await supabase.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', data.id);
  
  return { id: data.id, key: data.api_key };
}

async function markKeyCooldown(supabase: any, keyId: number, requestId: string) {
  console.warn(`[${requestId}] [COOLDOWN] Marking key ID ${keyId} for 60s cooldown due to 429.`);
  const cooldownTime = new Date(Date.now() + 60000).toISOString();
  await supabase.from('api_keys').update({ cooldown_until: cooldownTime }).eq('id', keyId);
}

async function callGeminiApi(supabase: any, model: string, prompt: string | null, parts?: any[], requestId?: string, retryCount = 0): Promise<string> {
  if (retryCount > 5) throw new Error("Exceeded maximum key rotation retries due to persistent 429s.");

  const { id: keyId, key } = await getGeminiKey(supabase, requestId || "");
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    // Ensure we are passing parts correctly for Multimodal (Images + Text)
    const payloadParts = parts || [{ text: prompt }];
    
    console.log(`[${requestId}] [AI_REQUEST] Model: ${model} | Parts: ${payloadParts.length} | Retry: ${retryCount}`);

    const res = await fetch(url, {
      method: 'POST', // Corrected: Using POST to send the body
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        contents: [{ parts: payloadParts }], 
        generationConfig: { response_mime_type: "application/json" } 
      })
    });

  if (res.status === 429) {
    await markKeyCooldown(supabase, keyId, requestId || "");
    // If Primary fails, try Fallback with a fresh key. If Fallback fails, try Primary again with a fresh key.
    const nextModel = model === PRIMARY_MODEL ? FALLBACK_MODEL : PRIMARY_MODEL;
    console.warn(`[${requestId}] [RETRY] Key ${keyId} rate limited. Rotating to new key and model ${nextModel}...`);
    return callGeminiApi(supabase, nextModel, prompt, parts, requestId, retryCount + 1);
  }

  const data = await res.json();
  if (!res.ok) {
    console.error(`[${requestId}] [AI_RESPONSE_ERROR] Status: ${res.status}:`, JSON.stringify(data));
    throw new Error(data.error?.message || `AI API returned ${res.status}`);
  }

  const responseParts = data.candidates?.[0]?.content?.parts;
  if (!responseParts || responseParts.length === 0) {
    throw new Error("No content returned from AI");
  }
  
  const finalResponse = responseParts.map((p: any) => p.text || "").join('');
  console.log(`[${requestId}] [AI_RAW_RESPONSE_SUCCESS] Length: ${finalResponse.length}`);
  return finalResponse;
}
