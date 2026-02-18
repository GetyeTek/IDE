import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

const BATCH_SIZE = 30;
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

    const prompt = `
    ROLE: You are the "Amharic Lexicographer," an elite linguistic engine specialized in Ethiopic script restoration and enrichment.
    INPUT BATCH: ${JSON.stringify(batch)}

    Your Goal: Transform the raw input into a Structured Lexical Dataset using these STRICT PROTOCOLS:

    1. PROTOCOL: CLEANING & SPLITTING
       - SPLIT merged words (e.g., "ጨምሯልለሶስተኛ" -> "ጨምሯል", "ለሶስተኛ").
       - REMOVE gibberish/noise (e.g., "Page12", "----", "ድድድድ").
       - FIX OCR errors (visual confusions like 'ሀ' vs 'ሃ').

    2. PROTOCOL: ENRICHMENT (The Core Task)
       - For every valid word found, analyze it deeply:
         * ROOT: Extract the linguistic root (Lexeme).
         * SYNONYMS (English): Provide a comprehensive list of English meanings. If the match is high, list many nuances.
         * IMPORTANCE: Score from 1 (Archaic/Rare) to 10 (Daily/Core Vocabulary).

    3. PROTOCOL: BATCH SUMMARY
       - Write a detailed "Executive Summary" of your job on this batch.
       - Explicitly mention: Which words were split? Which were deleted? Any ambiguous words you had to guess? Any difficult morphology?

    OUTPUT FORMAT:
    Respond with a single JSON Object in this EXACT structure:
    {
      "summary": "Detailed notes on decisions made...",
      "data": [
        {
          "word": "የሚመጡት",
          "root": "መጣ",
          "synonyms": ["those who come", "comers", "approaching ones"],
          "importance": 9
        },
        ...
      ]
    }
    
    NO Markdown code blocks. Just the raw JSON object.
    `;

    const aiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${cleanKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.2,
            thinkingConfig: { includeThoughts: true, thinkingLevel: 'HIGH' }
          },
          safetySettings: [
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
          ]
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
    
    if (result.error) {
      console.error('[DEBUG: AI_ERROR_RESPONSE]', JSON.stringify(result.error));
      throw new Error(`Gemini API Error: ${result.error.message}`);
    }

    console.log('[DEBUG: AI_FULL_RESPONSE_SUCCESS]');

    const candidate = result.candidates?.[0];
    if (!candidate || !candidate.content) {
      const blockReason = result.promptFeedback?.blockReason || 'UNKNOWN';
      throw new Error(`AI Blocked the response. Reason: ${blockReason}. Check Safety Settings.`);
    }

    // Fragment Stitching
    const rawText = candidate.content.parts
      .map((part: any) => part.text)
      .filter(Boolean)
      .join('')
      .trim();

    console.log('[DEBUG: AI_STITCHED_TEXT_PREVIEW]', rawText.substring(0, 200) + '...');

    let responseObj: { summary: string, data: any[] };
    try {
      const sanitizedText = rawText.replace(/```json|```/g, '').trim();
      responseObj = JSON.parse(sanitizedText);
      
      if (!responseObj.data || !Array.isArray(responseObj.data)) {
        throw new Error('Missing "data" array in AI response');
      }
    } catch (parseErr) {
      console.error('[STAGE: PARSING] JSON Parse failed. Raw Text was:', rawText);
      throw new Error(`AI returned invalid JSON: ${parseErr.message}`);
    }

    const cleanedWords = responseObj.data;
    const summary = responseObj.summary || 'No summary provided';

    console.log(`[STAGE: AI_SUMMARY] ${summary}`);
    
    // 5. Saving (Rich Batch Mode with Upsert for idempotency)
    console.log(`[STAGE: DATABASE_SAVE] Archiving enriched batch (Size: ${cleanedWords.length}, Index: ${progress.last_offset})...`);

    const { error: saveError } = await supabase.from('processed_words').upsert({
      source_file: progress.file_path,
      batch_index: progress.last_offset,
      words: cleanedWords,
      summary: summary
    }, { onConflict: 'source_file,batch_index' });

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