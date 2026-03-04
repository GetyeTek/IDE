import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

const BATCH_SIZE = 30;
const MAX_FILES = 12;
const AI_TIMEOUT = 180000; // 3 Minutes (Increased for high-demand spikes)
const COOLDOWN_DURATION = 10 * 60 * 1000;
const STALE_CLAIM_THRESHOLD = 30 * 60 * 1000;

async function runRefinery() {
  const WORKER_ID = Deno.env.get('WORKER_ID') || '1';
  console.log(`--- REFINERY WORKER ${WORKER_ID} START ---`);
  
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  // GHOST HUNTING: Unlock batches stuck in 'processing' state for too long
  const staleTime = new Date(Date.now() - STALE_CLAIM_THRESHOLD).toISOString();
  const { count: unlocked } = await supabase
    .from('refinery_batches')
    .update({ status: 'failed' })
    .eq('status', 'processing')
    .lt('updated_at', staleTime);
  
  if (unlocked) console.log(`[GHOST HUNTER] Unlocked ${unlocked} stale batches.`);

  let cachedText = "";
  let cachedPath = "";

  // Loop to process 5 batches per worker run to maximize runtime
  for (let batchLoop = 0; batchLoop < 5; batchLoop++) {
    console.log(`[LOOP ${batchLoop + 1}/5] Processing next available batch...`);

    let batchRecordId = 0;
    let currentFilePath = "";
    let currentBatchOffset = 0;
    let batchStart = Date.now();
    let totalAiLatency = 0;
    let errorType = "";
    let lastErrorMessage = "";
    let finalAttemptCount = 0;

    try {
      // 1. Progress Tracking
      console.log('[STAGE: BOOKMARK] Fetching unfinished files...');
      let { data: unfinishedFiles } = await supabase
        .from('refinery_progress')
        .select('*')
        .eq('is_finished', false)
        .order('id', { ascending: true });

      if (!unfinishedFiles || unfinishedFiles.length === 0) {
        console.log('[STAGE: INITIALIZATION] Initializing file sequence...');
        for (let i = 1; i <= MAX_FILES; i++) {
          const fname = `rare_words_${i}.txt`;
          await supabase.from('refinery_progress').upsert({ file_path: fname }, { onConflict: 'file_path' });
        }
        const { data: refreshed } = await supabase.from('refinery_progress').select('*').eq('is_finished', false).order('id', { ascending: true });
        unfinishedFiles = refreshed || [];
      }

      // HARD BOUNDARY FILTER: Ignore any records that might exist for files 13-26
      unfinishedFiles = unfinishedFiles.filter(f => {
        const match = f.file_path.match(/rare_words_(\d+)\.txt/);
        return match && parseInt(match[1]) <= MAX_FILES;
      });

      if (unfinishedFiles.length === 0) {
        console.log('--- ALL FILES FULLY PROCESSED ---');
        Deno.exit(0);
      }

      // 2. STATEFUL CLAIM (Search through unfinished files)
      let claim = null;
      let claimErr = null;

      const { data: claimData, error: rpcErr } = await supabase.rpc('claim_refinery_batch', { 
        p_worker_id: WORKER_ID, 
        p_batch_size: BATCH_SIZE 
      });
      
      claim = claimData?.[0];
      claimErr = rpcErr;

      if (claimErr) {
        errorType = "RPC_ERROR";
        throw new Error(`Claim RPC failed: ${claimErr.message}`);
      }

      if (!claim) {
        console.log("[WAITING] No available batches. Checking if any files can be closed...");
        // If the RPC returns nothing, it might mean the current file is full of 'pending' jobs.
        // We move to the next loop iteration which will re-fetch unfinished files.
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }
      
      currentBatchOffset = claim.current_offset;
      currentFilePath = claim.target_file;
      batchRecordId = Number(claim.batch_record_id);

      // GATEKEEPER: Prevent processing if RPC returns a file beyond the allowed 1-12 range
      const fileMatch = currentFilePath.match(/rare_words_(\d+)\.txt/);
      const fileNum = fileMatch ? parseInt(fileMatch[1]) : 999;
      if (fileNum > MAX_FILES) {
        console.log(`[BOUNDARY REACHED] Claimed ${currentFilePath}, but limit is ${MAX_FILES}. Stopping loop.`);
        break;
      }
      
      if (claim.should_close_file) {
          console.log(`[CLEANUP] Closing ${currentFilePath}.`);
          await supabase.from('refinery_progress').update({ is_finished: true }).eq('file_path', currentFilePath);
          continue;
      }

    console.log(`[STAGE: CLAIMED] Worker ${WORKER_ID} reserved batch ${batchRecordId} (${currentFilePath} at ${currentBatchOffset})`);

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

    if (keyError || !keyRecord) {
      errorType = "NO_API_KEY";
      throw new Error('No available Gemini keys.');
    }
    const cleanKey = keyRecord.api_key.trim();

    // 3. Gathering Material (with Caching & Timeout)
    if (currentFilePath !== cachedPath) {
      console.log(`[STAGE: DOWNLOAD] Cache miss. Downloading ${currentFilePath}...`);
      const storageController = new AbortController();
      const storageTimeout = setTimeout(() => storageController.abort(), 30000);

      const { data: fileData, error: fileError } = await supabase.storage.from('Chunks').download(currentFilePath);
      clearTimeout(storageTimeout);

      if (fileError) {
        errorType = "STORAGE_DOWNLOAD_ERROR";
        throw fileError;
      }

      cachedText = await fileData.text();
      cachedPath = currentFilePath;
    } else {
      console.log(`[STAGE: CACHE] Using cached version of ${currentFilePath}`);
    }

    const lines = cachedText.split(/\r?\n/).filter(l => l.trim().length > 0);
    const batch = lines.slice(currentBatchOffset, currentBatchOffset + BATCH_SIZE);
    
    // HUMAN-READABLE TRACKING
    const batchNumber = Math.floor(currentBatchOffset / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(lines.length / BATCH_SIZE);
    const batchLabel = `Words ${currentBatchOffset + 1}-${currentBatchOffset + batch.length} (Batch ${batchNumber}/${totalBatches})`;

    if (batch.length === 0) {
      console.log(`[STAGE: EMPTY] File ${currentFilePath} is empty at offset ${currentBatchOffset}. Marking batch as completed to prevent re-fetch.`);
      // If the batch is empty, we still save a placeholder so the Gap-Filler knows we checked it
      await supabase.from('processed_words').upsert({
        source_file: currentFilePath,
        batch_index: currentBatchOffset,
        words: [],
        summary: "End of file reached or empty chunk."
      }, { onConflict: 'source_file,batch_index' });
      
      await supabase.from('refinery_batches').update({ status: 'completed' }).eq('id', batchRecordId);
      continue; 
    }

    // 4. AI Logic with Retry Wrapper
    const systemInstruction = `
    ROLE: You are the "Amharic Refinery Master," an elite linguistic engine specialized in Ethiopic script restoration, morphological analysis, and lexicographical enrichment.

    CRITICAL: Your final output MUST be a single JSON object. 
    - Do NOT include partial JSON snippets or code blocks in your thoughts.
    - If you must explain your work, use plain text only. 
    - Do NOT use curly braces {} anywhere except in the final JSON structure.

    YOUR MISSION: Process messy OCR input through these 6 STRICT SCHOLARLY PROTOCOLS and return a structured dataset.
    QUALITY GATE: Do NOT feel obligated to include every input word. If a word provides no semantic meaning or functional value to a dictionary, IGNORE IT. Do not fill the JSON with low-value words just to meet a count.

    1. PROTOCOL: THE SPLITTER (De-cluttering)
       - ANALYZE every string for merged words. Identify impossible morphological transitions.
       - ACTION: Split them into separate valid words. (e.g., "ጨምሯልለሶስተኛ" ➔ "ጨምሯል", "ለሶስተኛ").

    2. PROTOCOL: THE JUDGE (Nonsense Removal)
       - DETECT gibberish and unfixable visual OCR noise. 
       - CRITERIA: If a word is uncorrectable nonsense or carries no functional/semantic meaning, DISCARD it. (Note: The source is already cleaned of Latin/Numbers).

    3. PROTOCOL: THE CORRECTOR (Visual Repair)
       - FIX visual OCR confusions (e.g., confusing 'ሀ' for 'ሃ' or 'ለ' for 'ሉ'). STRIP punctuation.

    4. PROTOCOL: THE LEMMATIZER (Global Citation Form)
       - MISSION: Identify the base dictionary entry (Infinitive/መነሻ ቃል). 
       - LOGIC: Do NOT simply strip prefixes. Analyze morphology globally for the true citation form.
       - EXAMPLES: "እንድናጓጉዘው" ➔ "ማጓጓዝ", "የሚመጡት" ➔ "መምጣት", "ሲመለከቱ" ➔ "መመልከት".

    5. PROTOCOL: THE TRANSLATOR (Nuance Expansion)
       - Provide comprehensive English synonyms capture the full breadth of the word.

    6. PROTOCOL: THE GRAMMARIAN (Linguistic Tagging)
       - Identify the MAJOR category for the Part of Speech (POS).
       - CONSTRAINT: Use ONLY these groups: Noun, Verb, Adjective, Adverb, Pronoun, Preposition, Conjunction. 
       - STRICT: Do NOT include morphological sub-details, tenses, or descriptions (e.g., Use 'Verb', NOT 'Verb (Relative Perfect)').

    7. PROTOCOL: THE FILTER (Size Constraint)
       - CRITICAL: Discard any word or root that consists of only a single character. Amharic words must be at least 2 characters long to be included in the dataset.

    8. PROTOCOL: EXECUTIVE SUMMARY
       - Explain splits, discards, and "Scholarly Guesses."

    OUTPUT FORMAT (STRICT JSON ONLY):
    Return a single JSON Object. NO Markdown. "summary" MUST come AFTER the "data" array.
    {
      "data": [
        { "word": "[Cleaned]", "root": "[Citation Form]", "pos": "[Part of Speech]", "synonyms": [], "importance": 1-10 }
      ],
      "summary": "Reflective summary..."
    }`;

    let responseObj: { summary: string, data: any[] } | null = null;
    const MAX_RETRIES = 3;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      finalAttemptCount = attempt;
      const attemptStart = Date.now();
      try {
        console.log(`[STAGE: AI] Attempt ${attempt}/${MAX_RETRIES} starting...`);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), AI_TIMEOUT);

        const aiResp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${cleanKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              system_instruction: { parts: [{ text: systemInstruction }] },
              contents: [{ parts: [{ text: `INPUT BATCH: ${JSON.stringify(batch)}` }] }],
              generationConfig: {
                responseMimeType: 'application/json',
                temperature: 0.1
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
        const duration = Date.now() - attemptStart;
        
        if (!aiResp.ok) {
          errorType = `HTTP_${aiResp.status}`;
          const errRaw = await aiResp.text().catch(() => 'No body');
          console.error(`[RAW ERROR RESPONSE] ${errRaw}`);

          if (aiResp.status === 429) {
            console.warn(`[RATE LIMIT] 429 encountered after ${duration}ms`);
            await supabase.from('api_keys').update({ cooldown_until: new Date(Date.now() + COOLDOWN_DURATION).toISOString() }).eq('id', keyRecord.id);
            throw new Error(`Gemini API Rate Limit (429): ${errRaw}`);
          }
          throw new Error(`Gemini API ${aiResp.status}: ${errRaw}`);
        }

        console.log(`[PERF] AI Request received response in ${duration}ms`);
        const result = await aiResp.json();
        if (result.error) {
          errorType = "API_ERROR";
          throw new Error(`Gemini API Error: ${result.error.message}`);
        }

        totalAiLatency += (Date.now() - attemptStart);
        const candidate = result.candidates?.[0];
        if (!candidate) throw new Error('AI Blocked the response or returned no candidates.');

        console.log(`[DEBUG: AI_RESPONSE] Finish Reason: ${candidate.finishReason}`);
        
        // 1. EXTRACT CONTENT
        const actualText = candidate.content?.parts?.filter((p: any) => p.text).map((p: any) => p.text).join('\n').trim();

        if (!actualText) throw new Error('AI returned no actual content text.');

        // 2. STAGED RECOVERY SIEVE
        const sanitize = (val: string) => {
          let sanitized = val
            .replace(/[\u0000-\u001F\u007F-\u009F]/g, "") // Remove control characters
            .replace(/,\s*([\}\]])/g, '$1');           // Fix trailing commas
          
          // AUTO-REPAIR TRUNCATION: If it ends in a word/number/quote but no brace, try to close it
          if (!sanitized.endsWith('}') && !sanitized.endsWith(']')) {
             if (sanitized.includes('"data": [')) {
                console.warn('[REPAIR] Attempting to close truncated JSON array...');
                sanitized += ' ] }';
             }
          }
          return sanitized;
        };

        let parsed = null;
        
        // STAGE 1: Direct Parse of Cleaned Text
        try {
          parsed = JSON.parse(sanitize(actualText));
          console.log('[PARSE: STAGE 1] Direct match successful.');
        } catch (e) {
          // STAGE 2: Greedy Extraction
          const greedyMatch = actualText.match(/\{[\s\S]*\}/);
          if (greedyMatch) {
            try {
              parsed = JSON.parse(sanitize(greedyMatch[0]));
              console.log('[PARSE: STAGE 2] Greedy extraction successful.');
            } catch (e2) {
              // STAGE 3: Outside-In Sieve (Staged recovery)
              console.warn('[PARSE: STAGE 3] Attempting iterative sieve recovery...');
              const starts = [...actualText.matchAll(/\{/g)].map(m => m.index || 0);
              const ends = [...actualText.matchAll(/\}/g)].map(m => m.index || 0).reverse();

              sieveLoop:
              for (const s of starts) {
                for (const e of ends) {
                  if (e > s) {
                    try {
                      const candidateStr = actualText.substring(s, e + 1);
                      parsed = JSON.parse(sanitize(candidateStr));
                      console.log(`[PARSE: STAGE 3] Sieve found valid block at range ${s}-${e}`);
                      break sieveLoop;
                    } catch (err) { continue; }
                  }
                }
              }
            }
          }
        }

        if (!parsed) {
          console.error('[CRITICAL PARSE FAIL] Raw Content:', actualText);
          errorType = "JSON_PARSE_EXHAUSTED";
          throw new Error('All parsing stages failed to extract valid JSON.');
        }

        responseObj = parsed;
        if (!responseObj?.data || !Array.isArray(responseObj.data)) throw new Error('Parsed JSON missing data array');

        // PROGRAMMATIC FILTER: Ensure no single-letter entries pass through
        const initialCount = responseObj.data.length;
        responseObj.data = responseObj.data.filter(item => {
          const wordValid = item.word && item.word.trim().length > 1;
          const rootValid = item.root && item.root.trim().length > 1;
          return wordValid && rootValid;
        });

        if (responseObj.data.length < initialCount) {
          console.log(`[CLEANUP] Programmatically removed ${initialCount - responseObj.data.length} single-letter noise entries.`);
        }

        break; // Success!

      } catch (err) {
        const duration = Date.now() - attemptStart;
        const isTimeout = err.name === 'AbortError' || (err instanceof DOMException && err.name === 'AbortError');
        
        lastErrorMessage = err.message;
        if (isTimeout) errorType = "TIMEOUT";
        else if (err.message.includes('429')) errorType = "RATE_LIMIT";
        else if (!errorType) errorType = "UNKNOWN";

        console.error(`[AI FAIL] Attempt ${attempt} failed: ${errorType} (${duration}ms)`);

        if (errorType === 'RATE_LIMIT' || attempt === MAX_RETRIES) break;
        await new Promise(r => setTimeout(r, 2000 * attempt));
      }
    }

    if (!responseObj) throw new Error('AI processing failed after retries.');

        // 5. Save (Includes Input-Output Ledger)
    console.log(`[STAGE: SAVE] Archiving ${responseObj.data.length} words for ${batchLabel}...`);
    const { error: saveErr } = await supabase.from('processed_words').upsert({
      source_file: currentFilePath,
      batch_index: currentBatchOffset,
      batch_number: batchNumber,
      batch_label: batchLabel,
      input_words: batch,
      words: responseObj.data,
      summary: responseObj.summary
    }, { onConflict: 'source_file,batch_index' });

    if (saveErr) throw saveErr;

    // LOG STATS ON SUCCESS
    await supabase.from('refinery_stats').insert({
        batch_record_id: batchRecordId, 
        worker_id: WORKER_ID, 
        source_file: currentFilePath,
        batch_index: currentBatchOffset, 
        batch_number: batchNumber,
        batch_label: batchLabel,
        attempts: finalAttemptCount, 
        total_duration_ms: Date.now() - batchStart,
        ai_latency_ms: totalAiLatency, 
        input_chars: JSON.stringify(batch).length, 
        input_words: batch.length, 
        input_data: batch, 
        output_words: responseObj.data.length, 
        status: 'success'
    });

    await supabase.from('refinery_batches').update({ status: 'completed' }).eq('id', batchRecordId);
    await supabase.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', keyRecord.id);
    console.log(`[SUCCESS] Batch ${batchRecordId} done in ${Date.now() - batchStart}ms`);

    } catch (err) {
      console.error(`[BATCH ERROR] ${err.message}`);
      
      if (batchRecordId !== 0) {
        // Determine final error classification
        let finalErrorType = errorType;
        if (!finalErrorType) {
          if (err.name === 'AbortError') finalErrorType = "TIMEOUT";
          else if (err.message.includes("fetch")) finalErrorType = "NETWORK_ERROR";
          else finalErrorType = "UNHANDLED_EXCEPTION";
        }

        await supabase.from('refinery_stats').insert({
            batch_record_id: batchRecordId, 
            worker_id: WORKER_ID, 
            source_file: currentFilePath,
            batch_index: currentBatchOffset, 
            status: 'failed', 
            error_type: finalErrorType,
            error_message: err.message || lastErrorMessage,
            total_duration_ms: Date.now() - batchStart,
            attempts: finalAttemptCount,
            input_words: typeof batch !== 'undefined' ? batch.length : 0
        });
        await supabase.from('refinery_batches').update({ status: 'failed' }).eq('id', batchRecordId);
      }

      if (err.message.includes('No available Gemini keys')) break;
    }
  } // End of batchLoop
  console.log('--- WORKER CYCLE COMPLETE ---');
}

runRefinery();