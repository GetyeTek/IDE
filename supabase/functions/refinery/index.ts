import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

const BATCH_SIZE = 50;
const AI_TIMEOUT = 150000; // 2.5 minutes
const COOLDOWN_DURATION = 10 * 60 * 1000; // 10 minutes

serve(async (req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  try {
    // 1. Progress Tracking: Get the bookmark
    const { data: progress, error: progError } = await supabase
      .from('refinery_progress')
      .select('*')
      .eq('is_finished', false)
      .order('id', { ascending: true })
      .limit(1)
      .single();

    if (progError || !progress) {
      return new Response(JSON.stringify({ status: 'Finished or Idle' }), { status: 200 });
    }

    // 2. Resource Management: Pick the best API key (LRU)
    const { data: keyRecord, error: keyError } = await supabase
      .from('api_keys')
      .select('*')
      .eq('is_active', true)
      .or(`cooldown_until.is.null,cooldown_until.lt.${new Date().toISOString()}`)
      .order('last_used_at', { ascending: true, nullsFirst: true })
      .limit(1)
      .single();

    if (keyError || !keyRecord) {
      throw new Error('No available API keys or all keys in cooldown.');
    }

    // 3. Gathering Material: Fetch raw text file
    const { data: fileData, error: fileError } = await supabase.storage
      .from('Chunks')
      .download(progress.file_path);

    if (fileError) throw new Error(`File access failed: ${fileError.message}`);

    const text = await fileData.text();
    const lines = text.split(/\r?\n/);
    const batch = lines.slice(progress.last_offset, progress.last_offset + BATCH_SIZE);

    if (batch.length === 0) {
      // Mark file as finished
      await supabase.from('refinery_progress').update({ is_finished: true }).eq('id', progress.id);
      return new Response(JSON.stringify({ status: 'File exhausted' }), { status: 200 });
    }

    // 4. Cleaning Instruction (The Expert Task)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), AI_TIMEOUT);

    const prompt = `You are a scholarly Amharic linguist and OCR correction expert. 
    Process this list of raw OCR-extracted Amharic words:
    ${JSON.stringify(batch)}

    RULES:
    1. Fix OCR errors (e.g., visual character confusion like ሀ/ሃ, ለ/ሉ).
    2. De-clutter: Split merged words (e.g., "ቃሉነው" -> "ቃሉ ነው").
    3. Filter Gibberish: Remove non-Amharic strings or meaningless character sequences.
    4. Preserve Quality: Do NOT alter words that are already valid.
    5. Output ONLY a valid JSON array of strings. No conversation.`;

    try {
      const aiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${keyRecord.api_key}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: 'application/json' }
          }),
          signal: controller.signal
        }
      );

      clearTimeout(timeoutId);

      if (aiResponse.status === 429) {
        // Handle Fatigue: Set cooldown
        await supabase.from('api_keys').update({
          cooldown_until: new Date(Date.now() + COOLDOWN_DURATION).toISOString()
        }).eq('id', keyRecord.id);
        throw new Error('Rate limit hit. Key put on cooldown.');
      }

      const result = await aiResponse.json();
      const cleanedWords = JSON.parse(result.candidates[0].content.parts[0].text);

      // 5. Saving and Moving Forward
      const { error: saveError } = await supabase.from('processed_words').insert(
        cleanedWords.map((word: string) => ({
          word,
          source_file: progress.file_path
        }))
      );

      if (saveError) throw saveError;

      // Update Key Last Used
      await supabase.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', keyRecord.id);

      // Crucial: Only move bookmark after successful save
      await supabase.from('refinery_progress')
        .update({ last_offset: progress.last_offset + BATCH_SIZE })
        .eq('id', progress.id);

      return new Response(JSON.stringify({ 
        status: 'Success', 
        processed: cleanedWords.length, 
        next_offset: progress.last_offset + BATCH_SIZE 
      }), { status: 200 });

    } catch (aiErr) {
      if (aiErr.name === 'AbortError') throw new Error('AI request timed out after 2.5 minutes.');
      throw aiErr;
    }

  } catch (err) {
    console.error('Refinery Error:', err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});