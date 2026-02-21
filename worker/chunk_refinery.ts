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
          
          const systemInstruction = `
    ROLE: You are the "Amharic Refinery Master," an elite linguistic engine specialized in Ethiopic script restoration, morphological analysis, and lexicographical enrichment.
    CRITICAL: Your final output MUST be a single JSON object. No markdown. No thoughts in content.
    PROTOCOLS: 1. Split merged words. 2. Discard nonsense/noise. 3. Fix visuals. 4. Identify Root/Citation form. 5. Nuanced English Synonyms. 6. POS Tagging. 7. FILTER: No single characters. 8. Summary.
    OUTPUT FORMAT: { "data": [ { "word": "...", "root": "...", "pos": "...", "synonyms": [], "importance": 1-10 } ], "summary": "..." }`;

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
          if (!candidate || !candidate.content) throw new Error(`No AI Content. Reason: ${candidate?.finishReason || 'UNKNOWN'}`);

          let actualText = candidate.content.parts?.filter((p: any) => p.text).map((p: any) => p.text).join('').trim();
          if (!actualText) throw new Error('AI response body is empty.');

          if (candidate.finishReason === 'MAX_TOKENS' && !actualText.endsWith('}')) {
            if (actualText.includes('"data":') && !actualText.includes(']')) actualText += ']}';
            if (!actualText.endsWith('}')) actualText += '}';
          }

          const sanitize = (val: string) => val.replace(/[\u0000-\u001F\u007F-\u009F]/g, "").replace(/,\s*([\}\]])/g, '$1');
          try { 
            finalParsed = JSON.parse(sanitize(actualText)); 
          } catch (e) {
            const greedyMatch = actualText.match(/\{[\s\S]*\}/);
            if (greedyMatch) try { finalParsed = JSON.parse(sanitize(greedyMatch[0])); } catch (e2) {
              const starts = [...actualText.matchAll(/\{/g)].map(m => m.index || 0);
              const ends = [...actualText.matchAll(/\}/g)].map(m => m.index || 0).reverse();
              sieve: for (const s of starts) for (const e of ends) if (e > s) try { 
                finalParsed = JSON.parse(sanitize(actualText.substring(s, e + 1))); 
                break sieve; 
              } catch (err) { continue; }
            }
          }

          if (finalParsed?.data && Array.isArray(finalParsed.data)) break; // SUCCESS: Exit attempt loop
          else throw new Error('Parsing Sieve failed to recover JSON.');

        } catch (attemptErr) {
          console.warn(`[ATTEMPT FAIL] ${currentPath} attempt ${attempt}: ${attemptErr.message}`);
          if (attempt === 3) throw attemptErr; // Final internal attempt failed
          await new Promise(r => setTimeout(r, 2000 * attempt)); // Exponential backoff
        }
      }

      // 5. POST-AI PROCESSING
      finalParsed.data = finalParsed.data.filter((item: any) => item.word?.trim().length > 1 && item.root?.trim().length > 1);

      const { error: saveErr } = await supabase.from('processed_words').upsert({
        source_file: currentPath, batch_index: 0, input_words: batch, words: finalParsed.data, summary: finalParsed.summary
      }, { onConflict: 'source_file,batch_index' });
      if (saveErr) throw saveErr;

      await supabase.from('refinery_stats').insert({
        worker_id: WORKER_ID, source_file: currentPath, status: 'success', input_words: batch.length, output_words: finalParsed.data.length, total_duration_ms: Date.now() - batchStart
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