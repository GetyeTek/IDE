import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

const AI_TIMEOUT = 180000;
const COOLDOWN_DURATION = 10 * 60 * 1000;

async function runChunkRefinery() {
  const WORKER_ID = Deno.env.get('WORKER_ID') || 'chunk_worker_v2_1';
  console.log(`--- REFINERY V2 WORKER ${WORKER_ID} START ---`);
  
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  for (let cycle = 0; cycle < 5; cycle++) {
    let chunkRecordId = 0;
    let currentPath = "";
    let batchStart = Date.now();

    try {
      // 1. CLAIM SEQUENTIAL CHUNK FROM V2 QUEUE
      const { data: claimData, error: claimErr } = await supabase.rpc('claim_v2_refinery_batch', { 
        p_worker_id: WORKER_ID 
      });

      if (claimErr) throw new Error(`Claim RPC failed: ${claimErr.message}`);
      if (!claimData || claimData.length === 0) {
        console.log("[FINISHED] No more chunks in V2 queue.");
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

    2. PROTOCOL: THE JUDGE (Semantic Filtering)
       - MISSION: Eliminate semantic nonsense. If an Amharic string is a meaningless combination of characters that cannot be logically corrected to a valid dictionary entry, DELETE it.
       - ACTION: Never invent a "root" or "translation" for nonsense words. If the word provides no semantic value, exclude it entirely from the output array.

    3. PROTOCOL: THE CORRECTOR (Repair vs. Discard)
       - ACTION: Attempt to fix minor visual OCR spelling errors (e.g., 'ሀ' vs 'ሃ') ONLY if the context makes the correction certain.
       - STRIP attached punctuation (e.g., "ሰላም::" ➔ "ሰላም").
       - RULE: If correction is a "guess" and the word remains ambiguous or meaningless, default to PROTOCOL 2 and DISCARD it.

    4. PROTOCOL: THE LEMMATIZER (Global Citation Form)
       - MISSION: Identify the base dictionary entry (Infinitive/መነሻ ቃል) for every valid word.
       - LOGIC: Do NOT simply strip prefixes/suffixes from the given string. Analyze the word's morphology globally to find its true citation form.
       - EXAMPLES: "እንድናጓጉዘው" ➔ "ማጓጓዝ", "የሚመጡት" ➔ "መምጣት", "ሲመለከቱ" ➔ "መመልከት".

    5. PROTOCOL: THE TRANSLATOR (Nuance Expansion)
       - Provide comprehensive English synonyms capture the full breadth of the word.

    6. PROTOCOL: THE GRAMMARIAN (Linguistic Tagging)
       - CRITICAL: Assign the word to ONE of these categories ONLY: Noun, Verb, Adjective, Adverb, Pronoun, Preposition, Conjunction, Interjection.
       - STRICT RULE: Do NOT include morphological details (like "relative," "passive," "3rd person") in the POS field. Use only the high-level category name.

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

          const aiResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${cleanKey}`, {
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
          const candidate = result.candidates?.[0];

          if (!candidate || !candidate.content || !candidate.content.parts) {
            const stopReason = candidate?.finishReason || "NO_CANDIDATE";
            await supabase.from('v2_refinery_logs').insert({
              worker_id: WORKER_ID,
              source_file: currentPath,
              status: 'failed',
              error_message: `AI_SILENCE: ${stopReason}`,
              input_data: batch,
              input_words: batch.length,
              raw_output: JSON.stringify(result)
            });
            throw new Error(`AI_SILENCE: ${stopReason}`);
          }

          let actualText = candidate.content.parts?.filter((p: any) => p.text).map((p: any) => p.text).join('').trim();
          
          const sanitize = (val: string) => {
            return val.replace(/[\u0000-\u001F\u007F-\u009F]/g, "").replace(/""/g, '"').replace(/,\s*([\}\]])/g, '$1');           
          };

          try { 
            const p = JSON.parse(sanitize(actualText)); 
            if (p?.data && Array.isArray(p.data)) finalParsed = p;
          } catch (e) { /* Sieve logic would follow if needed */ }

          if (finalParsed?.data && Array.isArray(finalParsed.data)) break;
          else throw new Error('Parsing failed to recover JSON.');

        } catch (attemptErr) {
          console.warn(`[ATTEMPT FAIL] ${currentPath} attempt ${attempt}: ${attemptErr.message}`);
          if (attemptErr.message === 'API_RATE_LIMIT' || attempt === 3) throw attemptErr;
          await new Promise(r => setTimeout(r, 2000 * attempt));
        }
      }

      // 5. POST-AI PROCESSING & STORAGE IN V2 TABLES
      finalParsed.data = finalParsed.data.filter((item: any) => item.word?.trim().length > 1 && item.root?.trim().length > 1);

      const { error: saveErr } = await supabase.from('v2_refined_dictionary').upsert({
        source_file: currentPath, 
        batch_index: 0, 
        input_words: batch, 
        words: finalParsed.data, 
        summary: finalParsed.summary,
        model_version: 'gemini-2.5-flash'
      }, { onConflict: 'source_file,batch_index' });
      
      if (saveErr) throw saveErr;

      await supabase.from('v2_refinery_logs').insert({
        worker_id: WORKER_ID, 
        source_file: currentPath, 
        status: 'success', 
        input_words: batch.length, 
        output_words: finalParsed.data.length, 
        total_duration_ms: Date.now() - batchStart,
        raw_output: JSON.stringify(finalParsed)
      });

      await supabase.from('v2_refinery_queue').update({ status: 'completed' }).eq('id', chunkRecordId);
      await supabase.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', keyRecord.id);
      console.log(`[SUCCESS] Chunk ${currentPath} processed.`);

    } catch (err) {
      console.error(`[ERROR] ${currentPath}: ${err.message}`);
      if (chunkRecordId) {
        if (err.message === 'API_RATE_LIMIT' || err.message === 'API_OVERLOAD') {
          await supabase.from('v2_refinery_queue').update({ status: 'pending' }).eq('id', chunkRecordId);
          break;
        } else {
          const { data: currentChunk } = await supabase.from('v2_refinery_queue').select('retry_count').eq('id', chunkRecordId).single();
          await supabase.from('v2_refinery_queue').update({ 
            status: 'failed', 
            retry_count: (currentChunk?.retry_count || 0) + 1 
          }).eq('id', chunkRecordId);
        }
      }
    }
  }
}

runChunkRefinery();