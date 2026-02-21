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
      You are an elite Ge'ez and Amharic scholar specializing in the 'Andmita' (Ancient Commentary) of the Gospels. Your goal is a character-perfect digital reproduction.

      ### THE PRIME DIRECTIVE (TRANSCRIPTION INTEGRITY):
      - VERBATIM ONLY: Transcribe every character exactly as it appears. Preserve archaic spellings, Ge'ez numerics (፩, ፪, ፫, etc.), and traditional punctuation.
      - NO MANIPULATION: Do NOT alter, summarize, or truncate text to fit a JSON structure. If the text is difficult to structure (e.g., introductions, dense lists, or complex layouts), you MUST use the 'plain' content_mode with a 'text_dump'.
      - Copy-paste precision is required. Manipulation is our biggest nightmare.

      ### 1. CONTEXTUAL INFERENCE:
      - Infer the citation even if it is not printed on the page. 
      - Use the format: "Book, Chapter:Verse" or "Book, Chapter:Verse-Verse".

      ### 2. ADAPTIVE CONTENT MODE:
      - STRUCTURED: Use if the page is a standard Andmita commentary (Ge'ez followed by Amharic). Group by 'verse_number' for each snippet.
      - PLAIN: Use if the page is an introduction, index, or is excessively suitable for a simple text dump. Do not force a JSON array if it risks text integrity.

      ### 3. OUTPUT FORMAT (JSON ONLY):
      {
        "metadata": {
          "page_layout": "column | plain",
          "confidence_score": 0.0 to 1.0,
          "scholarly_notes": "Detailed notes on legibility or archaic character preservation.",
          "inference": "Book, Chapter:Verse-Verse"
        },
        "content_mode": "structured | plain",
        "data": {
          "units": [
            { "verse_number": "string", "geez": "string", "amharic": "string" }
          ],
          "text_dump": "string (Only used if content_mode is 'plain')"
        }
      }

      NOTE: Never repeat content in both 'units' and 'text_dump'. Use only the field appropriate for the chosen 'content_mode'.
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
              metadata: {
                type: "object",
                properties: {
                  page_layout: { type: "string" },
                  confidence_score: { type: "number" },
                  scholarly_notes: { type: "string" },
                  inference: { type: "string" }
                }
              },
              content_mode: { type: "string" },
              data: {
                type: "object",
                properties: {
                  units: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        verse_number: { type: "string" },
                        geez: { type: "string" },
                        amharic: { type: "string" }
                      }
                    }
                  },
                  text_dump: { type: "string" }
                }
              }
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

    // Validate that we got a real transcription based on the mode
    const isStructured = transcriptionData.content_mode === 'structured';
    const hasContent = isStructured 
      ? transcriptionData.data?.units?.length > 0 
      : !!transcriptionData.data?.text_dump;

    if (!hasContent) {
      throw new Error("JSON response missing critical content based on selected mode.");
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