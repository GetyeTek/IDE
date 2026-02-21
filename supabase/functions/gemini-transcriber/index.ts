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
      You are an elite Ge'ez and Amharic scholar specializing in the 'Andmita' (Ancient Commentary) of the Four Gospels.
      Your goal is to provide a high-fidelity, verbatim transcription of the provided image.

      ### CORE DIRECTIVES:
      1. INTEGRITY & HONESTY: Transcribe every word exactly as written. Preserve archaic spellings and specific Ge'ez characters (e.g., distinguish between 'ቆ' and 'ቁ') as they appear in the manuscript.
      2. CONTINUITY AWARENESS: This is one page of a long book. The text may start/end mid-sentence. Do NOT add missing punctuation or 'fix' fragments. Transcribe only what is visible.
      3. LAYOUT & RELATIONSHIP: Determine the correct reading order for nested commentary. If the text is a Ge'ez verse followed by Amharic commentary, preserve that relationship.
      4. CONTEXTUAL CORRECTION: If a character is blurred, use your knowledge of Amharic grammar and Gospel context to resolve it (e.g., distinguishing 'ሀ' vs 'ሃ').
      5. NOISE FILTERING: Exclude watermarks, scan artifacts, page numbers, and English text.
      6. FORMATTING: Maintain paragraph breaks. Output ONLY the transcribed text. No conversational filler.

      ### UNEXPECTED SCENARIOS:
      - Damaged sections: Provide your best scholarly reconstruction based on context.
      - Ambiguous layout: Prioritize the flow that maintains theological meaning.
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

    // Gemini 3.0 fragments responses. We join ALL text parts to fix the 'zigzag' truncation.
    const candidate = result.candidates?.[0];
    const transcribedText = candidate?.content?.parts
      ?.map(part => part.text)
      .filter(Boolean)
      .join("")
      .trim();

    const finishReason = candidate?.finishReason || "UNKNOWN";

    if (!transcribedText || transcribedText.length < 5) {
      throw new Error(`AI returned empty or truncated content. Finish Reason: ${finishReason}`);
    }

    // 6. UPDATE DATABASE & ROTATE KEY
    const isSuccess = finishReason === "STOP";
    await supabase.from('gospel_transcriptions').update({
      content: transcribedText,
      status: isSuccess ? 'completed' : 'error',
      error_log: isSuccess ? null : `Incomplete: ${finishReason}`,
      updated_at: new Date().toISOString()
    }).eq('id', page.id);

    // Update the key's last_used_at to move it to the back of the rotation line
    await supabase.from('api_keys').update({
      last_used_at: new Date().toISOString()
    }).eq('id', keyData.id);

    return new Response(JSON.stringify({ success: true, page: page.page_number }));

  } catch (err) {
    console.error("Transcription Error:", err.message);
    
    // Attempt to clear the 'processing' lock so the page can be retried
    if (typeof page !== 'undefined' && page?.id) {
      await supabase.from('gospel_transcriptions')
        .update({ status: 'error', error_log: err.message })
        .eq('id', page.id);
    }

    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});