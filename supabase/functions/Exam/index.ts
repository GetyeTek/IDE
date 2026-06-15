import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";

const GEMINI_PROMPT = `
[PASTE THE COMPREHENSIVE PROMPT DESIGNED IN THE PREVIOUS STEP HERE]
`;

// Helper to safely convert Uint8Array to Base64 without call-stack overflows
function arrayBufferToBase64(buffer: Uint8Array): string {
  let binary = "";
  const len = buffer.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(buffer[i]);
  }
  return btoa(binary);
}

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

    // Keep an in-memory cache of downloaded PDFs during this batch to save bandwidth/time
    const pdfCache = new Map<string, Uint8Array>();

    // 3. Process each task sequentially
    for (const task of tasks) {
      let retryCount = 0;
      let success = false;
      let errorMessage = "";
      let parsedPayload = null;

      while (!success && retryCount < 3) {
        let apiKeyRecord = null;
        try {
          // Get the least-used, non-cooled-down active key
          apiKeyRecord = await getNextApiKey(supabase);
          
          // Download or retrieve source PDF bytes
          let pdfBytes = pdfCache.get(task.pdf_name);
          if (!pdfBytes) {
            const { data: fileData, error: downloadErr } = await supabase.storage
              .from("Exams")
              .download(task.pdf_name);

            if (downloadErr) throw new Error(`Storage download error: ${downloadErr.message}`);
            pdfBytes = new Uint8Array(await fileData.arrayBuffer());
            pdfCache.set(task.pdf_name, pdfBytes);
          }

          // Extract the single page needed
          const singlePagePdfBytes = await extractSinglePage(pdfBytes, task.page_index);
          const base64Pdf = arrayBufferToBase64(singlePagePdfBytes);

          // Query Gemini
          parsedPayload = await callGemini(apiKeyRecord.api_key, base64Pdf);
          success = true;

          // Track usage of the key
          await updateKeyUsage(supabase, apiKeyRecord.id);

        } catch (err: any) {
          retryCount++;
          errorMessage = err.message || "Unknown error occurred";

          if (apiKeyRecord && (err.status === 429 || errorMessage.includes("429"))) {
            // Apply a 5-minute cooldown to the key that encountered rate limits
            await cooldownKey(supabase, apiKeyRecord.id, 5);
          } else {
            // Non-429 errors or storage errors don't necessarily require a key cooldown
            break; 
          }
        }
      }

      // 4. Update the DB based on the outcome of the page processing
      if (success && parsedPayload) {
        // Write results
        const { error: resultErr } = await supabase.from("results").insert({
          progress_id: task.id,
          pdf_name: task.pdf_name,
          page_index: task.page_index,
          data: parsedPayload,
        });

        if (resultErr) {
          await supabase.from("progress").update({
            status: "failed",
            error_message: `Failed to insert result: ${resultErr.message}`,
            updated_at: new Date().toISOString(),
          }).eq("id", task.id);
        } else {
          await supabase.from("progress").update({
            status: "completed",
            error_message: null,
            updated_at: new Date().toISOString(),
          }).eq("id", task.id);
        }
      } else {
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
 * Isolates and extracts a single page from a source PDF document.
 */
async function extractSinglePage(pdfBytes: Uint8Array, pageIndex: number): Promise<Uint8Array> {
  const srcDoc = await PDFDocument.load(pdfBytes);
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
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
  
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