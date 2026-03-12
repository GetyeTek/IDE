import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

const WORKER_ID = Deno.env.get('WORKER_ID') || `refine_worker_${Math.random().toString(36).substring(7)}`;
const AI_TIMEOUT = 120000;
const COOLDOWN_DURATION = 60 * 60 * 1000; // 1 hour

async function runRefinement() {
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  console.log(`\n======================================================`);
  console.log(`🚀 [REFINE START] ID: ${WORKER_ID} | Timestamp: ${new Date().toISOString()}`);
  console.log(`======================================================`);

  for (let cycle = 1; cycle <= 10; cycle++) {
    let jobId = null;
    let currentRoot = "UNKNOWN";

    try {
      console.log(`\n>>> [CYCLE ${cycle}/10] Requesting work...`);
      const { data: packet, error: rpcErr } = await supabase.rpc('get_refinement_work', { p_worker_id: WORKER_ID });

      if (rpcErr) throw new Error(`RPC Failed: ${rpcErr.message}`);
      if (!packet || packet.error === 'NO_WORK') {
        console.log("No more roots to audit. Stopping gracefully.");
        break;
      }
      if (packet.error === 'NO_API_KEY') {
        console.warn("All API keys are in cooldown. Pausing cycle.");
        await new Promise(r => setTimeout(r, 30000));
        continue;
      }

      const { job_id, root, variations, api_key, key_id } = packet;
      jobId = job_id;
      currentRoot = root;

      console.log(`[JOB ${jobId}] Auditing Root: ${root} | Children: ${variations?.length || 0}`);

      const formattedVars = (variations || []).map((v: any, idx: number) => `${idx}. ${v.word}`).join('\n');
      
      const systemInstruction = `
        ROLE: Senior Amharic Ethiopic Linguist.
        TASK: Perform a deep audit on a Master Root and its suggested variations.

        AUDIT RULES FOR ROOT (${root}):
        - is_root: true ONLY if it is the absolute Generic Infinitive (usually መ-) or Citation form.
        - If it is a variation (e.g., 'ሄደ' instead of 'መሄድ'), set is_root: false and real_root: 'መሄድ'.
        - If it is a Proper Noun or Loanword, set is_root: false and real_root: null.

        AUDIT RULES FOR VARIATIONS:
        - belongs: true if the word is a valid conjugation/derivation of the ROOT.
        - If it has a typo, set belongs: true AND provide the correction.
        - If it is a Proper Noun, Loanword, or belongs to a DIFFERENT root, set belongs: false.

        OUTPUT FORMAT (STRICT JSON ONLY):
        {
          "root_audit": { "is_root": boolean, "real_root": string|null },
          "variation_audit": [
            { "id": 0, "belongs": boolean, "correction": string|null }
          ]
        }`;

      let auditResult = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), AI_TIMEOUT);

          const aiResp = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=" + api_key, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: `SYSTEM: ${systemInstruction}\n\nROOT TO AUDIT: ${root}\nVARIATIONS LIST:\n${formattedVars}` }] }],
              generationConfig: { responseMimeType: 'application/json', temperature: 0.1 }
            }),
            signal: controller.signal
          });
          clearTimeout(timeoutId);

          if (aiResp.status === 429) {
            console.warn(`[429] Rate Limit on Key ${key_id}. Applying 1hr cooldown.`);
            await supabase.from('api_keys').update({ cooldown_until: new Date(Date.now() + COOLDOWN_DURATION).toISOString() }).eq('id', key_id);
            throw new Error("RATE_LIMIT");
          }

          const result = await aiResp.json();
          const rawText = result.candidates?.[0]?.content?.parts?.[0]?.text || "";

          // Robust JSON Extraction
          try {
            auditResult = JSON.parse(rawText);
          } catch (e) {
            const match = rawText.match(/\{[\s\S]*\}/);
            if (match) auditResult = JSON.parse(match[0]);
            else throw new Error("JSON_PARSE_FAILED");
          }
          break;
        } catch (attemptErr) {
          console.warn(`[AI ATTEMPT ${attempt}] Failed: ${attemptErr.message}`);
          if (attemptErr.message === "RATE_LIMIT" || attempt === 3) throw attemptErr;
          await new Promise(r => setTimeout(r, 5000 * attempt));
        }
      }

      if (!auditResult) throw new Error("AI_FAILED_AFTER_RETRIES");

      // LOG THE RAW RESPONSE FOR POST-MORTEM AUDIT
      await supabase.from('refinement_audit_logs').insert({
        job_id: jobId,
        original_root: root,
        original_vars_count: variations?.length || 0,
        ai_raw_response: auditResult,
        worker_id: WORKER_ID
      });

      // 4. Update the Data based on Audit
      const finalRoot = auditResult.root_audit.is_root ? root : auditResult.root_audit.real_root;
      
      if (!finalRoot) {
        console.log(`[PURGE] Root "${root}" rejected as trash. Deleting from queue.`);
      } else {
        const cleanedVars = (variations || []).map((v: any, idx: number) => {
          const vAudit = auditResult.variation_audit.find((a: any) => a.id === idx);
          if (!vAudit || !vAudit.belongs) return null;
          return { 
            word: vAudit.correction || v.word, 
            pos: v.pos || null, 
            synonyms: v.synonyms || [] 
          };
        }).filter((v: any) => v !== null);

        // Upsert into the final table
        const { error: finalErr } = await supabase.from('audited_dictionary_final').upsert({
          master_root: finalRoot,
          variations: cleanedVars,
          variation_count: cleanedVars.length,
          audited_at: new Date().toISOString()
        }, { onConflict: 'master_root' });

        if (finalErr) throw finalErr;
        console.log(`[SAVED] "${finalRoot}" with ${cleanedVars.length} variations.`);
      }

      // 5. Mark Done
      await supabase.rpc('mark_validation_done', { p_job_id: jobId }); // Reusing existing mark_done RPC logic

    } catch (err) {
      console.error(`[CRITICAL ERROR] Root: ${currentRoot} | Job: ${jobId} | Error: ${err.message}`);
      if (jobId) {
        await supabase.rpc('fail_validation_work', { p_job_id: jobId, p_error: err.message });
      }
      await new Promise(r => setTimeout(r, 5000));
    }
  }
  console.log(`\n🛑 [REFINE FINISHED] Worker ${WORKER_ID} session ended.`);
}

runRefinement();