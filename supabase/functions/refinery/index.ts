import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const BATCH_SIZE = 50;
const BUCKET_NAME = 'Chunks';
const TOTAL_FILES = 26;

serve(async (req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    // 1. Get current progress
    const { data: progress } = await supabase
      .from('rare_words_progress')
      .select('*')
      .single();

    if (progress.is_finished) {
      return new Response(JSON.stringify({ message: "All files processed" }), { status: 200 });
    }

    const fileName = `rare_words_${progress.current_file_index}.txt`;

    // 2. Load Balance API Key
    // Pick the key that hasn't been used for the longest time
    const { data: apiKeyData, error: keyErr } = await supabase
      .from('api_keys')
      .select('id, api_key')
      .eq('service', 'gemini')
      .eq('is_active', true)
      .order('last_used_at', { ascending: true, nullsFirst: true })
      .limit(1)
      .single();

    if (keyErr || !apiKeyData) throw new Error("No active Gemini API keys found");

    // Update key usage timestamp immediately
    await supabase.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', apiKeyData.id);

    // 3. Fetch File from Storage
    const { data: fileData, error: storageErr } = await supabase.storage
      .from(BUCKET_NAME)
      .download(fileName);

    if (storageErr) throw new Error(`Failed to download ${fileName}: ${storageErr.message}`);

    const text = await fileData.text();
    const allWords = text.split(/\r?\n/).filter(w => w.trim().length > 0);
    
    // Slice current batch
    const batch = allWords.slice(progress.current_line_offset, progress.current_line_offset + BATCH_SIZE);
    
    if (batch.length === 0) {
      // Move to next file if this one is exhausted
      if (progress.current_file_index < TOTAL_FILES) {
        await supabase.from('rare_words_progress').update({
          current_file_index: progress.current_file_index + 1,
          current_line_offset: 0
        }).eq('id', 1);
        return new Response(JSON.stringify({ message: `Moving to file ${progress.current_file_index + 1}` }));
      } else {
        await supabase.from('rare_words_progress').update({ is_finished: true }).eq('id', 1);
        return new Response(JSON.stringify({ message: "Completed all files" }));
      }
    }

    // 4. Gemini AI Call
    const prompt = `
      You are an expert Amharic linguist. I will provide a list of 50 Amharic words that may contain typos, OCR errors, or joined words.
      Your task:
      1. Correct obvious typos.
      2. If a word is actually two or more words joined together, split them (e.g., "word1word2" -> "word1", "word2").
      3. If a word is valid as is, keep it.
      4. If a word is complete nonsense or unfixable gibberish, delete it.
      5. STRICT RULE: Return ONLY a plain list of words, one per line. No numbers, no intro text, no explanations.
      
      WORDS TO PROCESS:
      ${batch.join('\n')}
    `;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKeyData.api_key}`;
    
    const aiResponse = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1 } // Low temp for consistency
      })
    });

    const aiData = await aiResponse.json();
    
    // Stitching together multi-part responses if they exist
    const correctedText = aiData.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') || "";
    const correctedWords = correctedText.split(/\r?\n/).map((w: string) => w.trim()).filter((w: string) => w.length > 0);

    // 5. Store Results
    const records = correctedWords.map((word: string) => ({
      word,
      source_file: fileName,
      batch_index: Math.floor(progress.current_line_offset / BATCH_SIZE)
    }));

    if (records.length > 0) {
      const { error: insertErr } = await supabase.from('processed_words').insert(records);
      if (insertErr) throw insertErr;
    }

    // 6. Update Progress
    const newOffset = progress.current_line_offset + BATCH_SIZE;
    await supabase.from('rare_words_progress').update({
      current_line_offset: newOffset,
      updated_at: new Date().toISOString()
    }).eq('id', 1);

    return new Response(JSON.stringify({ 
      processed: batch.length, 
      returned: correctedWords.length,
      next_offset: newOffset 
    }), { status: 200 });

  } catch (error) {
    console.error("Function Error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
});