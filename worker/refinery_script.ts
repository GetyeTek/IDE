import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

const BATCH_SIZE = 30;
const MAX_FILES = 26;
const AI_TIMEOUT = 300000; // 5 Minutes for High Thinking
const COOLDOWN_DURATION = 10 * 60 * 1000;

async function runRefinery() {
  const WORKER_ID = Deno.env.get('WORKER_ID') || '1';
  console.log(`--- REFINERY WORKER ${WORKER_ID} START ---`);
  
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  // Loop to process 5 batches per worker run to maximize runtime
  for (let batchLoop = 0; batchLoop < 5; batchLoop++) {
    console.log(`[LOOP ${batchLoop + 1}/5] Processing next available batch...`);

  try {
    // 1. Progress Tracking
    console.log('[STAGE: BOOKMARK] Checking active task...');
    let { data: progress } = await supabase
      .from('refinery_progress')
      .select('*')
      .eq('is_finished', false)
      .order('id', { ascending: true })
      .limit(1)
      .single();

    if (!progress) {
      console.log('[STAGE: INITIALIZATION] No active file. Determining next file...');
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
        console.log('All files finished. Worker exiting.');
        return;
      }

      const nextFileName = `rare_words_${nextFileNumber}.txt`;
      const { data: newProgress, error: insErr } = await supabase
        .from('refinery_progress')
        .insert({ file_path: nextFileName, last_offset: 0, is_finished: false })
        .select()
        .single();

      if (insErr) throw insErr;
      progress = newProgress;
    }

    // ATOMIC CLAIM: Increment offset immediately to "reserve" this batch for this worker
    const { data: claim, error: claimErr } = await supabase.rpc('increment_refinery_offset', { 
      row_id: progress.id, 
      amount: BATCH_SIZE 
    });

    if (claimErr || !claim?.[0]) throw new Error(`Claim failed: ${claimErr?.message}`);
    
    const currentBatchOffset = claim[0].old_offset;
    const currentFilePath = claim[0].target_file;

    console.log(`[STAGE: CLAIMED] Worker ${WORKER_ID} reserved ${currentFilePath} at offset ${currentBatchOffset}`);

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

    if (keyError || !keyRecord) throw new Error('No available Gemini keys.');
    const cleanKey = keyRecord.api_key.trim();

    // 3. Gathering Material
    const { data: fileData, error: fileError } = await supabase.storage.from('Chunks').download(currentFilePath);
    if (fileError) throw fileError;

    const text = await fileData.text();
    const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
    const batch = lines.slice(currentBatchOffset, currentBatchOffset + BATCH_SIZE);

    if (batch.length === 0) {
      console.log(`[STAGE: FINISHED] File ${currentFilePath} is empty at this offset. Marking as finished.`);
      await supabase.from('refinery_progress').update({ is_finished: true }).eq('id', progress.id);
      continue; // Move to next iteration or next file
    }

    // 4. AI Logic with Retry Wrapper
    const systemInstruction = `
    ROLE: You are the "Amharic Refinery Master," an elite linguistic engine specialized in Ethiopic script restoration, morphological analysis, and lexicographical enrichment.

    CRITICAL: Your final output MUST be a single JSON object. 
    - Do NOT include partial JSON snippets or code blocks in your thoughts.
    - If you must explain your work, use plain text only. 
    - Do NOT use curly braces {} anywhere except in the final JSON structure.

    YOUR MISSION: Process messy OCR input through these 6 STRICT SCHOLARLY PROTOCOLS and return a structured dataset.

    1. PROTOCOL: THE SPLITTER (De-cluttering)
       - ANALYZE every string for merged words. Identify impossible morphological transitions.
       - ACTION: Split them into separate valid words. (e.g., "ጨምሯልለሶስተኛ" ➔ "ጨምሯል", "ለሶስተኛ").

    2. PROTOCOL: THE JUDGE (Nonsense Removal)
       - DETECT gibberish, non-Amharic noise, and unfixable OCR errors. CRITERIA: DELETE pure Latin, pure numbers, or semantic-free noise.

    3. PROTOCOL: THE CORRECTOR (Visual Repair)
       - FIX visual OCR confusions (e.g., confusing 'ሀ' for 'ሃ' or 'ለ' for 'ሉ'). STRIP punctuation.

    4. PROTOCOL: THE LEMMATIZER (Global Citation Form)
       - MISSION: Identify the base dictionary entry (Infinitive/መነሻ ቃል). 
       - LOGIC: Do NOT simply strip prefixes. Analyze morphology globally for the true citation form.
       - EXAMPLES: "እንድናጓጉዘው" ➔ "ማጓጓዝ", "የሚመጡት" ➔ "መምጣት", "ሲመለከቱ" ➔ "መመልከት".

    5. PROTOCOL: THE TRANSLATOR (Nuance Expansion)
       - Provide comprehensive English synonyms capture the full breadth of the word.

    6. PROTOCOL: EXECUTIVE SUMMARY
       - Explain splits, discards, and "Scholarly Guesses."

    OUTPUT FORMAT (STRICT JSON ONLY):
    Return a single JSON Object. NO Markdown. "summary" MUST come AFTER the "data" array.
    {
      "data": [
        { "word": "[Cleaned]", "root": "[Citation Form]", "synonyms": [], "importance": 1-10 }
      ],
      "summary": "Reflective summary..."
    }`;

    let responseObj: { summary: string, data: any[] } | null = null;
    const MAX_RETRIES = 3;
    
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        console.log(`[STAGE: AI] Attempt ${attempt}/${MAX_RETRIES}...`);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), AI_TIMEOUT);

        const aiResp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${cleanKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              system_instruction: { parts: [{ text: systemInstruction }] },
              contents: [{ parts: [{ text: `INPUT BATCH: ${JSON.stringify(batch)}` }] }],
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

        if (aiResp.status === 429) {
          await supabase.from('api_keys').update({ cooldown_until: new Date(Date.now() + COOLDOWN_DURATION).toISOString() }).eq('id', keyRecord.id);
          throw new Error('Rate limit hit');
        }

        const result = await aiResp.json();
        if (result.error) throw new Error(`Gemini API Error: ${result.error.message}`);

        const candidate = result.candidates?.[0];
        if (!candidate) throw new Error('AI Blocked the response or returned no candidates.');
        
        console.log(`[DEBUG: AI_RESPONSE] Finish Reason: ${candidate.finishReason}`);
        const rawText = candidate.content?.parts?.map((p: any) => p.text || p.thought).filter(Boolean).join('\n').trim() || '';
        console.log('[DEBUG: PREVIEW]', rawText.substring(0, 200) + '...');

        // Targeted Reverse Search Parsing
        const lastDataKey = rawText.lastIndexOf('"data"');
        const lastClosingBrace = rawText.lastIndexOf('}');
        const startIndex = rawText.lastIndexOf('{', lastDataKey);

        if (lastDataKey === -1 || lastClosingBrace === -1 || startIndex === -1) {
          throw new Error('Could not locate valid JSON block in AI response');
        }

        const sanitizedJson = rawText.substring(startIndex, lastClosingBrace + 1)
          .replace(/[\u0000-\u001F\u007F-\u009F]/g, "")
          .replace(/,\s*([\}\]])/g, '$1');

        responseObj = JSON.parse(sanitizedJson);
        if (!responseObj?.data || !Array.isArray(responseObj.data)) throw new Error('Parsed JSON missing data array');
        
        break; // Success!

      } catch (err) {
        console.error(`Attempt ${attempt} failed: ${err.message}`);
        if (err.message.includes('Rate limit hit') || attempt === MAX_RETRIES) throw err;
        await new Promise(r => setTimeout(r, 2000 * attempt));
      }
    }

    if (!responseObj) throw new Error('AI processing failed after retries.');

    // 5. Save
    console.log(`[STAGE: SAVE] Archiving ${responseObj.data.length} words for offset ${currentBatchOffset}...`);
    const { error: saveErr } = await supabase.from('processed_words').upsert({
      source_file: currentFilePath,
      batch_index: currentBatchOffset,
      words: responseObj.data,
      summary: responseObj.summary
    }, { onConflict: 'source_file,batch_index' });

    if (saveErr) throw saveErr;

    await supabase.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', keyRecord.id);
    
    console.log(`[SUCCESS] Batch at ${currentBatchOffset} completed.`);
    } catch (err) {
      console.error(`[BATCH ERROR] ${err.message}`);
      if (err.message.includes('No available Gemini keys')) break;
    }
  }
  console.log('--- WORKER CYCLE COMPLETE ---');
}

runRefinery();