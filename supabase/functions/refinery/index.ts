import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

const BATCH_SIZE = 50;
const MAX_FILES = 26;
const AI_TIMEOUT = 150000;
const COOLDOWN_DURATION = 10 * 60 * 1000;

serve(async (req) => {
  console.log('--- REFINERY START ---');
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  try {
    // 1. Progress Tracking & Auto-Initialization
    console.log('[STAGE: BOOKMARK] Checking for current active task...');
    let { data: progress, error: progError } = await supabase
      .from('refinery_progress')
      .select('*')
      .eq('is_finished', false)
      .order('id', { ascending: true })
      .limit(1)
      .single();

    if (!progress) {
      console.log('[STAGE: INITIALIZATION] No active task. Determining next file in sequence...');
      const { data: lastTask } = await supabase
        .from('refinery_progress')
        .select('file_path')
        .order('id', { ascending: false })
        .limit(1)
        .single();

      let nextFileNumber = 1;
      if (lastTask) {
        const match = lastTask.file_path.match(/rare_words_(\d+)\.txt/);
        if (match) nextFileNumber = parseInt(match[1]) + 1;
      }

      if (nextFileNumber > MAX_FILES) {
        console.log('[STAGE: INITIALIZATION] All 26 files processed. Stopping.');
        return new Response(JSON.stringify({ status: 'All files finished' }), { status: 200 });
      }

      const nextFileName = `rare_words_${nextFileNumber}.txt`;
      console.log(`[STAGE: INITIALIZATION] Creating bookmark for: ${nextFileName}`);
      
      const { data: newProgress, error: insertError } = await supabase
        .from('refinery_progress')
        .insert({ file_path: nextFileName, last_offset: 0, is_finished: false })
        .select()
        .single();

      if (insertError) throw new Error(`Initialization failed: ${insertError.message}`);
      progress = newProgress;
    }

    console.log(`[STAGE: BOOKMARK] Active File: ${progress.file_path} | Offset: ${progress.last_offset}`);

    // 2. Resource Management
    const { data: keyRecord, error: keyError } = await supabase
      .from('api_keys')
      .select('*')
      .eq('service', 'gemini')
      .eq('is_active', true)
      .or(`cooldown_until.is.null,cooldown_until.lt.${new Date().toISOString()}`)
      .order('last_used_at', { ascending: true, nullsFirst: true })
      .limit(1)
      .single();

    if (keyError || !keyRecord) throw new Error('No available Gemini API keys found. Ensure service is set to "gemini" in the database.');
    
    const cleanKey = keyRecord.api_key.trim();
    console.log(`[STAGE: KEY_ROTATION] Using key ID: ${keyRecord.id} (Starts with: ${cleanKey.substring(0, 4)}...)`);

    // 3. Gathering Material
    const { data: fileData, error: fileError } = await supabase.storage
      .from('Chunks')
      .download(progress.file_path);

    if (fileError) throw new Error(`Storage error: ${fileError.message}`);

    const text = await fileData.text();
    const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
    const batch = lines.slice(progress.last_offset, progress.last_offset + BATCH_SIZE);

    console.log(`[STAGE: BATCHING] Lines in file: ${lines.length}. Batch size: ${batch.length}`);

    if (batch.length === 0) {
      console.log(`[STAGE: BATCHING] File ${progress.file_path} completed.`);
      await supabase.from('refinery_progress').update({ is_finished: true }).eq('id', progress.id);
      return new Response(JSON.stringify({ status: 'File completed' }), { status: 200 });
    }

    // 4. Expert Cleaning Prompt
    console.log('[STAGE: AI_CLEANING] Sending to Gemini 3 Flash...');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), AI_TIMEOUT);

    const prompt = `You are a scholarly Amharic linguist. 
    TASK: Clean these OCR words. 
    DATA: ${JSON.stringify(batch)}
    RULES:
    1. FIX OCR errors (visual similarity).
    2. SPLIT merged words (e.g., 'ጨምሯልለሶስተኛ' -> ['ጨምሯል', 'ለሶስተኛ']).
    3. FILTER non-Amharic gibberish.
    4. PRESERVE already correct words.
    5. OUTPUT: Return ONLY a raw JSON array of strings. No commentary.`;

    const aiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${cleanKey}`,
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
      await supabase.from('api_keys').update({ cooldown_until: new Date(Date.now() + COOLDOWN_DURATION).toISOString() }).eq('id', keyRecord.id);
      throw new Error('Rate limit hit.');
    }

    const result = await aiResponse.json();
    console.log('[DEBUG: AI_FULL_RESPONSE]', JSON.stringify(result));

    if (!result.candidates || !result.candidates[0] || !result.candidates[0].content) {
      const reason = result.promptFeedback?.blockReason || 'UNKNOWN_REASON';
      throw new Error(`AI Response Malformed or Blocked. Reason: ${reason}`);
    }

    const rawText = result.candidates[0].content.parts[0].text;
    console.log('[DEBUG: AI_RAW_TEXT]', rawText);

    let cleanedWords: string[] = [];
    try {
      // Strip markdown code blocks if present
      const sanitizedText = rawText.replace(/```json|```/g, '').trim();
      cleanedWords = JSON.parse(sanitizedText);
    } catch (parseErr) {
      console.error('[STAGE: PARSING] JSON Parse failed. Raw Text was:', rawText);
      throw new Error(`AI returned invalid JSON: ${parseErr.message}`);
    }
    
    console.log(`[STAGE: PARSING] Received ${cleanedWords.length} words.`);

    // 5. Saving (Only after successful AI response)
    const { error: saveError } = await supabase.from('processed_words').insert(
      cleanedWords.map((word: string) => ({
        word,
        source_file: progress.file_path
      }))
    );

    if (saveError) throw saveError;

    // 6. Update State
    const nextOffset = progress.last_offset + BATCH_SIZE;
    await Promise.all([
      supabase.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', keyRecord.id),
      supabase.from('refinery_progress').update({ last_offset: nextOffset }).eq('id', progress.id)
    ]);

    console.log(`--- SUCCESS: File ${progress.file_path} reached offset ${nextOffset} ---`);
    return new Response(JSON.stringify({ status: 'Success', processed: cleanedWords.length }), { status: 200 });

  } catch (err) {
    console.error(`--- FAILED: ${err.message} ---`);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});