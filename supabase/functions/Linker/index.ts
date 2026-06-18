import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ==========================================
// CONFIGURATION DECLARATIONS
// ==========================================
const TARGET_BOOK_ID = "38953d3b-7740-4e97-9634-66434e53f024";
const TARGET_COURSE_ID = "d7719a06-b6c4-4bf2-8d81-a0c99a52461b";
const GEMINI_MODEL = "gemini-3.1-flash-lite-preview"; 

const BATCH_SIZE = 10;           // Number of parallel requests/threads
const QUESTIONS_PER_BATCH = 5;   // Questions mapped per request (Total: 50 questions per run)

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, accept-encoding",
};

serve(async (req) => {
  // CORS Preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log(`[START] Executing mapping run for Course: ${TARGET_COURSE_ID}, Book: ${TARGET_BOOK_ID}`);

    // ==========================================
    // 1. RETRIEVE TEXTBOOK PAGES
    // ==========================================
    const { data: pages, error: pagesError } = await supabase
      .from("book_pages")
      .select("page_key, content_json, page_number")
      .eq("book_id", TARGET_BOOK_ID)
      .order("page_number", { ascending: true });

    if (pagesError) throw pagesError;
    if (!pages || pages.length === 0) {
      throw new Error(`No pages found in book_pages for Book ID: ${TARGET_BOOK_ID}`);
    }

    // Append sequential index tracking onto each content block of the page
    const formattedPages = pages.map((page) => {
      // Safely handle raw array extraction
      const content = Array.isArray(page.content_json) ? page.content_json : [];
      
      const indexedContent = content.map((item: any, idx: number) => {
        // Construct a clean item to preserve tokens while keeping the EXACT index position.
        // This ensures the Gemini response perfectly aligns with the original DB array.
        const cleanedItem: any = { 
          index: idx 
        };
        
        // Pass only the textual payload required for mapping context
        if (item.type) cleanedItem.type = item.type;
        if (item.body) cleanedItem.body = item.body;
        
        return cleanedItem;
      });

      return {
        page_key: page.page_key,
        content: indexedContent,
      };
    });

    // ==========================================
    // 2. RETRIEVE UNPROCESSED QUESTIONS
    // ==========================================
    // Pull active questions tied to this course
    const { data: allQuestions, error: qError } = await supabase
      .from("questions")
      .select(`
        id,
        text,
        options,
        section_id,
        sections!inner (
          id,
          exam_id,
          exams!inner (
            id,
            course_id
          )
        )
      `)
      .eq("sections.exams.course_id", TARGET_COURSE_ID);

    if (qError) throw qError;
    if (!allQuestions || allQuestions.length === 0) {
      return new Response(JSON.stringify({ message: "No questions found for this course." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Identify which questions have already been completed or are locked in mapping run
    const { data: existingMappings, error: mError } = await supabase
      .from("question_book_mappings")
      .select("question_id, status")
      .eq("book_id", TARGET_BOOK_ID);

    if (mError) throw mError;

    const lockedQuestionIds = new Set(
      existingMappings
        ?.filter((m) => m.status === "completed" || m.status === "processing")
        .map((m) => m.question_id) || []
    );

    // Filter down to strictly pending/unmapped questions
    const pendingQuestions = allQuestions.filter((q) => !lockedQuestionIds.has(q.id));

    if (pendingQuestions.length === 0) {
      return new Response(JSON.stringify({ message: "All questions are already successfully mapped." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Restrict processing batch limits
    const questionsToProcess = pendingQuestions.slice(0, BATCH_SIZE * QUESTIONS_PER_BATCH);
    console.log(`[QUEUE] Processing queue loaded: ${questionsToProcess.length} pending questions.`);

    // ==========================================
    // 3. SET TEMPORARY PROCESSING LOCKS
    // ==========================================
    const lockPayload = questionsToProcess.map((q) => ({
      question_id: q.id,
      book_id: TARGET_BOOK_ID,
      status: "processing",
      processed_at: new Date().toISOString(),
    }));

    const { error: lockError } = await supabase
      .from("question_book_mappings")
      .upsert(lockPayload, { onConflict: "question_id,book_id" });

    if (lockError) throw lockError;

    // Split questions into batches of 5
    const chunksOfQuestions = [];
    for (let i = 0; i < questionsToProcess.length; i += QUESTIONS_PER_BATCH) {
      chunksOfQuestions.push(questionsToProcess.slice(i, i + QUESTIONS_PER_BATCH));
    }

    // ==========================================
    // 4. PARALLEL EXECUTION PIPELINE
    // ==========================================
    await Promise.all(
      chunksOfQuestions.map(async (chunk) => {
        await processChunkWithGemini(supabase, chunk, formattedPages);
      })
    );

    return new Response(
      JSON.stringify({
        success: true,
        message: `Finished pipeline run.`,
        processed_count: questionsToProcess.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error(`[FATAL] Pipeline Exception: ${error.message}`);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});

// ==========================================
// CORE WORKER PROCESSOR
// ==========================================
async function processChunkWithGemini(supabaseClient: any, chunk: any[], formattedPages: any[]): Promise<void> {
  const maxRetries = 3;
  let attempt = 0;

  while (attempt < maxRetries) {
    let leasedKeyObj = null;

    try {
      leasedKeyObj = await leaseApiKey(supabaseClient);
    } catch (err: any) {
      await markChunkAsFailed(supabaseClient, chunk, `No active API keys available: ${err.message}`);
      return;
    }

    try {
      const responseJson = await callGeminiApi(leasedKeyObj.api_key, chunk, formattedPages);
      await saveMappingResults(supabaseClient, chunk, responseJson);
      return; // Execution succeeded, safely exit loop
    } catch (err: any) {
      attempt++;
      console.error(`[WORKER RETRY] Attempt ${attempt} failed with API Key ID ${leasedKeyObj.id}: ${err.message}`);

      // Handle 429 Quota limits or network throttling and apply key cooldown immediately
      if (
        err.status === 429 || 
        err.message.includes("429") || 
        err.message.toLowerCase().includes("quota") || 
        err.message.toLowerCase().includes("rate limit")
      ) {
        await applyKeyCooldown(supabaseClient, leasedKeyObj.id);
      }

      if (attempt >= maxRetries) {
        await markChunkAsFailed(supabaseClient, chunk, `Exceeded maximum API call retries. Last error: ${err.message}`);
      }
    }
  }
}

// ==========================================
// ROUND-ROBIN KEY LEASING ENGINE
// ==========================================
async function leaseApiKey(supabaseClient: any): Promise<any> {
  // Call the atomic database function to securely lock an available key
  const { data, error } = await supabaseClient.rpc("lease_gemini_api_key");

  if (error) {
    throw new Error(`RPC Error fetching API key: ${error.message}`);
  }
  
  if (!data || data.length === 0) {
    throw new Error("No active Gemini API keys available (all may be cooling down or in use).");
  }

  return data[0];
}

async function applyKeyCooldown(supabaseClient: any, keyId: any): Promise<void> {
  // Put key on a 5-minute cooldown
  const resumeTime = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  await supabaseClient
    .from("api_keys")
    .update({ cooldown_until: resumeTime })
    .eq("id", keyId);
  console.warn(`[THROTTLED] API Key ID ${keyId} placed on rate-limit cooldown until ${resumeTime}`);
}

// ==========================================
// GEMINI HTTP INVOCATION ENGINE
// ==========================================
async function callGeminiApi(apiKey: string, chunk: any[], formattedPages: any[]): Promise<any> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const promptQuestions = chunk.map((q) => ({
    question_id: q.id,
    text: q.text,
    options: q.options || [],
  }));

  const systemInstructions = `
You are an expert mapping system. Your role is to map multi-choice exam questions back to their exact source pages and content blocks inside a textbook.

CRITICAL DIRECTIVES:
1. The textbook JSON is structured as an array of pages. Each page has a "page_key" and a "content" array of blocks. The narrative textbook text to match against is stored inside the "body" key of these blocks.
2. Validate whether the knowledge required to answer each question exists in the textbook. If you encounter a question containing specific real-world scenarios or examples NOT found in the text, DO NOT immediately reject it. Instead, deduce and generalize: find the page and block that explains the underlying concept, rule, or definition needed to answer it.
3. If the core concept exists, set "is_valid": true. You MUST retrieve the correct "page_key", the specific "content_index" (the integer 'index' value of the block inside that page), and output a "snippet" containing the matching theoretical textbook context from the "body" key.
4. If the underlying concept is completely unrelated, genuinely missing from the book, or the question covers an entirely different topic, set "is_valid": false and write a detailed "reason". Do not force a match if the foundational concept isn't there.
5. Ignore layout blocks (like spacers or headers with no "body" property) during your matching evaluation.
6. Do NOT guess, interpolate, or invent index numbers. The "content_index" must match the precise pre-injected 'index' integer of the correct block on that page.
7. You must process each question strictly and map each output back to its pre-provided UUID "question_id".

OUTPUT FORMAT REQUIREMENTS:
Return ONLY a valid, single JSON object carrying the mapped values. Do NOT wrap the JSON inside markdown code fence blocks like \`\`\`json. Match the following structure exactly:
{
  "mappings": [
    {
      "question_id": "string",
      "is_valid": boolean,
      "page_key": "string",
      "content_index": number,
      "snippet": "string",
      "reason": "string"
    }
  ]
}
  `;

  const promptText = `
SYSTEM INSTRUCTIONS: ${systemInstructions}

TEXTBOOK JSON PAGES (WITH INJECTED INDEX KEYS):
${JSON.stringify(formattedPages, null, 2)}

INPUT QUESTIONS TO MATCH (BATCH OF 5):
${JSON.stringify(promptQuestions, null, 2)}
  `;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: promptText }] }],
      generationConfig: {
        responseMimeType: "application/json",
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    const errorObj = new Error(`Gemini API Error: ${response.status} - ${errorText}`);
    (errorObj as any).status = response.status;
    throw errorObj;
  }

  const responseData = await response.json();
  const rawText = responseData.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!rawText) {
    throw new Error("Gemini returned an empty text response.");
  }

  try {
    return JSON.parse(rawText.trim());
  } catch {
    throw new Error(`Failed to parse Gemini's output as JSON. Output received: ${rawText}`);
  }
}

// ==========================================
// RESULTS DB RECORDERS
// ==========================================
async function saveMappingResults(supabaseClient: any, chunk: any[], responseJson: any): Promise<void> {
  const mappings = responseJson.mappings || [];
  const updatePromises = chunk.map(async (q) => {
    const match = mappings.find((m: any) => m.question_id === q.id);

    const record: any = {
      question_id: q.id,
      book_id: TARGET_BOOK_ID,
      processed_at: new Date().toISOString(),
    };

    if (match) {
      record.status = "completed";
      record.is_valid = match.is_valid === true;
      record.page_key = match.page_key || null;
      record.content_index = match.content_index !== undefined ? match.content_index : null;
      record.snippet = match.snippet || null;
      record.error_message = match.is_valid === false ? (match.reason || "Model flagged question as invalid") : null;
    } else {
      record.status = "failed";
      record.error_message = "Gemini failed to output a matching entry for this question ID in the array.";
    }

    await supabaseClient
      .from("question_book_mappings")
      .upsert(record, { onConflict: "question_id,book_id" });
  });

  await Promise.all(updatePromises);
}

async function markChunkAsFailed(supabaseClient: any, chunk: any[], errorMessage: string): Promise<void> {
  const updatePromises = chunk.map(async (q) => {
    await supabaseClient.from("question_book_mappings").upsert(
      {
        question_id: q.id,
        book_id: TARGET_BOOK_ID,
        status: "failed",
        error_message: errorMessage,
        processed_at: new Date().toISOString(),
      },
      { onConflict: "question_id,book_id" }
    );
  });

  await Promise.all(updatePromises);
}