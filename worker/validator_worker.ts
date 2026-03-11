import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

const WORKER_ID = Deno.env.get('WORKER_ID') || `val_worker_${Math.random().toString(36).substring(7)}`;
const AI_TIMEOUT = 120000; 
const COOLDOWN_DURATION = 10 * 60 * 1000; 

async function runValidator() {
  console.log(`\n======================================================`);
  console.log(`🚀[WORKER START] ID: ${WORKER_ID} | Direct DB Mode`);
  console.log(`======================================================`);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!, 
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  for (let cycle = 1; cycle <= 10; cycle++) {
    let currentJobId = null;
    console.log(`\n>>> [WORKER ${WORKER_ID}] Starting CYCLE ${cycle}/10 <<<`);

    try {
      // 1. Get Work via RPC
      const { data: packet, error: rpcErr } = await supabase.rpc('get_validation_work', { p_worker_id: WORKER_ID });

      if (rpcErr) throw new Error(`RPC Error: ${rpcErr.message}`);
      if (packet.error === 'NO_WORK' || packet.error === 'NO_API_KEY') {
        console.log(`[WORKER ${WORKER_ID}] No work or no keys available: ${packet.error}.`);
        break;
      }

      const { job_id, words, api_key, key_id } = packet;
      currentJobId = job_id;
      console.log(`[WORKER ${WORKER_ID}] CLAIMED Job ID: ${currentJobId} | Words to process: ${words.length}`);

      // 2. Prepare AI Prompt Input
      // We format the array into a numbered list for the AI to maintain ID mapping
      const formattedList = words.map((w: string, idx: number) => `${idx}. ${w}`).join('\n');

      // 3. AI Processing Loop
      let finalResults = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          console.log(`[AI] Attempt ${attempt}/3 for Job ${currentJobId}...`);
          
          const systemInstruction = `YOU ARE AN AMHARIC LINGUIST. (Prompt Placeholder - To be updated) task: identify if words are roots.`;

          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), AI_TIMEOUT);

          const aiResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${api_key}`, {
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: `SYSTEM: ${systemInstruction}\n\nDATA TO PROCESS:\n${formattedList}` }] }],
              generationConfig: { responseMimeType: 'application/json', temperature: 0.1 }
            }),
            signal: controller.signal
          });
          clearTimeout(timeoutId);

          if (aiResp.status === 429 || aiResp.status === 503) {
             await supabase.from('api_keys').update({ cooldown_until: new Date(Date.now() + COOLDOWN_DURATION).toISOString() }).eq('id', key_id);
             throw new Error('API_LIMIT_REACHED');
          }

          const result = await aiResp.json();
          const rawText = result.candidates?.[0]?.content?.parts?.[0]?.text || "";
          
          // Basic JSON extraction logic
          try {
            const parsed = JSON.parse(rawText);
            finalResults = Array.isArray(parsed) ? parsed : (parsed.data || null);
          } catch (e) {
            console.warn("[AI] JSON Parse failed, retrying chunk extraction...");
            // Fallback to extraction if AI wraps JSON in markdown or text
            const match = rawText.match(/\\[[\\s\\S]*\\]/);
            if (match) finalResults = JSON.parse(match[0]);
          }

          if (finalResults) break;
        } catch (err) {
          console.error(`[AI ERROR] ${err.message}`);
          if (attempt === 3) throw err;
          await new Promise(r => setTimeout(r, 2000 * attempt));
        }
      }

      // 4. Save to root_validation_results
      if (finalResults) {
        const toInsert = finalResults.map((item: any) => ({
          original_word: words[item.id], 
          is_root: !!item.is_root,
          real_root: item.is_root ? null : (item.real_root || null)
        }));

        const { error: insErr } = await supabase.from('root_validation_results').upsert(toInsert, { onConflict: 'original_word' });
        if (insErr) throw insErr;

        // 5. Mark Done
        await supabase.rpc('mark_validation_done', { p_job_id: currentJobId });
        console.log(`[SUCCESS] Job ${currentJobId} completed.`);
      }

    } catch (err) {
      console.error(`[CRITICAL] Job ${currentJobId} failed: ${err.message}`);
      if (currentJobId) {
        await supabase.rpc('fail_validation_work', { p_job_id: currentJobId, p_error: err.message });
      }
      await new Promise(r => setTimeout(r, 5000));
    }
  }
  console.log(`🛑 [WORKER ${WORKER_ID}] Finished session.`);
}

runValidator();