import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SB_SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(SB_URL, SB_SERVICE_ROLE);

// The Model requested (Gemini 3.0 Flash Preview)
const GEMINI_MODEL = "gemini-3-flash-preview"; 

serve(async (req) => {
  try {
    // 1. SMART KEY ROTATION LOGIC
    // Fetch the active key that hasn't been used for the longest time
    const { data: keyData, error: keyError } = await supabase
      .from('api_keys')
      .select('id, api_key')
      .eq('service', 'gemini')
      .eq('is_active', true)
      .or(`cooldown_until.is.null,cooldown_until.lt.${new Date().toISOString()}`)
      .order('last_used_at', { ascending: true, nullsFirst: true })
      .limit(1)
      .single();

    if (keyError || !keyData) throw new Error("No available Gemini API keys found.");

    // 2. FETCH NEXT PAGE ATOMICALLY
    // Uses RPC with 'FOR UPDATE SKIP LOCKED' to prevent race conditions and recover stuck tasks
    const { data: page, error: pageError } = await supabase.rpc('get_next_gospel_page').single();

    if (pageError || !page) {
      return new Response(JSON.stringify({ message: "No pending pages to process or queue is locked." }), { status: 200 });
    }

    // 3. GET FILE FROM STORAGE
    const { data: fileBlob, error: downloadError } = await supabase.storage
      .from('gospel-pages')
      .download(page.storage_path);

    if (downloadError) throw downloadError;
    const base64File = btoa(String.fromCharCode(...new Uint8Array(await fileBlob.arrayBuffer())));

    // 4. THE COMPREHENSIVE SCHOLARLY PROMPT
    const prompt = `
      You are an elite Ge'ez and Amharic scholar and philologist specializing in the 'Andmita' (Ancient Commentary) of the Four Gospels. Your task is to perform a high-fidelity, verbatim transcription and scholarly analysis of the provided manuscript image.

      ### 1. IDENTITY & SCHOLARLY INTEGRITY:
      - Transcribe every character exactly as written. 
      - Preserve archaic Ge'ez spellings and specific character variants (e.g., distinguish between 'ቆ' and 'ቁ').
      - Do NOT "fix" fragments or add modern punctuation. Transcribe only the visual evidence.
      - Exclude noise: scan artifacts, English text, and page numbers unless they are part of the original manuscript text.

      ### 2. CONTEXTUAL INFERENCE:
      - Use your internal knowledge of the Four Gospels and the Andmita tradition to infer the Book, Chapter, and Verse range even if they are not explicitly written on this specific page.
      - Identify if the text at the very top of the page is a continuation of a sentence from the previous page.

      ### 3. STRUCTURAL MAPPING (ANDMITA RELATIONSHIP):
      - Recognize the "Cycle": In Andmita, a Ge'ez verse or phrase is usually followed by a detailed Amharic explanation.
      - Map these relationships into the 'units' array. If multiple Ge'ez phrases are explained in one paragraph, break them into separate logical units.

      ### 4. OUTPUT FORMAT (JSON ONLY):
      You must output ONLY a valid JSON object following the provided schema. 

      TEMPLATE EXAMPLE FOR YOUR REFERENCE:
      {
        "inference": {
          "book": "ማቴዎስ",
          "chapter": 5,
          "verse_range": "1-3",
          "confidence_score": 0.98
        },
        "transcription": {
          "full_page_text": "[Full top-to-bottom text here...]",
          "units": [
            {
              "verse_ref": "5:1",
              "geez_text": "ወርእዮ ሕዝበ ዓርገ ደብረ...",
              "amharic_commentary": "ሕዝቡን ባየ ጊዜ ወደ ተራራ ወጣ...",
              "is_continuation": false
            }
          ]
        },
        "scholarly_notes": "Text is clear; archaic 'ቆ' preserved."
      }

      ### 5. SCENARIO HANDLING:
      - If the page is a Table of Contents or Index: Use the 'full_page_text' for the content and set 'units' to an empty array.
      - If the page is heavily damaged: Provide your best scholarly reconstruction in 'full_page_text' and flag it in 'scholarly_notes'.
    `;

    // 5. CALL GEMINI API
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${keyData.api_key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: "application/pdf",
                data: base64File
              }
            }
          ]
        }],
        generationConfig: {
          temperature: 0.1,
          topP: 1,
          maxOutputTokens: 15000,
          response_mime_type: "application/json",
          response_schema: {
            type: "object",
            properties: {
              inference: {
                type: "object",
                properties: {
                  book: { type: "string" },
                  chapter: { type: "number" },
                  verse_range: { type: "string" },
                  confidence_score: { type: "number" }
                }
              },
              transcription: {
                type: "object",
                properties: {
                  full_page_text: { type: "string" },
                  units: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        verse_ref: { type: "string" },
                        geez_text: { type: "string" },
                        amharic_commentary: { type: "string" },
                        is_continuation: { type: "boolean" }
                      }
                    }
                  }
                }
              },
              scholarly_notes: { type: "string" }
            }
          },
          thinkingConfig: {
            includeThoughts: false,
            thinkingLevel: "MINIMAL"
          },
          mediaResolution: "MEDIA_RESOLUTION_HIGH"
        }
      })
    });

    // 5. IMMEDIATE STATUS CHECK
    if (response.status === 429) {
        const cooldown = new Date(Date.now() + 10 * 60000).toISOString();
        await Promise.all([
          supabase.from('api_keys').update({ cooldown_until: cooldown }).eq('id', keyData.id),
          supabase.from('gospel_transcriptions').update({ status: 'pending' }).eq('id', page.id)
        ]);
        throw new Error("Rate limit (429) hit. Key cooling down, page returned to queue.");
    }

    const result = await response.json();

    if (result.error || !response.ok) {
      throw new Error(`Gemini API Error: ${result.error?.message || response.statusText}`);
    }

    // Gemini returns the JSON as a string within the first part
    const candidate = result.candidates?.[0];
    const rawJsonResponse = candidate?.content?.parts?.[0]?.text;
    const finishReason = candidate?.finishReason || "UNKNOWN";

    if (!rawJsonResponse) {
      throw new Error(`AI returned empty content. Finish Reason: ${finishReason}`);
    }

    let transcriptionData;
    try {
      // 1. CLEANING: Remove markdown code blocks if present
      let cleanedJson = rawJsonResponse.replace(/```json/g, "").replace(/```/g, "").trim();
      
      // 2. EXTRACTION: If the AI added prefix/suffix text, find the first '{' and last '}'
      const firstBracket = cleanedJson.indexOf('{');
      const lastBracket = cleanedJson.lastIndexOf('}');
      
      if (firstBracket === -1 || lastBracket === -1) {
        throw new Error("No valid JSON object found in AI response.");
      }
      
      cleanedJson = cleanedJson.substring(firstBracket, lastBracket + 1);

      // 3. SANITIZATION: Replace unescaped control characters (newlines/tabs inside strings)
      // that often break JSON.parse in high-token outputs.
      cleanedJson = cleanedJson.replace(/[\u0000-\u001F]+/g, (match) => 
        match === '\n' ? '\\n' : match === '\r' ? '\\r' : ''
      );

      transcriptionData = JSON.parse(cleanedJson);
    } catch (e) {
      console.error("Raw AI Output for Debugging:", rawJsonResponse);
      throw new Error(`Failed to parse AI JSON: ${e.message}`);
    }

    // Validate that we got a real transcription before proceeding
    if (!transcriptionData.transcription?.full_page_text) {
      throw new Error("JSON response missing critical transcription field.");
    }

    // 6. UPDATE DATABASE & ROTATE KEY
    // If finishReason is not 'STOP', we mark as 'error' so the retry logic can pick it up again
    const isSuccess = finishReason === "STOP";
    await supabase.from('gospel_transcriptions').update({
      content: JSON.stringify(transcriptionData),
      status: isSuccess ? 'completed' : 'error',
      error_log: isSuccess ? null : `AI finish reason: ${finishReason}`,
      updated_at: new Date().toISOString()
    }).eq('id', page.id);

    // Update the key's last_used_at to move it to the back of the rotation line
    await supabase.from('api_keys').update({
      last_used_at: new Date().toISOString()
    }).eq('id', keyData.id);

    return new Response(JSON.stringify({ success: true, page: page.page_number }));

  } catch (err) {
    console.error("Transcription Error:", err.message);
    
    // If we have a page record, mark it as error so the RPC can manage retries
    if (typeof page !== 'undefined' && page?.id) {
      await supabase.from('gospel_transcriptions')
        .update({
          status: 'error',
          error_log: err.message,
          updated_at: new Date().toISOString()
        })
        .eq('id', page.id);
    }

    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});