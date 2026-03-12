import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

const WORKER_ID = Deno.env.get('WORKER_ID') || `refine_worker_${Math.random().toString(36).substring(7)}`;
const AI_TIMEOUT = 120000;
const COOLDOWN_DURATION = 60 * 60 * 1000; // 1 hour cooldown for rate limits

async function runRefinement() {
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  console.log(`\n======================================================`);
  console.log(`🚀 [REFINE BATCH MODE] ID: ${WORKER_ID}`);
  console.log(`🛠️ PROMPT: Maximalist / LINGUISTIC ARCHITECT`);
  console.log(`======================================================`);

  for (let cycle = 1; cycle <= 10; cycle++) {
    let batchJobs = [];
    try {
      console.log(`\n>>> [CYCLE ${cycle}/10] Requesting Batch from RPC...`);
      const { data: packet, error: rpcErr } = await supabase.rpc('get_refinement_work_batch', { p_worker_id: WORKER_ID });

      if (rpcErr) throw new Error(`RPC Failed: ${rpcErr.message}`);
      if (!packet || packet.error === 'NO_WORK') {
        console.log("Queue empty. Ending session.");
        break;
      }
      if (packet.error === 'NO_API_KEY') {
        console.warn("All keys on cooldown. Waiting 30s...");
        await new Promise(r => setTimeout(r, 30000));
        continue;
      }

      const { batch, api_key, key_id, total_word_count } = packet;
      batchJobs = batch;

      console.log(`[BATCH] Claimed ${batch.length} roots | Total Word Density: ${total_word_count}`);

      // CONSTRUCTING MULTI-ROOT DATA BLOCK
      let promptInput = "";
      batch.forEach((item: any, rIdx: number) => {
        promptInput += `\n[ROOT_INDEX: ${rIdx}] ROOT_WORD: ${item.root}\nVARIATIONS FOR ROOT ${rIdx}:\n`;
        (item.variations || []).forEach((v: any, vIdx: number) => {
          promptInput += `${rIdx}.${vIdx}. ${v.word}\n`;
        });
      });

      const systemInstruction = `
        ROLE: Expert Amharic Ethiopic Linguistic Auditor & Dictionary Architect.
        MISSION: Perform a ruthless, high-fidelity audit on a BATCH of multiple Master Roots and their Variation lists.

        PART 1: ROOT AUDITS
        Standard: For every ROOT_WORD, check if it is the ABSOLUTE GENERIC INFINITIVE or CITATION form (መነሻ ቃል).
        1. VERBS: Must be the infinitive form (usually starts with 'መ'). 
           - WRONG: 'ተሳሳተ', 'ሄደ' -> is_root: false, real_root: 'መሳሳት', 'መሄድ'.
        2. NOUNS & ADJECTIVES: Must be the base singular form. Strip derivational suffixes.
           - WRONG: 'ደግነት', 'ኮረብታማ', 'ኢትዮጵያዊ' -> is_root: false, real_root: 'ደግ', 'ኮረብታ'.
        3. PURITY CHECK vs. NATURALIZED WORDS:
           - KEEP NATURALIZED WORDS: Common nouns like 'ሎሚ', 'ባልዲ', 'ሳሙና', 'ሃቅ/ሐቅ', 'ሌማት', 'መጽሐፍ', 'ጠረጴዛ' are ESTABLISHED Amharic. They are valid roots. DO NOT REJECT THEM.
           - PURGE MODERN TRANSLITERATIONS ONLY: Reject technical noise like 'ኮምፒውተር', 'ኢንተርኔት', 'ዲጂታል', 'ፕሮቶኮል'.
           - PROPER NOUNS: Reject Names of People, Cities, Countries, and Orgs (e.g., 'አዲስ አበባ', 'ዮሐንስ'). Set real_root: null.
        4. ORTHOGRAPHY: Zero tolerance for typos (ሀ/ሃ/ሐ, ሰ/ሠ). If misspelled, fix it in real_root.

        PART 2: VARIATIONS AUDIT
        Check every variation numbered ParentIndex.ChildIndex (e.g., "0.15").
        1. BELONGING: Does it derive conceptuallly from its parent root? 
        2. TYPO CORRECTION: If it belongs but is misspelled, set belongs: true and provide the 'correction'.

        OUTPUT FORMAT: Return a JSON Array where each object corresponds to a ROOT_INDEX.
        [
          {
            "root_index": 0,
            "root_audit": { "is_root": boolean, "real_root": string|null },
            "variation_audit": [
              { "id": "0.0", "belongs": boolean, "correction": string|null },
              { "id": "0.1", "belongs": boolean, "correction": string|null }
            ]
          }
        ]

        MANDATORY: Return results for ALL Root Indexes. NO PREAMBLE. NO TEXT. ONLY JSON.`;

      let batchResults = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), AI_TIMEOUT);

          const aiResp = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=" + api_key, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: `SYSTEM: ${systemInstruction}\n\nDATA BATCH TO AUDIT:\n${promptInput}` }] }],
              generationConfig: { responseMimeType: 'application/json', temperature: 0.1 }
            }),
            signal: controller.signal
          });
          clearTimeout(timeoutId);

          if (aiResp.status === 429) {
            console.warn(`[429] Rate Limit on Key ${key_id}. Cooling for 1 hour.`);
            await supabase.from('api_keys').update({ cooldown_until: new Date(Date.now() + COOLDOWN_DURATION).toISOString() }).eq('id', key_id);
            throw new Error("RATE_LIMIT");
          }

          const result = await aiResp.json();
          const rawText = result.candidates?.[0]?.content?.parts?.[0]?.text || "";

          // Robust Recursive Extraction
          const cleanJson = rawText.match(/\\[[\\s\\S]*\\]/)?.[0] || rawText;
          batchResults = JSON.parse(cleanJson);
          break;
        } catch (e) {
          console.warn(`[AI ATTEMPT ${attempt}] Fail: ${e.message}`);
          if (attempt === 3) throw e;
          await new Promise(r => setTimeout(r, 5000 * attempt));
        }
      }

      if (!batchResults || !Array.isArray(batchResults)) throw new Error("INVALID_BATCH_RESPONSE");

      // LOGGING AND RECORDING RESULTS FOR EACH ROOT IN THE BATCH
      for (let i = 0; i < batch.length; i++) {
        const source = batch[i];
        const audit = batchResults.find((a: any) => a.root_index === i);

        if (!audit) {
          console.error(`[MISSING DATA] AI skipped root index ${i} (${source.root})`);
          await supabase.rpc('fail_validation_work', { p_job_id: source.job_id, p_error: 'AI_SKIPPED_ROOT' });
          continue;
        }

        // Recording each in the Black Box log table
        await supabase.from('refinement_audit_logs').insert({
          job_id: source.job_id,
          original_root: source.root,
          original_vars_count: source.variations?.length || 0,
          ai_raw_response: audit,
          worker_id: WORKER_ID
        });

        await supabase.rpc('mark_validation_done', { p_job_id: source.job_id });
        console.log(`[AUDITED] Saved record for: "${source.root}" (${source.variations?.length || 0} vars)`);
      }

    } catch (err) {
      console.error(`[CRITICAL BATCH FAILURE] ${err.message}`);
      for (const job of batchJobs) {
        await supabase.rpc('fail_validation_work', { p_job_id: job.job_id, p_error: err.message });
      }
      await new Promise(r => setTimeout(r, 5000));
    }
  }
  console.log(`\n🛑 [WORKER ${WORKER_ID}] Sequence finished.`);
}

runRefinement();