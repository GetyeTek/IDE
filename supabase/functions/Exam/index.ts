import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";
import { encode as encodeBase64 } from "https://deno.land/std@0.168.0/encoding/base64.ts";

const GEMINI_PROMPT = `
You are an expert digitization assistant specializing in optical character recognition (OCR), document parsing, and educational content structuring. 

Your task is to analyze the provided image of an exam page and convert it into a structured, clean JSON object. You must correct minor spelling errors, normalize clipped words, and reconstruct partial questions where logically possible, while maintaining strict adherence to the provided JSON schema.

---

### GENERAL RULES & BEHAVIOR

1. OBJECTIVITY & HONESTY: Do not hallucinate content. If a page is simple, blank, or contains only one question, output only what is there. Do not manufacture extra questions. If the text is completely illegible, reflect this in the "quality_score" and "is_complete" fields.
2. QUESTION HEALING: If a question is slightly clipped, contains typos, or has minor missing characters due to low scan quality, use your context to "heal" (autocomplete) the text so it is grammatically correct and makes pedagogical sense. However, if a question is cut off in a way that makes its meaning impossible to determine, do not guess; transcribe what is visible and mark "is_complete": false.
3. OUTPUT FORMAT: Respond ONLY with a valid JSON object. Do not include any conversational filler, introductory text, or explanations outside the JSON block.

---

### JSON SCHEMA DEFINITION

Your output must strictly follow this JSON structure:

{
  "metadata": {
    "quality_score": 0,         // Integer (0-100). 100 = perfectly clear; 0 = completely illegible.
    "has_diagrams": false,      // Boolean. True if there are drawings, graphs, charts, or geometric shapes.
    "diagrams_desc": "",        // String. Brief description of the diagrams. Use empty string "" if none.
    "year": "",                 // String. The year the paper was prepared (if found in headers/footers), else "".
    "university": "",           // String. The institution/university name (if found), else "".
    "term": "",                 // String. The type of exam (e.g., "Final", "Midterm", "Test 1", "Assignment"), else "".
    "is_complete": true,        // Boolean. False if questions are cut off, run onto the next page, or refer to missing pages.
    "completeness_notes": ""    // String. Explain what is missing or clipped if is_complete is false, else "".
  },
  "questions": [
    {
      "num": "",                // String. The label/number of the question (e.g., "1", "Q2", "Part A").
      "type": "",               // String. Must be one of the CLASSIFICATION types listed below.
      "text": "",               // String. The main body of the question, instruction, or passage.
      "elements": []            // Array of strings. Use this for options, sub-items, or matching lists (see rules below).
    }
  ]
}

---

### CLASSIFICATION & ELEMENT RULES

Classify every question on the page into one of these exact types and format its "elements" array accordingly:

1. "true_false"
   - Use for statement-based questions asking for True/False, Yes/No, or Correct/Incorrect.
   - Leave "elements" empty or omit it.

2. "matching"
   - Use when items in one column must be paired with items in another.
   - Use the "elements" array to list the columns clearly. 
   - Example format: ["Column A: 1. DNA, 2. RNA", "Column B: A. Ribose, B. Deoxyribose"]

3. "multiple_choice"
   - Use for questions with predefined answer choices.
   - Use the "elements" array to list the choices.
   - Example format: ["A. Choice 1", "B. Choice 2", "C. Choice 3"]

4. "fill_in_the_blank"
   - Use for blank-space completion questions.
   - If there is a provided word-bank or list of options for the blanks, put those options in the "elements" array. Otherwise, keep "elements" empty.

5. "workout" or "short_answer"
   - Use for calculations, derivations, or open-ended written answers.
   - If the main task has sub-questions, steps, or multi-part options (e.g., "Calculate: A. The velocity, B. The acceleration"), put those sub-tasks in the "elements" array.
   - Example format: ["A. Find the initial value of X.", "B. Calculate the rate of change."]

6. "reading_comprehension"
   - Use when a passage of text is provided followed by one or more related questions.
   - Put the entire passage in the "text" field.
   - Put all associated comprehension questions (including their individual options if they are multiple choice) into the "elements" array as individual strings.
   - Example format: ["Q1. Why did the author...? Options: A..., B...", "Q2. What is the main idea...?"]

7. "other"
   - Use only if a question type absolutely does not fit any of the categories above.

---

### EXAMPLES OF EXPECTED BEHAVIOR

#### Scenario A: A page with simple, clear content
If a page has only one clear Multiple Choice question, do not invent others.
Input image shows: "1. What is 2 + 2? A. 3, B. 4"
Expected Output:
{
  "metadata": {
    "quality_score": 95,
    "has_diagrams": false,
    "diagrams_desc": "",
    "year": "",
    "university": "",
    "term": "",
    "is_complete": true,
    "completeness_notes": ""
  },
  "questions": [
    {
      "num": "1",
      "type": "multiple_choice",
      "text": "What is 2 + 2?",
      "elements": ["A. 3", "B. 4"]
    }
  ]
}

#### Scenario B: Clipped/Damaged text that can be healed
Input image shows: "2. The cap_tal of Fra_ce is: A. L_ndon B. Par_s"
Expected Output (Healed):
{
  "questions": [
    {
      "num": "2",
      "type": "multiple_choice",
      "text": "The capital of France is:",
      "elements": ["A. London", "B. Paris"]
    }
  ]
}

#### Scenario C: Severe damage / Un-healable clipping
Input image shows: "3. Explain the relationship between..." and the rest of the page is torn off.
Expected Output:
{
  "metadata": {
    "quality_score": 40,
    "has_diagrams": false,
    "diagrams_desc": "",
    "year": "",
    "university": "",
    "term": "",
    "is_complete": false,
    "completeness_notes": "Question 3 is severely cut off; the rest of the text is missing from the bottom of the page."
  },
  "questions": [
    {
      "num": "3",
      "type": "workout",
      "text": "Explain the relationship between [text missing/truncated]",
      "elements": []
    }
  ]
}
`;

serve(async (req) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // 1. Fetch up to 10 pending tasks
    const { data: tasks, error: fetchErr } = await supabase
      .from("progress")
      .select("*")
      .eq("status", "pending")
      .order("id", { ascending: true })
      .limit(10);

    if (fetchErr) throw fetchErr;
    if (!tasks || tasks.length === 0) {
      return new Response(JSON.stringify({ message: "No pending tasks found." }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    }

    // 2. Lock the tasks immediately to 'processing' to prevent race conditions
    const taskIds = tasks.map((t) => t.id);
    await supabase
      .from("progress")
      .update({ status: "processing", updated_at: new Date().toISOString() })
      .in("id", taskIds);

    // Keep caches of downloaded PDFs and parsed documents during this batch to save bandwidth/CPU
    const pdfCache = new Map<string, Uint8Array>();
    const pdfDocCache = new Map<string, PDFDocument>();

    // 3. Process each task sequentially
    // 3. Process each task sequentially
    for (const task of tasks) {
      console.log(`[Task ${task.id}] Starting processing for "${task.pdf_name}" (Page index ${task.page_index})...`);
      let retryCount = 0;
      let success = false;
      let errorMessage = "";
      let parsedPayload = null;

      while (!success && retryCount < 3) {
        let apiKeyRecord = null;
        try {
          // Get the least-used, non-cooled-down active key
          apiKeyRecord = await getNextApiKey(supabase);
          console.log(`[Task ${task.id}] Attempt ${retryCount + 1}/3 using Key ID ${apiKeyRecord.id}`);
          
          // Check cache for fully parsed PDFDocument object first
          let srcDoc = pdfDocCache.get(task.pdf_name);
          if (!srcDoc) {
            console.log(`[Task ${task.id}] PDF "${task.pdf_name}" not cached. Downloading from storage...`);
            let pdfBytes = pdfCache.get(task.pdf_name);
            if (!pdfBytes) {
              const { data: fileData, error: downloadErr } = await supabase.storage
                .from("Exams")
                .download(task.pdf_name);

              if (downloadErr) throw new Error(`Storage download error: ${downloadErr.message}`);
              pdfBytes = new Uint8Array(await fileData.arrayBuffer());
              pdfCache.set(task.pdf_name, pdfBytes);
            }
            console.log(`[Task ${task.id}] Parsing PDF "${task.pdf_name}"...`);
            srcDoc = await PDFDocument.load(pdfBytes);
            pdfDocCache.set(task.pdf_name, srcDoc);
          } else {
            console.log(`[Task ${task.id}] Found parsed PDF "${task.pdf_name}" in execution cache.`);
          }

          // Extract the single page needed using the pre-parsed PDF Document
          console.log(`[Task ${task.id}] Extracting page index ${task.page_index}...`);
          const singlePagePdfBytes = await extractSinglePage(srcDoc, task.page_index);
          const base64Pdf = encodeBase64(singlePagePdfBytes);
          console.log(`[Task ${task.id}] Page extracted successfully (${singlePagePdfBytes.byteLength} bytes). Encoding complete.`);

          // Query Gemini
          console.log(`[Task ${task.id}] Sending request to Gemini...`);
          parsedPayload = await callGemini(apiKeyRecord.api_key, base64Pdf);
          console.log(`[Task ${task.id}] Gemini successfully parsed content for page ${task.page_index}.`);
          success = true;

          // Track usage of the key
          await updateKeyUsage(supabase, apiKeyRecord.id);

        } catch (err: any) {
          retryCount++;
          errorMessage = err.message || "Unknown error occurred";
          console.warn(`[Task ${task.id}] Attempt ${retryCount}/3 failed. Error: ${errorMessage}`);

          if (apiKeyRecord && (err.status === 429 || errorMessage.includes("429"))) {
            console.warn(`[Task ${task.id}] Rate limit (429) detected on Key ID ${apiKeyRecord.id}. Cooling down key for 5 minutes.`);
            // Apply a 5-minute cooldown to the key that encountered rate limits
            await cooldownKey(supabase, apiKeyRecord.id, 5);
          } else {
            // Non-429 errors or storage errors don't necessarily require a key cooldown
            console.log(`[Task ${task.id}] Non-429 error encountered. Skipping further retries for this attempt window.`);
            break; 
          }
        }
      }

      // 4. Update the DB based on the outcome of the page processing
      if (success && parsedPayload) {
        console.log(`[Task ${task.id}] Inserting result payload into database...`);
        // Write results
        const { error: resultErr } = await supabase.from("results").insert({
          progress_id: task.id,
          pdf_name: task.pdf_name,
          page_index: task.page_index,
          data: parsedPayload,
        });

        if (resultErr) {
          console.error(`[Task ${task.id}] Failed to insert result into database: ${resultErr.message}`);
          await supabase.from("progress").update({
            status: "failed",
            error_message: `Failed to insert result: ${resultErr.message}`,
            updated_at: new Date().toISOString(),
          }).eq("id", task.id);
        } else {
          console.log(`[Task ${task.id}] Result successfully saved. Marking progress as completed.`);
          await supabase.from("progress").update({
            status: "completed",
            error_message: null,
            updated_at: new Date().toISOString(),
          }).eq("id", task.id);
        }
      } else {
        console.error(`[Task ${task.id}] Task permanently failed after maximum retries. Error: ${errorMessage}`);
        // Mark task as failed
        await supabase.from("progress").update({
          status: "failed",
          error_message: errorMessage || "Failed after maximum retries.",
          updated_at: new Date().toISOString(),
        }).eq("id", task.id);
      }
    }

    return new Response(JSON.stringify({ message: "Batch processing completed successfully." }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });

  } catch (globalErr: any) {
    return new Response(JSON.stringify({ error: globalErr.message }), {
      headers: { "Content-Type": "application/json" },
      status: 500,
    });
  }
});

/**
 * Isolates and extracts a single page from an already parsed PDF document instance.
 */
async function extractSinglePage(srcDoc: PDFDocument, pageIndex: number): Promise<Uint8Array> {
  const pageCount = srcDoc.getPageCount();
  if (pageIndex < 0 || pageIndex >= pageCount) {
    throw new Error(`Page index ${pageIndex} is out of bounds for PDF containing ${pageCount} pages.`);
  }

  const newDoc = await PDFDocument.create();
  const [copiedPage] = await newDoc.copyPages(srcDoc, [pageIndex]);
  newDoc.addPage(copiedPage);
  return await newDoc.save();
}

/**
 * Queries Gemini API utilizing standard multimodal payload design.
 */
async function callGemini(apiKey: string, base64Pdf: string): Promise<any> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${apiKey}`;
  
  const payload = {
    contents: [
      {
        parts: [
          {
            inlineData: {
              mimeType: "application/pdf",
              data: base64Pdf
            }
          },
          {
            text: GEMINI_PROMPT
          }
        ]
      }
    ],
    generationConfig: {
      responseMimeType: "application/json"
    }
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    const errObj = { status: response.status, message: `Gemini API Error: ${errorText}` };
    throw errObj;
  }

  const responseData = await response.json();
  const jsonText = responseData.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!jsonText) {
    throw new Error("Gemini returned an empty response or invalid structure.");
  }

  return JSON.parse(jsonText);
}

/**
 * Fetches the next available Gemini API key based on least used timestamp,
 * respecting active status and active cooldown configurations.
 */
async function getNextApiKey(supabase: any): Promise<any> {
  const nowStr = new Date().toISOString();
  
  const { data, error } = await supabase
    .from("api_keys")
    .select("*")
    .eq("service", "gemini")
    .eq("is_active", true)
    .or(`cooldown_until.is.null,cooldown_until.lt.${nowStr}`)
    .order("last_used_at", { ascending: true, nullsFirst: true })
    .limit(1);

  if (error || !data || data.length === 0) {
    throw new Error("No active, non-cooldown Gemini API keys available.");
  }
  return data[0];
}

/**
 * Updates the last used timestamp of the designated key to maintain rotation order.
 */
async function updateKeyUsage(supabase: any, keyId: number): Promise<void> {
  await supabase
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", keyId);
}

/**
 * Restricts key usage by configuring a temporary cooldown window.
 */
async function cooldownKey(supabase: any, keyId: number, durationMinutes: number): Promise<void> {
  const cooldownLimit = new Date();
  cooldownLimit.setMinutes(cooldownLimit.getMinutes() + durationMinutes);
  
  await supabase
    .from("api_keys")
    .update({ cooldown_until: cooldownLimit.toISOString() })
    .eq("id", keyId);
}