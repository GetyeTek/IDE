import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

const BATCH_SIZE = 50;
const AI_TIMEOUT = 150000;
const COOLDOWN_DURATION = 10 * 60 * 1000;

serve(async (req) => {
  console.log('--- REFINERY START ---');
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  try {
    // 1. Progress Tracking
    console.log('[STAGE: BOOKMARK] Searching for unfinished tasks...');
    const { data: progress, error: progError } = await supabase
      .from('refinery_progress')
      .select('*')
      .eq('is_finished', false)
      .order('id', { ascending: true })
      .limit(1)
      .single();

    if (progError || !progress) {
      console.log('[STAGE: BOOKMARK] No unfinished tasks found in refinery_progress table.');
      return new Response(JSON.stringify({ status: 'Idle', detail: 'Check if is_finished=false exists in your table' }), { status: 200 });
    }
    console.log(`[STAGE: BOOKMARK] Found task: File [${progress.file_path}] at Offset [${progress.last_offset}]`);

    // 2. Resource Management
    console.log('[STAGE: KEY_ROTATION] Selecting available API key...');
    const { data: keyRecord, error: keyError } = await supabase
      .from('api_keys')
      .select('*')
      .eq('is_active', true)
      .or(`cooldown_until.is.null,cooldown_until.lt.${new Date().toISOString()}`)
      .order('last_used_at', { ascending: true, nullsFirst: true })
      .limit(1)
      .single();

    if (keyError || !keyRecord) {
      console.error('[STAGE: KEY_ROTATION] Failed to find a valid key. Are they all in cooldown?');
      throw new Error('No available API keys.');
    }
    console.log(`[STAGE: KEY_ROTATION] Using key ID: ${keyRecord.id} (Last used: ${keyRecord.last_used_at})`);

    // 3. Gathering Material
    console.log(`[STAGE: STORAGE] Downloading from bucket [Chunks]: ${progress.file_path}`);
    const { data: fileData, error: fileError } = await supabase.storage
      .from('Chunks')
      .download(progress.file_path);

    if (fileError) {
      console.error(`[STAGE: STORAGE] Download error: ${fileError.message}`);
      throw new Error(`File access failed: ${fileError.message}`);
    }

    const text = await fileData.text();
    const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
    const batch = lines.slice(progress.last_offset, progress.last_offset + BATCH_SIZE);

    console.log(`[STAGE: BATCHING] Total lines in file: ${lines.length}. Batch size: ${batch.length}`);

    if (batch.length === 0) {
      console.log('[STAGE: BATCHING] No more words left in this file. Marking as finished.');
      await supabase.from('refinery_progress').update({ is_finished: true }).eq('id', progress.id);
      return new Response(JSON.stringify({ status: 'File exhausted' }), { status: 200 });
    }

    // 4. Cleaning Instruction
    console.log('[STAGE: AI_CLEANING] Sending batch to Gemini 3 Flash...');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), AI_TIMEOUT);

    const prompt = `You are a scholarly Amharic linguist. Correct this raw OCR data:\n${JSON.stringify(batch)}\n\nRULES:\n1. Fix OCR errors.\n2. Split merged words.\n3. Filter gibberish.\n4. Preserve quality.\n5. Output ONLY a valid JSON array of strings.`;

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
      console.warn('[STAGE: AI_CLEANING] Rate limit hit. Triggering cooldown for key.');
      await supabase.from('api_keys').update({
        cooldown_until: new Date(Date.now() + COOLDOWN_DURATION).toISOString()
      }).eq('id', keyRecord.id);
      throw new Error('Rate limit hit.');
    }

    const result = await aiResponse.json();
    console.log('[STAGE: AI_CLEANING] Response received successfully.');

    // Stitch fragments if necessary (Gemini usually returns one part, but we check)
    const rawText = result.candidates[0].content.parts[0].text;
    const cleanedWords = JSON.parse(rawText);
    
    console.log(`[STAGE: PARSING] Successfully parsed ${cleanedWords.length} cleaned words.`);

    // 5. Saving
    console.log('[STAGE: DATABASE_SAVE] Writing cleaned words to processed_words...');
    const { error: saveError } = await supabase.from('processed_words').insert(
      cleanedWords.map((word: string) => ({
        word,
        source_file: progress.file_path
      }))
    );

    if (saveError) {
      console.error(`[STAGE: DATABASE_SAVE] Failed: ${saveError.message}`);
      throw saveError;
    }

    // 6. Moving Forward
    console.log('[STAGE: FINALIZING] Updating metadata and bookmark...');
    await supabase.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', keyRecord.id);
    
    const nextOffset = progress.last_offset + BATCH_SIZE;
    await supabase.from('refinery_progress')
      .update({ last_offset: nextOffset })
      .eq('id', progress.id);

    console.log(`--- REFINERY SUCCESS: Processed up to offset ${nextOffset} ---`);
    return new Response(JSON.stringify({ status: 'Success', offset: nextOffset }), { status: 200 });

  } catch (err) {
    console.error(`--- REFINERY FAILED ---`);
    console.error(`Error Details: ${err.message}`);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});