import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

const AI_TIMEOUT = 180000;
const COOLDOWN_DURATION = 10 * 60 * 1000;

async function runChunkRefinery() {
  const WORKER_ID = Deno.env.get('WORKER_ID') || 'chunk_worker_1';
  console.log(`--- REFINERY 2.0 WORKER ${WORKER_ID} START ---`);
  
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  for (let cycle = 0; cycle < 5; cycle++) {
    let chunkRecordId = 0;
    let currentPath = "";
    let batchStart = Date.now();

    try {
      // 1. CLAIM SEQUENTIAL CHUNK
      const { data: claimData, error: claimErr } = await supabase.rpc('claim_chunk_batch', { 
        p_worker_id: WORKER_ID 
      });

      if (claimErr) throw new Error(`Claim RPC failed: ${claimErr.message}`);
      if (!claimData || claimData.length === 0) {
        console.log("[FINISHED] No more chunks in queue.");
        break;
      }

      const chunk = claimData[0];
      chunkRecordId = chunk.id;
      currentPath = chunk.chunk_path;
      console.log(`[STAGE: CLAIMED] Reserved ${currentPath} (Attempt ${chunk.retry_count + 1})`);

      // 2. GET API KEY
      const { data: keyRecord, error: keyError } = await supabase
        .from('api_keys')
        .select('*')
        .eq('service', 'gemini')
        .eq('is_active', true)
        .or(`cooldown_until.is.null,cooldown_until.lt.${new Date().toISOString()}`)
        .order('last_used_at', { ascending: true, nullsFirst: true })
        .limit(1).single();

      if (keyError || !keyRecord) throw new Error('No active Gemini keys.');
      const cleanKey = keyRecord.api_key.trim();

      // 3. DOWNLOAD CHUNK CONTENT
      const { data: fileData, error: dlErr } = await supabase.storage
        .from('refined-chunks')
        .download(currentPath);
      if (dlErr) throw dlErr;

      const text = await fileData.text();
      const batch = text.split(/\r?\n/).filter(l => l.trim().length > 0);
      let finalParsed = null;

      // --- TIER 1: TACTICAL LOOP (3 Internal Attempts) ---
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          console.log(`[STAGE: AI] ${currentPath} - Session Attempt ${attempt}/3...`);
          console.log(`[DEBUG] Sending ${batch.length} words: ${batch.slice(0, 5).join(', ')}${batch.length > 5 ? '...' : ''}`);
          
          const systemInstruction = `
    ROLE: You are the "Amharic Refinery Master," an elite linguistic engine specialized in Ethiopic script restoration, morphological analysis, and lexicographical enrichment.

    CRITICAL: Your final output MUST be a single JSON object. 
    - Do NOT include partial JSON snippets or code blocks in your thoughts.
    - If you must explain your work, use plain text only. 
    - Do NOT use curly braces {} anywhere except in the final JSON structure.

    YOUR MISSION: Process messy OCR input through these 8 STRICT SCHOLARLY PROTOCOLS and return a structured dataset.

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
       - EXAMPLES: "እንድናጓጉዘው" ➔ "ማጓጓዝ", "የሚመጡት" ➔ "መምጣት", "ሲመለከቱ" ➔ "መመልከት".

    5. PROTOCOL: THE TRANSLATOR (Nuance Expansion)
       - Provide comprehensive English synonyms capture the full breadth of the word.

    6. PROTOCOL: THE GRAMMARIAN (Linguistic Tagging)
       - Identify the Part of Speech (POS) for the word (e.g., Noun, Verb, Adjective, Adverb, Conjunction, Preposition).

    7. PROTOCOL: THE FILTER (Size Constraint)
       - CRITICAL: Discard any word or root that consists of only a single character. Amharic words must be at least 2 characters long to be included in the dataset.

    8. PROTOCOL: EXECUTIVE SUMMARY
       - Reflect on your decisions. Explain splits, discards, and "Scholarly Guesses."

    OUTPUT FORMAT (STRICT JSON ONLY):
    Return a single JSON Object. NO Markdown. "summary" MUST come AFTER the "data" array.
    {
      "data": [
        { "word": "[Cleaned]", "root": "[Citation Form]", "pos": "[Part of Speech]", "synonyms": [], "importance": 1-10 }
      ],
      "summary": "Reflective summary..."
    }
    `;

          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), AI_TIMEOUT);

          const aiResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${cleanKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              system_instruction: { parts: [{ text: systemInstruction }] },
              contents: [{ parts: [{ text: `INPUT BATCH: ${JSON.stringify(batch)}` }] }],
              generationConfig: { responseMimeType: 'application/json', temperature: 0.1, thinkingConfig: { includeThoughts: true, thinkingLevel: 'HIGH' } },
              safetySettings: [{ category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' }, { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' }, { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' }, { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }]
            }),
            signal: controller.signal
          });
          clearTimeout(timeoutId);

          if (aiResp.status === 429) {
            await supabase.from('api_keys').update({ cooldown_until: new Date(Date.now() + COOLDOWN_DURATION).toISOString() }).eq('id', keyRecord.id);
            throw new Error('API_RATE_LIMIT');
          }

          const result = await aiResp.json();
          const candidate = result.candidates?.[0];

          // --- FORENSICS BLOCK: Capture everything if response is empty or blocked ---
          if (!candidate || !candidate.content || !candidate.content.parts) {
            const stopReason = candidate?.finishReason || "NO_CANDIDATE";
            const feedback = result.promptFeedback ? JSON.stringify(result.promptFeedback) : "No Feedback";
            const safety = candidate?.safetyRatings ? JSON.stringify(candidate.safetyRatings) : "No Ratings";
            const apiErr = result.error ? JSON.stringify(result.error) : "None";

            const forensicLog = `Stop: ${stopReason} | Feedback: ${feedback} | Safety: ${safety} | API_Err: ${apiErr}`;
            console.error(`[FORENSICS] ${currentPath}: ${forensicLog}`);

            await supabase.from('refinery_stats').insert({
              worker_id: WORKER_ID,
              source_file: currentPath,
              status: 'failed',
              error_message: forensicLog,
              input_data: batch, // Save words even on failure
              input_words: batch.length,
              raw_output: JSON.stringify(result)
            });

            throw new Error(`AI_SILENCE: ${stopReason}`);
          }

          let actualText = candidate.content.parts?.filter((p: any) => p.text).map((p: any) => p.text).join('').trim();
          if (!actualText) throw new Error('AI response body is empty.');

          if (candidate.finishReason === 'MAX_TOKENS' && !actualText.endsWith('}')) {
            if (actualText.includes('"data":') && !actualText.includes(']')) actualText += ']}';
            if (!actualText.endsWith('}')) actualText += '}';
          }

          // SANITIZER: Handles control chars, trailing commas, and the AI's double-double quote error
          const sanitize = (val: string) => {
            return val
              .replace(/[\u0000-\u001F\u007F-\u009F]/g, "") 
              .replace(/""/g, '"')                       
              .replace(/,\s*([\}\]])/g, '$1');           
          };

          let sieveError = "";
          
          // TIER 1: Direct Parse
          try { 
            const p = JSON.parse(sanitize(actualText)); 
            if (p?.data && Array.isArray(p.data)) finalParsed = p;
          } catch (e) { sieveError += `[Direct: ${e.message}] `; }

          // TIER 2: RECURSIVE BRACE EXHAUSTION (The "Original Robustness")
          if (!finalParsed) {
            const starts = [...actualText.matchAll(/\{/g)].map(m => m.index || 0);
            const ends = [...actualText.matchAll(/\}/g)].map(m => m.index || 0).reverse();

            sieveLoop: for (const s of starts) {
              for (const e of ends) {
                if (e > s) {
                  try {
                    const candidateStr = actualText.substring(s, e + 1);
                    const p = JSON.parse(sanitize(candidateStr));
                    if (p?.data && Array.isArray(p.data)) {
                      finalParsed = p;
                      console.log(`[SIEVE] Success at range ${s}-${e}`);
                      break sieveLoop;
                    }
                  } catch (err) { continue; }
                }
              }
            }
          }

          if (!finalParsed) sieveError += "[Exhaustive Sieve: No valid data block found among all brace pairs]";

          if (finalParsed?.data && Array.isArray(finalParsed.data)) break;
          else {
            console.error(`[SIEVE FAILURE] ${currentPath}: ${sieveError}`);
            // Log raw output to DB immediately for forensics
            await supabase.from('refinery_stats').insert({
              worker_id: WORKER_ID, source_file: currentPath, status: 'failed', 
              error_message: `Sieve Fail: ${sieveError}`, raw_output: actualText
            });
            throw new Error('Parsing Sieve failed to recover JSON.');
          }

        } catch (attemptErr) {
          console.warn(`[ATTEMPT FAIL] ${currentPath} attempt ${attempt}: ${attemptErr.message}`);
          // Immediate exit from attempt loop on Rate Limit or if all 3 attempts failed
          if (attemptErr.message === 'API_RATE_LIMIT' || attempt === 3) {
            if (attemptErr.message !== 'API_RATE_LIMIT') {
               await supabase.from('refinery_stats').insert({
                 worker_id: WORKER_ID, source_file: currentPath, status: 'failed', 
                 error_message: `Final Attempt Error: ${attemptErr.message}`, input_data: batch, input_words: batch.length
               });
            }
            throw attemptErr;
          }
          await new Promise(r => setTimeout(r, 2000 * attempt));
        }
      }

      // 5. POST-AI PROCESSING
      finalParsed.data = finalParsed.data.filter((item: any) => item.word?.trim().length > 1 && item.root?.trim().length > 1);

      const { error: saveErr } = await supabase.from('processed_words').upsert({
        source_file: currentPath, batch_index: 0, input_words: batch, words: finalParsed.data, summary: finalParsed.summary
      }, { onConflict: 'source_file,batch_index' });
      if (saveErr) throw saveErr;

      await supabase.from('refinery_stats').insert({
        worker_id: WORKER_ID, 
        source_file: currentPath, 
        status: 'success', 
        input_words: batch.length, 
        output_words: finalParsed.data.length, 
        total_duration_ms: Date.now() - batchStart,
        raw_output: JSON.stringify(finalParsed) // Store successful result for pattern analysis
      });

      await supabase.from('chunk_queue').update({ status: 'completed' }).eq('id', chunkRecordId);
      await supabase.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', keyRecord.id);
      console.log(`[SUCCESS] Chunk ${currentPath} done.`);

    } catch (err) {
      console.error(`[ERROR] ${currentPath}: ${err.message}`);
      if (chunkRecordId) {
        if (err.message === 'API_RATE_LIMIT') {
          // RELEASE CHUNK: Set back to pending without increasing retry_count
          await supabase.from('chunk_queue').update({ status: 'pending' }).eq('id', chunkRecordId);
          console.log(`[SHUTDOWN] Rate limit reached. Chunk ${currentPath} released for retry later. Ending worker cycle.`);
          break; // Stop the 5-cycle loop
        } else {
          const { data: currentChunk } = await supabase.from('chunk_queue').select('retry_count').eq('id', chunkRecordId).single();
          await supabase.from('chunk_queue').update({ 
            status: 'failed', 
            retry_count: (currentChunk?.retry_count || 0) + 1 
          }).eq('id', chunkRecordId);
        }
      }
    }
  }
}

runChunkRefinery();