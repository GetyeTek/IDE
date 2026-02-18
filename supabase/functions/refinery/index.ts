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

    const systemInstruction = `
    ROLE: You are the "Amharic Refinery Master," an elite linguistic engine specialized in Ethiopic script restoration, morphological analysis, and lexicographical enrichment.

    CRITICAL: Your final output MUST be a single JSON object. 
    - Do NOT include partial JSON snippets or code blocks in your thoughts.
    - If you must explain your work, use plain text only. 
    - Do NOT use curly braces {} anywhere except in the final JSON structure.

    YOUR MISSION: Process messy OCR input through these 6 STRICT SCHOLARLY PROTOCOLS and return a structured dataset.

    1. PROTOCOL: THE SPLITTER (De-cluttering)
       - ANALYZE every string for merged words. Identify impossible morphological transitions (e.g., a word-ending suffix followed immediately by a word-starting prefix).
       - ACTION: Split them into separate valid words.
       - EXAMPLE: "ጨምሯልለሶስተኛ" ➔ "ጨምሯል", "ለሶስተኛ".

    2. PROTOCOL: THE JUDGE (Nonsense Removal)
       - DETECT gibberish, non-Amharic noise, and unfixable OCR errors.
       - CRITERIA: DELETE strings that are pure Latin characters, pure numbers, or random Ethiopic characters with no semantic meaning (e.g., "ድድድድ", "ቅቅቅ").
       - DECISION: If a word cannot be corrected to a valid dictionary entry, DISCARD it.

    3. PROTOCOL: THE CORRECTOR (Visual Repair)
       - FIX visual OCR confusions based on linguistic context (e.g., confusing 'ሀ' for 'ሃ' or 'ለ' for 'ሉ'). 
       - STRIP attached punctuation (e.g., "ሰላም::" ➔ "ሰላም").

    4. PROTOCOL: THE LEMMATIZER (Global Citation Form)
       - MISSION: Identify the base dictionary entry (Infinitive/መነሻ ቃል) for every valid word.
       - LOGIC: Do NOT simply strip prefixes/suffixes from the given string. Analyze the word's morphology globally to find its true citation form.
       - EXAMPLE: "እንድናጓጉዘው" ➔ Root: "ማጓጓዝ" (To transport). 
       - EXAMPLE: "የሚመጡት" ➔ Root: "መምጣት" (To come).
       - EXAMPLE: "ሲመለከቱ" ➔ Root: "መመልከት" (To look/observe).

    5. PROTOCOL: THE TRANSLATOR (Nuance Expansion)
       - Provide comprehensive English synonyms.
       - RULE: If a word has a high semantic match or multiple nuances, list them all to capture the full breadth of the Amharic word.

    6. PROTOCOL: EXECUTIVE SUMMARY
       - Reflect on your decisions. Write a summary explaining:
         * Which words were identified as merged and split?
         * Which strings were discarded as nonsense?
         * Highlight any "Scholarly Guesses" where OCR was ambiguous but you reconstructed based on context.

    OUTPUT FORMAT (STRICT JSON ONLY):
    Return a single JSON Object. NO Markdown blocks, NO preamble. 
    CRITICAL: The "summary" field MUST come AFTER the "data" array.
    
    FORMAT STRUCTURE:
    {
      "data": [
        {
          "word": "[Cleaned Word]",
          "root": "[Citation Form/መነሻ ቃል]",
          "synonyms": ["Synonym 1", "Synonym 2"],
          "importance": 1-10
        }
      ],
      "summary": "Reflective executive summary of decisions made above..."
    }
    `;

    const userPrompt = `INPUT BATCH: ${JSON.stringify(batch)}`;

    const aiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${cleanKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemInstruction }] },
          contents: [{ parts: [{ text: userPrompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.1,
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

    const candidate = result.candidates?.[0];
    if (!candidate || !candidate.content) {
      const blockReason = result.promptFeedback?.blockReason || 'UNKNOWN';
      throw new Error(`AI Blocked the response. Reason: ${blockReason}. Check Safety Settings.`);
    }

    const finishReason = candidate.finishReason;
    console.log(`[DEBUG: AI_RESPONSE] Finish Reason: ${finishReason}`);

    // Fragment Stitching (includes thoughts if provided by model)
    const rawText = candidate.content.parts
      .map((part: any) => part.text || part.thought)
      .filter(Boolean)
      .join('\n')
      .trim();

    if (finishReason === 'MAX_TOKENS') {
      console.warn('[WARNING] AI response was truncated due to token limits.');
    }

    console.log('[DEBUG: AI_STITCHED_TEXT_PREVIEW]', rawText.substring(0, 500) + '...');

    let responseObj: { summary: string, data: any[] };
    try {
      // Step 1: Find the boundaries of the main JSON object by looking for the required 'data' key
      const lastDataKey = rawText.lastIndexOf('"data"');
      const lastClosingBrace = rawText.lastIndexOf('}');

      if (lastDataKey === -1 || lastClosingBrace === -1) {
        throw new Error('Could not locate the final JSON data block.');
      }

      // Find the opening brace that starts this specific object
      const startIndex = rawText.lastIndexOf('{', lastDataKey);
      if (startIndex === -1) throw new Error('Could not locate the start of the JSON block.');

      const jsonString = rawText.substring(startIndex, lastClosingBrace + 1);

      // Step 2: Sanitize - Remove control characters and trailing commas
      const sanitizedJson = jsonString
        .replace(/[\u0000-\u001F\u007F-\u009F]/g, "") // Control characters
        .replace(/,\s*([\}\]])/g, '$1');              // Trailing commas
      
      responseObj = JSON.parse(sanitizedJson);

      if (!responseObj.data || !Array.isArray(responseObj.data)) {
        throw new Error('The parsed object is missing the "data" array.');
      }
    } catch (parseErr) {
      console.error('[STAGE: PARSING] JSON Parse failed.');
      console.error('[FULL_RAW_OUTPUT_START]');
      console.error(rawText);
      console.error('[FULL_RAW_OUTPUT_END]');
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