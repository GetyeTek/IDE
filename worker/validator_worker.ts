import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

const ORCHESTRATOR_URL = 'https://xvldfsmxskhemkslsbym.supabase.co/functions/v1/validator-orchestrator';
const WORKER_ID = Deno.env.get('WORKER_ID') || `val_worker_${Math.random().toString(36).substring(7)}`;
const AI_TIMEOUT = 120000; // 2 minutes
const COOLDOWN_DURATION = 10 * 60 * 1000; // 10 minutes

async function runValidator() {
  console.log(`\n======================================================`);
  console.log(`🚀[WORKER START] ID: ${WORKER_ID} | Timestamp: ${new Date().toISOString()}`);
  console.log(`======================================================`);

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  for (let cycle = 1; cycle <= 10; cycle++) {
    let currentFilePath = "";
    console.log(`\n>>> [WORKER ${WORKER_ID}] Starting CYCLE ${cycle}/10 <<<`);

    try {
      // 1. Get Work
      console.log(`[WORKER ${WORKER_ID}][CYCLE ${cycle}] Requesting work from orchestrator...`);
      const resp = await fetch(ORCHESTRATOR_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'get_work', worker_id: WORKER_ID })
      });

      const packet = await resp.json();
      if (packet.error === 'NO_WORK' || packet.error === 'NO_API_KEY') {
        console.log(`[WORKER ${WORKER_ID}][CYCLE ${cycle}] Orchestrator returned NO WORK: ${packet.error}. Stopping gracefully.`);
        break;
      }
      if (packet.error) {
         console.warn(`[WORKER ${WORKER_ID}][CYCLE ${cycle}] Orchestrator returned explicit error: ${packet.error}. Aborting cycle.`);
         break;
      }

      const { file_path, api_key, key_id } = packet;
      currentFilePath = file_path;
      console.log(`[WORKER ${WORKER_ID}][CYCLE ${cycle}] CLAIMED: ${currentFilePath} | Assigned Key ID: ${key_id}`);

      // 2. Download Content
      console.log(`[WORKER ${WORKER_ID}][CYCLE ${cycle}] Downloading blob for ${currentFilePath}...`);
      const { data: blob, error: dlErr } = await supabase.storage.from('inspection_bucket').download(currentFilePath);
      if (dlErr) throw dlErr; 

      const text = await blob.text();
      const lines = text.split('\n').filter(l => l.trim().length > 0);
      console.log(`[WORKER ${WORKER_ID}][CYCLE ${cycle}] Blob downloaded. Extracted ${lines.length} non-empty lines.`);
      
      const wordMap: Record<number, string> = {};
      let parsedLinesCount = 0;
      lines.forEach(line => {
        const match = line.match(/^(\d+)\.\s+(.+)$/);
        if (match) {
          wordMap[parseInt(match[1])] = match[2].trim();
          parsedLinesCount++;
        }
      });
      console.log(`[WORKER ${WORKER_ID}][CYCLE ${cycle}] Parsed ${parsedLinesCount} numbered words into memory map.`);

      // 3. AI Processing Loop
      let finalValidatedList = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          console.log(`\n[WORKER ${WORKER_ID}][CYCLE ${cycle}][AI] Attempt ${attempt}/3 starting...`);
          
          const systemInstruction = `
            ROLE: Amharic Linguistic Auditor.
            MISSION: Evaluate and score a list of candidate words based on their validity as genuine Amharic words. You MUST return a score for EVERY SINGLE WORD provided in the batch. Do not skip or omit any IDs.
            
            SCORING RULES (1-10):
            - Score 10: Perfect, pure, common Amharic word with legitimate roots (መነሻ ቃል).
            - Score 7-9: Highly likely to be a valid Amharic word.
            - Score 4-6: Suspicious, uncommon, or heavily modified, but technically possible.
            - Score 2-3: Highly unlikely to be a real word.
            - Score 1: Absolute garbage. Use this for linguistic nonsense, OCR artifacts, invalid consonant clusters, or direct transliterations of foreign/English words (e.g., ቴክኖሎጂ, ኮምፒውተር, ኢንተርኔት).

            CRITICAL DIRECTIVE:
            DO NOT REMOVE OR DISCARD ANY WORDS. You must return exactly the same number of items you received. If a word violates the rules, give it a score of 1.

            OUTPUT FORMAT (STRICT JSON ONLY):
            Template Example:[{"id": 1, "score": 10}, {"id": 2, "score": 1}, {"id": 3, "score": 8}]
            - id: The integer number found at the start of the line.
            - score: The validity likelihood (integer between 1 and 10).
            No preamble, no words, no explanations.`;

          const controller = new AbortController();
          const timeoutId = setTimeout(() => {
            console.error(`[WORKER ${WORKER_ID}][CYCLE ${cycle}][AI] Timeout exceeded (${AI_TIMEOUT}ms)!`);
            controller.abort();
          }, AI_TIMEOUT);

          console.log(`[WORKER ${WORKER_ID}][CYCLE ${cycle}][AI] Sending POST request to Gemini...`);
          const aiResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${api_key}`, {
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              system_instruction: { parts: [{ text: systemInstruction }] },
              contents: [{ parts: [{ text: `BATCH:\n${text}` }] }],
              generationConfig: { responseMimeType: 'application/json', temperature: 0.1 }
            }),
            signal: controller.signal
          });
          clearTimeout(timeoutId);

          console.log(`[WORKER ${WORKER_ID}][CYCLE ${cycle}][AI] Response received. HTTP Status: ${aiResp.status}`);

          // CRITICAL FIX: Punish the key immediately on BOTH 429 and 503 so other workers don't burn alive
          if (aiResp.status === 429 || aiResp.status === 503) {
            console.warn(`[WORKER ${WORKER_ID}][CYCLE ${cycle}][AI] Critical API failure (${aiResp.status}). Applying cooldown to Key ID: ${key_id}`);
            await supabase.from('api_keys').update({ cooldown_until: new Date(Date.now() + COOLDOWN_DURATION).toISOString() }).eq('id', key_id);
            throw new Error(aiResp.status === 429 ? 'API_RATE_LIMIT' : 'API_OVERLOAD');
          }
          if (!aiResp.ok) {
             throw new Error(`Non-200 HTTP Response: ${aiResp.status} - ${aiResp.statusText}`);
          }

          const result = await aiResp.json();
          
          if (!result.candidates || result.candidates.length === 0) {
            console.error(`[WORKER ${WORKER_ID}][CYCLE ${cycle}][AI_SIEVE] AI returned NO candidates. Body: ${JSON.stringify(result)}`);
            throw new Error(`AI returned no candidates. FinishReason: ${result.candidates?.[0]?.finishReason || 'Unknown'}`);
          }

          const rawText = result.candidates[0].content.parts[0].text || "";
          console.log(`[WORKER ${WORKER_ID}][CYCLE ${cycle}][AI_SIEVE] Raw response length: ${rawText.length} chars. Parsing JSON...`);

          const sanitize = (val: string) => val.replace(/[\u0000-\u001F\u007F-\u009F]/g, "").replace(/""/g, '"').replace(/,\s*([\}\]])/g, '$1');
          
          const starts =[...rawText.matchAll(/\[/g)].map(m => m.index || 0);
          const ends = [...rawText.matchAll(/\]/g)].map(m => m.index || 0).reverse();

          try {
            const parsed = JSON.parse(sanitize(rawText));
            if (Array.isArray(parsed)) finalValidatedList = parsed;
            else if (parsed.data && Array.isArray(parsed.data)) finalValidatedList = parsed.data;
            else if (parsed.id && parsed.score) finalValidatedList = [parsed];
          } catch (e) { 
            console.warn(`[WORKER ${WORKER_ID}][CYCLE ${cycle}][AI_SIEVE] Direct parse failed. Attempting deep chunk extraction...`);
          }

          if (!finalValidatedList) {
            for (const s of starts) {
              for (const e of ends) {
                if (e > s) {
                  const chunk = rawText.substring(s, e + 1);
                  try {
                    const candidate = JSON.parse(sanitize(chunk));
                    if (Array.isArray(candidate)) {
                      finalValidatedList = candidate;
                      break;
                    }
                  } catch (err) { continue; }
                }
              }
              if (finalValidatedList) break;
            }
          }

          if (finalValidatedList) {
             console.log(`[WORKER ${WORKER_ID}][CYCLE ${cycle}][AI_SIEVE] SUCCESS! Parsed ${finalValidatedList.length} items from AI output.`);
             break; // Success!
          }
          
          console.error(`[WORKER ${WORKER_ID}][CYCLE ${cycle}][AI_SIEVE] FATAL PARSE ERROR. Raw output:\n${rawText.substring(0, 200)}...`);
          throw new Error(`Sieve failed. Raw text could not be parsed to JSON.`);

        } catch (attemptErr) {
          console.warn(`[WORKER ${WORKER_ID}][CYCLE ${cycle}][ATTEMPT ${attempt} FAIL]: ${attemptErr.message}`);
          if (attemptErr.message === 'API_RATE_LIMIT' || attemptErr.message === 'API_OVERLOAD' || attempt === 3) throw attemptErr;
          console.log(`[WORKER ${WORKER_ID}][CYCLE ${cycle}] Retrying in ${2000 * attempt}ms...`);
          await new Promise(r => setTimeout(r, 2000 * attempt));
        }
      }

      // 4. Finalize and Save
      if (!finalValidatedList) throw new Error("All AI attempts failed. finalValidatedList is null.");

      console.log(`[WORKER ${WORKER_ID}][CYCLE ${cycle}] Mapping ${finalValidatedList.length} scored items to original words...`);
      const finalWords = finalValidatedList.map((item: any) => ({
        word: wordMap[item.id],
        confidence_score: item.score,
        source_batch_file: currentFilePath,
        original_order_index: item.id
      })).filter((w: any) => w.word !== undefined && w.word !== null);

      if (finalWords.length > 0) {
        console.log(`[WORKER ${WORKER_ID}][CYCLE ${cycle}] Inserting ${finalWords.length} highly validated words to DB...`);
        const { error: insErr } = await supabase.from('candidate_words_imp6').insert(finalWords);
        if (insErr) throw insErr;
        console.log(`[WORKER ${WORKER_ID}][CYCLE ${cycle}] DB Insert Complete.`);
      } else {
        console.warn(`[WORKER ${WORKER_ID}][CYCLE ${cycle}] WARNING: AI parsed successfully but mapped to ZERO actual words. Checking wordMap...`);
      }

      // 5. Mark Done
      console.log(`[WORKER ${WORKER_ID}][CYCLE ${cycle}] Notifying Orchestrator that file is DONE...`);
      await fetch(ORCHESTRATOR_URL, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mark_done', file_path: currentFilePath }) 
      });
      
      console.log(`[WORKER ${WORKER_ID}][CYCLE ${cycle}] File complete. Cycle finished successfully.`);

    } catch (err) {
      console.error(`\n[WORKER ${WORKER_ID}][CYCLE ${cycle}][CRITICAL ERROR] File: ${currentFilePath || 'UNKNOWN'} | Error: ${err.message}`);

      if (currentFilePath) {
        try {
          console.log(`[WORKER ${WORKER_ID}][CYCLE ${cycle}] Returning failed file to Orchestrator...`);
          await fetch(ORCHESTRATOR_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'fail_work', file_path: currentFilePath, error: err.message })
          });
          console.log(`[WORKER ${WORKER_ID}][CYCLE ${cycle}] File returned to orchestrator pool.`);
        } catch (postErr) {
          console.error(`[WORKER ${WORKER_ID}][CYCLE ${cycle}][FATAL] Could not notify orchestrator of failure:`, postErr.message);
        }
      }

      if (err.message === 'API_RATE_LIMIT' || err.message === 'API_OVERLOAD' || err.message.includes('No active/available')) {
        console.warn(`[WORKER ${WORKER_ID}][CYCLE ${cycle}] API Overload detected. Shutting down worker entirely to prevent cascading failure.`);
        break;
      }

      console.log(`[WORKER ${WORKER_ID}][CYCLE ${cycle}] Brief cooldown before next cycle...`);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
  console.log(`\n======================================================`);
  console.log(`🛑 [WORKER ${WORKER_ID}] Process terminated natively.`);
  console.log(`======================================================\n`);
}

runValidator();
