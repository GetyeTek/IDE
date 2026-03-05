import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

const ORCHESTRATOR_URL = 'https://xvldfsmxskhemkslsbym.supabase.co/functions/v1/validator-orchestrator';
const WORKER_ID = Deno.env.get('WORKER_ID') || `val_worker_${Math.random().toString(36).substring(7)}`;

async function runValidator() {
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // PROCESS 10 FILES PER WORKER RUN
  for (let cycle = 1; cycle <= 10; cycle++) {
    console.log(`[CYCLE ${cycle}/10] Fetching work...`);

    try {
      // 1. Get Work Packet from Orchestrator
      const resp = await fetch(ORCHESTRATOR_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'get_work', worker_id: WORKER_ID })
      });

      const packet = await resp.json();
      if (packet.error === 'NO_WORK') {
        console.log("--- NO MORE FILES TO PROCESS ---");
        break;
      }

      const { file_path, api_key, key_id } = packet;
      console.log(`[STARTING] Validating: ${file_path}`);

      // 2. Download and Parse File from Storage
      const { data: blob, error: dlErr } = await supabase.storage.from('inspection_bucket').download(file_path);
      if (dlErr) throw dlErr;

      const text = await blob.text();
      const lines = text.split('\n').filter(l => l.trim().length > 0);
      const wordMap: Record<number, string> = {};
      lines.forEach(line => {
        const match = line.match(/^(\d+)\.\s+(.+)$/);
        if (match) wordMap[parseInt(match[1])] = match[2].trim();
      });

      // 3. Prompt Gemini 3.1 Flash Lite (Using the provided key rotation)
      const systemInstruction = `
        ROLE: Amharic Linguistic Auditor.
        MISSION: Filter valid dictionary words from OCR noise.
        STRICT RULES:
        - If the string is morphological nonsense (invalid consonant clusters), DISCARD.
        - If the string is a cut-off/fragment, DISCARD.
        - If the string is OCR garbage (mixed characters), DISCARD.
        - Only include words with a valid Amharic root (መነሻ ቃል).
        - If uncertain, DISCARD. Do not guess.

        OUTPUT FORMAT (STRICT JSON):
        [{"id": number, "score": 1-10}]
        No preamble, no explanation.`;

      const aiResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-8b:generateContent?key=${api_key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemInstruction }] },
          contents: [{ parts: [{ text: `BATCH:\n${text}` }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.1 }
        })
      });

      const result = await aiResp.json();
      if (!result.candidates) throw new Error("AI Refused/Blocked request");

      const rawText = result.candidates[0].content.parts[0].text;
      const validatedList = JSON.parse(rawText);

      // 4. Map back to words and save
      const finalWords = validatedList.map((item: any) => ({
        word: wordMap[item.id],
        confidence_score: item.score,
        source_batch_file: file_path,
        original_order_index: item.id
      })).filter((w: any) => w.word);

      if (finalWords.length > 0) {
        const { error: insErr } = await supabase.from('candidate_words').insert(finalWords);
        if (insErr) throw insErr;
        console.log(`[SAVED] ${finalWords.length} words from ${file_path}`);
      }

      // 5. Cleanup status
      await fetch(ORCHESTRATOR_URL, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mark_done', file_path }) 
      });
      
      await supabase.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', key_id);

    } catch (err) {
      console.error(`[ERROR IN CYCLE] ${err.message}`);
      await new Promise(r => setTimeout(r, 2000)); // Cool down before next attempt
    }
  }
}

runValidator();