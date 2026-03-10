import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

const AI_TIMEOUT = 180000;
const COOLDOWN_DURATION = 10 * 60 * 1000;

async function runChunkRefinery() {
  const WORKER_ID = Deno.env.get('WORKER_ID') || 'chunk_worker_v4_1';
  console.log(`--- REFINERY V4 WORKER ${WORKER_ID} START ---`);
  
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  for (let cycle = 0; cycle < 10; cycle++) {
    let chunkRecordId = 0;
    let currentPath = "";
    let batchStart = Date.now();

    try {
      // 1. CLAIM SEQUENTIAL CHUNK FROM V4 QUEUE (STRICT SEQUENCE)
      const { data: claimData, error: claimErr } = await supabase.rpc('claim_v4_refinery_batch', { 
        p_worker_id: WORKER_ID 
      });

      if (claimErr) throw new Error(`Claim RPC failed: ${claimErr.message}`);
      if (!claimData || claimData.length === 0) {
        console.log("[WAIT/FINISH] No available batches in current sequence or queue empty.");
        break;
      }

      const chunk = claimData[0];
      chunkRecordId = chunk.id;
      currentPath = chunk.chunk_path;
      const parentFile = chunk.parent_file;
      console.log(`[STAGE: CLAIMED] ${parentFile} -> ${currentPath} (Attempt ${chunk.retry_count + 1})`);

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

      // 3. DOWNLOAD CHUNK CONTENT FROM V2 BUCKET
      const { data: fileData, error: dlErr } = await supabase.storage
        .from('V2')
        .download(currentPath);
      if (dlErr) throw dlErr;

      const text = await fileData.text();
      const batch = text.split(/\r?\n/).filter(l => l.trim().length > 0);
      let finalParsed = null;

      // --- TIER 1: TACTICAL LOOP (3 Internal Attempts) ---
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          console.log(`[STAGE: AI] ${currentPath} - Session Attempt ${attempt}/3...`);
          
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

    2. PROTOCOL: THE JUDGE (Lexicographical Filtering)
       - MISSION: Eliminate entries that do not belong in a general-purpose dictionary.
       - STRICT EXCLUSIONS: 
         1. Proper Names: Names of people (e.g., አበበ), specific organizations, or religious figures.
         2. Geopolitical Entities: Names of countries (e.g., ኢትዮጵያ, አሜሪካ), cities, or specific landmarks.
         3. Semantic Nonsense: Meaningless OCR gibberish.
         4. Generic English Transliterations: Strictly exclude English words phonetically spelled in Amharic that have existing native equivalents. 
            - EXAMPLE: Exclude 'አኒማል' (Animal) because 'እንስሳ' exists. Exclude 'ቡክ' (Book) because 'መጽሐፍ' exists. 
       - LOANWORD POLICY: ONLY include loanwords that are officially integrated into the Amharic lexicon (e.g., ኮምፒውተር, ፓራግራፍ, ፖሊስ, ባቡር). If a common Amharic word exists for the concept, the English transliteration MUST be rejected.
       - ACTION: If a word falls into the exclusion categories, remove it entirely. Do NOT provide a root or translation for them.
    3. PROTOCOL: THE CORRECTOR (OCR Repair & Morphological Preservation)
       - THE 'word' FIELD: This must be the word as found in the text, preserving all original prefixes, suffixes, and conjugations (e.g., 'ለቤታቸው', 'እንዲቃኝና'). 
       - ACTION: Fix only visual OCR spelling errors or clear typos (e.g., 'ሀ' vs 'ሃ') if the correction is certain from context. 
       - DO NOT strip prepositions (ለ-, በ-, ከ-, etc.) or suffixes from this field. Keep the morphology exactly as it appears in the source, but fixed for spelling.
       - STRIP attached punctuation (e.g., "ሰላም::" ➔ "ሰላም").
       - RULE: If the word remains ambiguous or meaningless after these steps, DISCARD it.

    4. PROTOCOL: THE LEMMATIZER (Normalization & Citation)
       - MISSION: Identify the base dictionary entry (Infinitive/መነሻ ቃል) for every valid word.
       - CITATION FORM: Use the main generic root (Infinitive), typically starting with the 'መ-' prefix. 
       - THE 'root' FIELD: This field is for the dictionary citation form. 
       - STRICTURE ON DISTINCTION: Do NOT put the same string in both 'word' and 'root' fields if the word is a conjugation or derived form. The 'word' field is the cleaned text instance; the 'root' field is the generic source. 
       - STRICTURE: Do NOT use the 3rd person masculine singular for roots (e.g., use መብላት, NOT በላ; use መሄድ, NOT ሄደ).
       - NORMALIZATION (CRITICAL): In the 'root' field, use Standard Modern Spelling by normalizing homophones. Use ሀ for (ሐ, ኀ, ኸ), use ሰ for (ሠ), and use ጸ for (ፀ).
       - LOGIC: Analyze morphology globally to find the true citation form.
       - EXAMPLES: "እንድናጓጉዘው" ➔ "ማጓጓዝ", "የሚመጡት" ➔ "መምጣት".
       - STRICTURE: If no identifiable dictionary root exists, set root to "N/A".

    5. PROTOCOL: THE TRANSLATOR (Nuance Expansion)
       - Provide comprehensive English synonyms capture the full breadth of the word.

    6. PROTOCOL: THE GRAMMARIAN (Linguistic Tagging)
       - CRITICAL: Assign the word to ONE of these categories ONLY: Noun, Verb, Adjective, Adverb, Pronoun, Preposition, Conjunction, Interjection.
       - STRICT RULE: Do NOT include morphological details (like "relative," "passive," "3rd person") in the POS field. Use only the high-level category name.

    7. PROTOCOL: THE FILTER (Size & Numerals)
       - CRITICAL: Discard any entry shorter than 2 characters.
       - NUMERALS: Exclude all Western digits (0-9) and Ethiopic numerals (፩, ፪, ፫, etc.) entirely from the output.

    8. PROTOCOL: EXECUTIVE SUMMARY
       - Reflect on your decisions. Explain splits, discards, and "Scholarly Guesses."

    OUTPUT FORMAT (STRICT JSON ONLY):
    Return a single JSON Object. NO Markdown. "summary" MUST come AFTER the "data" array.
    {
      "data": [
        { 
          "word": "[Cleaned]", 
          "root": "[Citation Form or N/A]", 
          "pos": "[Part of Speech]", 
          "synonyms": [], 
          "confidence": 1-10 
        }
      ],
      "summary": "Reflective summary..."
    }
    
    DEFINITION OF CONFIDENCE: A score of 1-10 representing how likely it is that this string is a sensical, legitimate Amharic word. 
    - ATTENTION: Assign a LOW score (1-3) for English transliterations that slipped through the filter (e.g., 'አኒማል'), or for fragments and ambiguous OCR results.
    - Assign HIGH scores (8-10) only for pure Amharic words or perfectly integrated, standard loanwords (like 'ባቡር, ሀኪም').
    `;

          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), AI_TIMEOUT);

          const aiResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${cleanKey}`, {
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
          });
          clearTimeout(timeoutId);

          if (aiResp.status === 429) {
            await supabase.from('api_keys').update({ cooldown_until: new Date(Date.now() + COOLDOWN_DURATION).toISOString() }).eq('id', keyRecord.id);
            throw new Error('API_RATE_LIMIT');
          }
          
          if (aiResp.status === 503) {
            throw new Error('API_OVERLOAD');
          }

          const result = await aiResp.json();
          
          // --- RAW ERROR CATCHING ---
          if (result.error) {
            const rawErr = JSON.stringify(result.error);
            await supabase.from('v4_refinery_logs').insert({
              worker_id: WORKER_ID, parent_file: parentFile, source_file: currentPath, status: 'failed',
              error_message: `API_ERROR: ${rawErr}`, raw_output: JSON.stringify(result)
            });
            throw new Error(`Gemini API returned error: ${rawErr}`);
          }

          const candidate = result.candidates?.[0];
          if (!candidate || !candidate.content || !candidate.content.parts) {
            const stopReason = candidate?.finishReason || "NO_CANDIDATE";
            const safety = candidate?.safetyRatings ? JSON.stringify(candidate.safetyRatings) : "No Safety Info";
            await supabase.from('v3_refinery_logs').insert({
              worker_id: WORKER_ID, source_file: currentPath, status: 'failed',
              error_message: `AI_SILENCE: ${stopReason} | Safety: ${safety}`,
              input_data: batch, input_words: batch.length, raw_output: JSON.stringify(result)
            });
            throw new Error(`AI_SILENCE: ${stopReason}`);
          }

          let actualText = candidate.content.parts?.filter((p: any) => p.text).map((p: any) => p.text).join('').trim();
          
          // --- AGGRESSIVE SANITIZER ---
          const sanitize = (val: string) => {
            return val
              .replace(/[\u0000-\u001F\u007F-\u009F]/g, "") // Remove control chars
              .replace(/""/g, '"')                       // Fix double-double quotes
              .replace(/,\s*([\}\]])/g, '$1');           // Remove trailing commas
          };

          let sieveError = "";
          
          // TIER 1: DIRECT PARSE
          try { 
            const cleaned = sanitize(actualText);
            const p = JSON.parse(cleaned); 
            if (p?.data && Array.isArray(p.data)) finalParsed = p;
          } catch (e) { sieveError += `[Direct: ${e.message}] `; }

          // TIER 2: RECURSIVE BRACE EXHAUSTION (THE SIEVE)
          if (!finalParsed) {
            console.log(`[SIEVE] Direct parse failed for ${currentPath}. Exhausting brace pairs...`);
            const starts = [...actualText.matchAll(/\{/g)].map(m => m.index || 0);
            const ends = [...actualText.matchAll(/\}/g)].map(m => m.index || 0).reverse();

            sieveLoop: for (const s of starts) {
              for (const e of ends) {
                if (e > s) {
                  try {
                    const candidateStr = sanitize(actualText.substring(s, e + 1));
                    const p = JSON.parse(candidateStr);
                    if (p?.data && Array.isArray(p.data)) {
                      finalParsed = p;
                      console.log(`[SIEVE] Recovered data at range ${s}-${e}`);
                      break sieveLoop;
                    }
                  } catch (err) { continue; }
                }
              }
            }
          }

          if (!finalParsed) {
            sieveError += "[Exhaustive Sieve: No valid data block found]";
            await supabase.from('v3_refinery_logs').insert({
              worker_id: WORKER_ID, source_file: currentPath, status: 'failed', 
              error_message: `SIEVE_FAILURE: ${sieveError}`, raw_output: actualText
            });
            throw new Error('Parsing Sieve failed to recover JSON.');
          }

          if (finalParsed?.data) break;

        } catch (attemptErr) {
          console.warn(`[ATTEMPT FAIL] ${currentPath} attempt ${attempt}: ${attemptErr.message}`);
          if (attemptErr.message === 'API_RATE_LIMIT' || attempt === 3) throw attemptErr;
          await new Promise(r => setTimeout(r, 2000 * attempt));
        }
      }

      // 5. POST-AI PROCESSING & STORAGE IN V2 TABLES
      // We allow root to be 'N/A' now, so we only filter out empty or single-char words
      finalParsed.data = finalParsed.data.filter((item: any) => 
        item.word?.trim().length > 1 && 
        item.root?.trim().length >= 1
      );

      const { error: saveErr } = await supabase.from('v4_refined_dictionary').upsert({
        parent_file: parentFile,
        source_file: currentPath, 
        batch_index: 0, 
        input_words: batch, 
        words: finalParsed.data, 
        summary: finalParsed.summary,
        model_version: 'gemini-3.1-flash-lite-preview'
      }, { onConflict: 'source_file,batch_index' });
      
      if (saveErr) throw saveErr;

      await supabase.from('v4_refinery_logs').insert({
        worker_id: WORKER_ID, 
        parent_file: parentFile,
        source_file: currentPath, 
        status: 'success', 
        input_words: batch.length, 
        output_words: finalParsed.data.length, 
        total_duration_ms: Date.now() - batchStart,
        raw_output: JSON.stringify(finalParsed)
      });

      await supabase.from('v4_refinery_queue').update({ status: 'completed' }).eq('id', chunkRecordId);
      await supabase.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', keyRecord.id);
      console.log(`[SUCCESS] Chunk ${currentPath} processed.`);

    } catch (err) {
      console.error(`[ERROR] ${currentPath}: ${err.message}`);
      if (chunkRecordId) {
        if (err.message === 'API_RATE_LIMIT' || err.message === 'API_OVERLOAD') {
          await supabase.from('v4_refinery_queue').update({ status: 'pending' }).eq('id', chunkRecordId);
          break;
        } else {
          const { data: currentChunk } = await supabase.from('v4_refinery_queue').select('retry_count').eq('id', chunkRecordId).single();
          await supabase.from('v4_refinery_queue').update({ 
            status: 'failed', 
            retry_count: (currentChunk?.retry_count || 0) + 1 
          }).eq('id', chunkRecordId);
        }
      }
    }
  }
}

runChunkRefinery();