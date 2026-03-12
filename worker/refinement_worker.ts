import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

const WORKER_ID = Deno.env.get('WORKER_ID') || `refine_worker_${Math.random().toString(36).substring(7)}`;
const AI_TIMEOUT = 120000;

async function runRefinement() {
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  console.log(`🚀 [REFINE START] ID: ${WORKER_ID}`);

  for (let cycle = 1; cycle <= 10; cycle++) {
    let jobId = null;
    try {
      const { data: packet, error: rpcErr } = await supabase.rpc('get_refinement_work', { p_worker_id: WORKER_ID });
      if (rpcErr || packet.error) throw new Error(rpcErr?.message || packet.error);

      const { job_id, root, variations, api_key, key_id } = packet;
      jobId = job_id;

      console.log(`\n[CYCLE ${cycle}] Auditing Root: ${root} (${variations.length} children)`);

      const formattedVars = variations.map((v: any, idx: number) => `${idx}. ${v.word}`).join('\n');
      
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

        JSON STRUCTURE:
        {
          "root_audit": { "is_root": boolean, "real_root": string|null },
          "variation_audit": [
            { "id": 0, "belongs": boolean, "correction": string|null },
            ...
          ]
        }`;

      const aiResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${api_key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `SYSTEM: ${systemInstruction}\n\nROOT: ${root}\nVARIATIONS:\n${formattedVars}` }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.1 }
        })
      });

      const result = await aiResp.json();
      const audit = JSON.parse(result.candidates[0].content.parts[0].text);

      // PROCESS RESULTS
      let finalRoot = audit.root_audit.is_root ? root : audit.root_audit.real_root;
      if (!finalRoot) {
        console.warn(`[REJECTED] Root ${root} is trash. Purging family.`);
        await supabase.rpc('mark_refinement_done', { p_job_id: jobId });
        continue;
      }

      const cleanedVars = variations.map((v: any, idx: number) => {
        const vAudit = audit.variation_audit.find((a: any) => a.id === idx);
        if (!vAudit || !vAudit.belongs) return null;
        return { ...v, word: vAudit.correction || v.word };
      }).filter(Boolean);

      // SAVE TO FINAL TABLE
      await supabase.from('audited_dictionary_final').upsert({
        master_root: finalRoot,
        variations: cleanedVars,
        variation_count: cleanedVars.length
      }, { onConflict: 'master_root' });

      await supabase.rpc('mark_refinement_done', { p_job_id: jobId });
      console.log(`[SUCCESS] Root ${finalRoot} audited and saved.`);

    } catch (err) {
      console.error(`[ERROR] ${err.message}`);
      if (jobId) await supabase.rpc('fail_validation_work', { p_job_id: jobId, p_error: err.message }); // Reusing existing fail RPC
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

runRefinement();