import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const BATCH_SIZE = 50;
const BUCKET_NAME = 'Chunks';
const TOTAL_FILES = 26;

serve(async (req) => {
  console.log("--- REFINERY PINGED ---");
  
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    // 1. Fetch Progress
    const { data: progress, error: progErr } = await supabase
      .from('rare_words_progress')
      .select('*')
      .single();

    if (progErr) throw new Error(`Progress Fetch Error: ${progErr.message}`);
    console.log(`[STATE] File Index: ${progress.current_file_index}, Offset: ${progress.current_line_offset}`);

    if (progress.is_finished) {
      console.log("[STATE] Process already marked as finished.");
      return new Response(JSON.stringify({ message: "Finished" }), { status: 200 });
    }

    // 2. Select API Key (Load Balanced)
    const { data: apiKeyData, error: keyErr } = await supabase
      .from('api_keys')
      .select('id, api_key')
      .eq('service', 'gemini')
      .eq('is_active', true)
      .order('last_used_at', { ascending: true, nullsFirst: true })
      .limit(1)
      .single();

    if (keyErr || !apiKeyData) throw new Error("No active Gemini API keys available.");
    console.log(`[AUTH] Using API Key ID: ${apiKeyData.id}`);

    // Update key usage timestamp
    await supabase.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', apiKeyData.id);

    // 3. Fetch Source File
    const fileName = `rare_words_${progress.current_file_index}.txt`;
    console.log(`[STORAGE] Downloading: ${fileName}`);
    const { data: fileData, error: storageErr } = await supabase.storage
      .from(BUCKET_NAME)
      .download(fileName);

    if (storageErr) throw new Error(`Storage Error: ${storageErr.message}`);

    const text = await fileData.text();
    const allWords = text.split(/\r?\n/).filter(w => w.trim().length > 0);
    console.log(`[MEMORY] Total words in file: ${allWords.length}. File string length: ${text.length}`);

    const batch = allWords.slice(progress.current_line_offset, progress.current_line_offset + BATCH_SIZE);
    console.log(`[BATCH] Sliced ${batch.length} words (Offset: ${progress.current_line_offset}).`);

    if (batch.length === 0) {
      if (progress.current_file_index < TOTAL_FILES) {
        console.log("[STATE] Current file exhausted. Moving to next file.");
        await supabase.from('rare_words_progress').update({
          current_file_index: progress.current_file_index + 1,
          current_line_offset: 0
        }).eq('id', 1);
        return new Response(JSON.stringify({ status: "next_file" }));
      } else {
        console.log("[STATE] All files completed!");
        await supabase.from('rare_words_progress').update({ is_finished: true }).eq('id', 1);
        return new Response(JSON.stringify({ status: "completed_all" }));
      }
    }

    // 4. Gemini AI - Strict Prompting with JSON Schema
    console.log("[AI] Sending request to Gemini...");
    const prompt = `Task: Clean and correct this Amharic word list.
Rules:
1. Fix OCR errors (e.g., character misrecognition).
2. Split joined words (e.g., 'word1word2' -> 'word1', 'word2').
3. Remove absolute gibberish.
4. Keep valid words exactly as they are.
5. Respond ONLY with a JSON object following this schema: { "cleaned_words": [string] }

Input Words:
${batch.join(', ')}`;

    // Endpoint preserved as per instructions
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKeyData.api_key}`;
    
    // Added Timeout to prevent infinite hang
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 50000); // 50s timeout

    let aiResponse;
    try {
      aiResponse = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: "application/json"
          }
        }),
        signal: controller.signal
      });
    } catch (fetchErr) {
      if (fetchErr.name === 'AbortError') throw new Error("Gemini Request Timed Out (50s)");
      throw fetchErr;
    } finally {
      clearTimeout(timeoutId);
    }

    console.log(`[AI] Response Status: ${aiResponse.status}`);
    if (!aiResponse.ok) {
      const errorBody = await aiResponse.text();
      throw new Error(`Gemini API Error: ${aiResponse.status} - ${errorBody}`);
    }

    const aiData = await aiResponse.json();
    const rawJson = aiData.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    console.log(`[AI] Raw Response Received.`);

    const parsed = JSON.parse(rawJson);
    const cleanedWords = parsed.cleaned_words || [];
    console.log(`[AI] Successfully parsed ${cleanedWords.length} words.`);

    // 5. Store Results
    if (cleanedWords.length > 0) {
      const records = cleanedWords.map((word: string) => ({
        word: word.trim(),
        source_file: fileName,
        batch_index: Math.floor(progress.current_line_offset / BATCH_SIZE)
      }));

      const { error: insertErr } = await supabase.from('processed_words').insert(records);
      if (insertErr) throw new Error(`DB Insert Error: ${insertErr.message}`);
      console.log(`[DB] Inserted ${records.length} cleaned words.`);
    }

    // 6. Update Offset
    const newOffset = progress.current_line_offset + BATCH_SIZE;
    await supabase.from('rare_words_progress').update({
      current_line_offset: newOffset,
      updated_at: new Date().toISOString()
    }).eq('id', 1);
    
    console.log(`[SUCCESS] Progress updated to offset ${newOffset}.`);

    return new Response(JSON.stringify({ 
      success: true, 
      input: batch.length, 
      output: cleanedWords.length 
    }), { status: 200 });

  } catch (error) {
    console.error(`[FATAL ERROR]: ${error.message}`);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
});