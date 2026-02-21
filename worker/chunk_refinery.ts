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

      // 4. ROBUST AI CALL (Direct transplant from 1.0)
      const systemInstruction = `
    ROLE: You are the "Amharic Refinery Master," an elite linguistic engine specialized in Ethiopic script restoration, morphological analysis, and lexicographical enrichment.

    CRITICAL: Your final output MUST be a single JSON object. 
    - Do NOT include partial JSON snippets or code blocks in your thoughts.
    - If you must explain your work, use plain text only. 
    - Do NOT use curly braces {} anywhere except in the final JSON structure.

    YOUR MISSION: Process messy OCR input through these STRICT SCHOLARLY PROTOCOLS:
    1. PROTOCOL: THE SPLITTER: Split merged words (e.g., "ጨምሯልለሶስተኛ" ➔ "ጨምሯል", "ለሶስተኛ").
    2. PROTOCOL: THE JUDGE: Discard gibberish or pure Latin/numbers.
    3. PROTOCOL: THE CORRECTOR: Fix visual confusion (ሀ vs ሃ). Strip punctuation.
    4. PROTOCOL: THE LEMMATIZER: Provide Global Citation Form (e.g., "እንድናጓጉዘው" ➔ "ማጓጓዝ").
    5. PROTOCOL: THE TRANSLATOR: Comprehensive English synonyms.
    6. PROTOCOL: THE GRAMMARIAN: Identify Part of Speech.
    7. PROTOCOL: THE FILTER: CRITICAL: Discard any word/root shorter than 2 characters.
    8. PROTOCOL: EXECUTIVE SUMMARY: Explain your logic.

    OUTPUT FORMAT (STRICT JSON ONLY):
    {
      "data": [ { "word": "...", "root": "...", "pos": "...", "synonyms": [], "importance": 1-10 } ],
      "summary": "..."
    }`;

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
        throw new Error('Rate limit hit.');
      }

      const result = await aiResp.json();
      const candidate = result.candidates?.[0];
      if (!candidate || !candidate.content) {
        throw new Error(`AI returned no content. FinishReason: ${candidate?.finishReason || 'UNKNOWN'}`);
      }

      const actualText = candidate.content.parts?.filter((p: any) => p.text).map((p: any) => p.text).join('\n').trim();
      
      if (!actualText) {
        throw new Error('AI response body is empty.');
      }

      // 5. ROBUST STAGED SIEVE PARSING (Stage 1-3)
      const sanitize = (val: string) => val.replace(/[\u0000-\u001F\u007F-\u009F]/g, "").replace(/,\s*([\}\]])/g, '$1');
      let parsed = null;
      try { 
        parsed = JSON.parse(sanitize(actualText)); 
      } catch (e) {
        const greedyMatch = actualText ? actualText.match(/\{[\s\S]*\}/) : null;
        if (greedyMatch) try { parsed = JSON.parse(sanitize(greedyMatch[0])); } catch (e2) {
          const starts = [...actualText.matchAll(/\{/g)].map(m => m.index || 0);
          const ends = [...actualText.matchAll(/\}/g)].map(m => m.index || 0).reverse();
          sieveLoop: for (const s of starts) for (const e of ends) if (e > s) try { 
            parsed = JSON.parse(sanitize(actualText.substring(s, e + 1))); 
            break sieveLoop; 
          } catch (err) { continue; }
        }
      }

      if (!parsed || !Array.isArray(parsed.data)) throw new Error('Parsing Sieve failed to recover JSON.');

      // 6. PROGRAMMATIC FILTERING
      parsed.data = parsed.data.filter((item: any) => item.word?.trim().length > 1 && item.root?.trim().length > 1);

      // 7. SAVE DATA & STATS
      const { error: saveErr } = await supabase.from('processed_words').upsert({
        source_file: currentPath, batch_index: 0, input_words: batch, words: parsed.data, summary: parsed.summary
      }, { onConflict: 'source_file,batch_index' });
      if (saveErr) throw saveErr;

      await supabase.from('refinery_stats').insert({
        worker_id: WORKER_ID, source_file: currentPath, status: 'success', input_words: batch.length, output_words: parsed.data.length, total_duration_ms: Date.now() - batchStart
      });

      await supabase.from('chunk_queue').update({ status: 'completed' }).eq('id', chunkRecordId);
      await supabase.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', keyRecord.id);

      console.log(`[SUCCESS] Chunk ${currentPath} done.`);

    } catch (err) {
      console.error(`[ERROR] ${currentPath}: ${err.message}`);
      if (chunkRecordId) {
        const { data: currentChunk } = await supabase.from('chunk_queue').select('retry_count').eq('id', chunkRecordId).single();
        await supabase.from('chunk_queue').update({ 
          status: 'failed', 
          retry_count: (currentChunk?.retry_count || 0) + 1 
        }).eq('id', chunkRecordId);
      }
    }
  }
}

runChunkRefinery();