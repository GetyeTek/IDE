import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SB_SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(SB_URL, SB_SERVICE_ROLE);

// The Model requested (Gemini 2.5 Flash)
const GEMINI_MODEL = "gemini-2.5-flash"; 

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

    // 2. FETCH PENDING PAGE
    const { data: page, error: pageError } = await supabase
      .from('gospel_transcriptions')
      .select('*')
      .eq('status', 'pending')
      .order('page_number', { ascending: true })
      .limit(1)
      .single();

    if (pageError || !page) return new Response(JSON.stringify({ message: "No pending pages to process." }));

    // Mark as processing immediately to prevent double-work
    await supabase.from('gospel_transcriptions').update({ status: 'processing' }).eq('id', page.id);

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
      1. INTEGRITY & HONESTY: Transcribe every word exactly as written. Do not summarize, do not skip sections, and do not interpret. If the text is a Ge'ez verse followed by Amharic commentary, preserve that relationship.
      2. LAYOUT INTELLIGENCE: The layout may have inconsistent columns or nested commentary. Use your contextual understanding of Ethiopian liturgical texts to determine the correct logical reading order. 
      3. CONTEXTUAL CORRECTION: If a character is visually malformed, blurred, or faded, use your deep knowledge of Amharic grammar and Gospel context to resolve it. (e.g., distinguishing between similar-looking Fidels like 'ሀ' and 'ሃ' based on the surrounding word).
      4. NOISE FILTERING: Completely ignore and exclude:
         - Watermarks or scan artifacts.
         - Page numbers, footers, or headers.
         - Any English text unless it is part of the original manuscript.
      5. FORMATTING: Maintain paragraph breaks. Do not add any conversational filler like "Here is the text." Output ONLY the transcribed text.

      ### UNEXPECTED SCENARIOS:
      - If you encounter a badly damaged section, provide your best scholarly reconstruction based on the context of the Gospel passage.
      - If the layout is ambiguous, prioritize the flow that maintains the theological meaning of the sentence.
    `;

    // 5. CALL GEMINI API
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${keyData.api_key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inlineData: { mimeType: "application/pdf", data: base64File } }
          ]
        }],
        generationConfig: { temperature: 0.1, topP: 1, maxOutputTokens: 4096 }
      })
    });

    const result = await response.json();

    if (response.status === 429) {
        // Rate limit hit: put key on 10-minute cooldown
        const cooldown = new Date(Date.now() + 10 * 60000).toISOString();
        await supabase.from('api_keys').update({ cooldown_until: cooldown }).eq('id', keyData.id);
        await supabase.from('gospel_transcriptions').update({ status: 'pending' }).eq('id', page.id);
        throw new Error("Rate limit hit. Key put on cooldown.");
    }

    const transcribedText = result.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!transcribedText) {
      throw new Error(`AI response failed: ${JSON.stringify(result)}`);
    }

    // 6. UPDATE DATABASE & ROTATE KEY
    await supabase.from('gospel_transcriptions').update({
      content: transcribedText,
      status: 'completed',
      updated_at: new Date().toISOString()
    }).eq('id', page.id);

    // Update the key's last_used_at to move it to the back of the rotation line
    await supabase.from('api_keys').update({
      last_used_at: new Date().toISOString()
    }).eq('id', keyData.id);

    return new Response(JSON.stringify({ success: true, page: page.page_number }));

  } catch (err) {
    console.error("Transcription Error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});