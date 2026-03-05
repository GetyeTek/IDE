import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

const ORCHESTRATOR_URL = 'https://xvldfsmxskhemkslsbym.supabase.co/functions/v1/validator-orchestrator';
const WORKER_ID = Deno.env.get('WORKER_ID') || `val_worker_${Math.random().toString(36).substring(7)}`;
const AI_TIMEOUT = 120000; // 2 minutes
const COOLDOWN_DURATION = 10 * 60 * 1000; // 10 minutes

async function runValidator() {
  console.log(`--- VALIDATOR WORKER ${WORKER_ID} START ---`);
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  for (let cycle = 1; cycle <= 10; cycle++) {
    let currentFilePath = "";

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

      const { file_path } = packet;
      currentFilePath = file_path;
      console.log(`[CYCLE ${cycle}/10] Claimed: ${currentFilePath}`);

      // 2. Rotate API Key (Cooldown aware)
      const { data: keyRecord, error: keyError } = await supabase
        .from('api_keys')
        .select('*')
        .eq('is_active', true)
        .or(`cooldown_until.is.null,cooldown_until.lt.${new Date().toISOString()}`)
        .order('last_used_at', { ascending: true, nullsFirst: true })
        .limit(1).single();

      if (keyError || !keyRecord) throw new Error('No active/available Gemini keys.');

      // 3. Download Content
      const { data: blob, error: dlErr } = await supabase.storage.from('inspection_bucket').download(currentFilePath);
      if (dlErr) throw dlErr; 

      const text = await blob.text();
      const lines = text.split('\n').filter(l => l.trim().length > 0);
      const wordMap: Record<number, string> = {};
      lines.forEach(line => {
        const match = line.match(/^(\d+)\.\s+(.+)$/);
        if (match) wordMap[parseInt(match[1])] = match[2].trim();
      });

      // 4. Tactical Attempt Loop (Internal Retries for the same file)
      let finalValidatedList = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          console.log(`[STAGE: AI] Attempt ${attempt}/3 for ${currentFilePath}`);
          
          const systemInstruction = `
            ROLE: Amharic Linguistic Auditor.
            MISSION: Filter candidates that are either definitely valid or highly likely to be valid Amharic words.
            
            CRITICAL FILTERING RULES:
            1. RUTHLESSNESS: Remove any string that is linguistic nonsense (invalid consonant clusters or OCR artifacts).
            2. NO TRANSLITERATIONS: Discard Amharic transliterations of foreign/English words (e.g., discard ቴክኖሎጂ, ኮምፒውተር, ኢንተርኔት).
            3. PURE AMHARIC: Focus on words with legitimate Amharic roots (መነሻ ቃል).
            4. SENSE CHECK: If the character sequence does not form a meaningful word in the Amharic language, DISCARD.

            SCORING DEFINITION:
            - Score (1-10) represents the LIKELIHOOD of the word being a valid, sensical Amharic word.
            - 10: Perfect, common Amharic word.
            - 1: Highly suspicious but potentially a word.

            OUTPUT FORMAT (STRICT JSON ONLY):
            Template Example: [{"id": 1, "score": 10}, {"id": 2, "score": 7}]
            - id: The integer number found at the start of the line.
            - score: The validity likelihood (integer).
            No preamble, no words, no explanations.`;

          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), AI_TIMEOUT);

          const aiResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${keyRecord.api_key}`, {
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

          if (aiResp.status === 429) {
            await supabase.from('api_keys').update({ cooldown_until: new Date(Date.now() + COOLDOWN_DURATION).toISOString() }).eq('id', keyRecord.id);
            throw new Error('API_RATE_LIMIT');
          }
          if (aiResp.status === 503) throw new Error('API_OVERLOAD');

          const result = await aiResp.json();
          
          // Check if AI actually returned content
          if (!result.candidates || result.candidates.length === 0) {
            console.error(`[AI_NO_CANDIDATE] Full Response: ${JSON.stringify(result)}`);
            throw new Error(`AI returned no candidates. FinishReason: ${result.candidates?.[0]?.finishReason || 'Unknown'}`);
          }

          const rawText = result.candidates[0].content.parts[0].text || "";
          console.log(`[DEBUG: RAW_AI_RESPONSE]:\n${rawText}\n--- END RAW ---`);

          // --- THE SIEVE: Robust JSON extraction ---
          const sanitize = (val: string) => val.replace(/[\u0000-\u001F\u007F-\u009F]/g, "").replace(/""/g, '"').replace(/,\s*([\}\]])/g, '$1');
          
          const starts = [...rawText.matchAll(/\[/g)].map(m => m.index || 0);
          const ends = [...rawText.matchAll(/\]/g)].map(m => m.index || 0).reverse();

          if (starts.length === 0 || ends.length === 0) {
             // Fallback: Check if the rawText is a valid JSON object wrapping an array
             try {
               const parsed = JSON.parse(sanitize(rawText));
               if (Array.isArray(parsed)) finalValidatedList = parsed;
               else if (parsed.data && Array.isArray(parsed.data)) finalValidatedList = parsed.data;
               else if (parsed.id && parsed.score) finalValidatedList = [parsed]; // Handle single object case
             } catch (e) { 
               console.error(`[PARSE_ERR] Direct parse failed: ${e.message}`);
             }
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
                  } catch (err) {
                    console.warn(`[SIEVE_LOG] Failed to parse chunk at ${s}-${e}: ${err.message}`);
                    continue;
                  }
                }
              }
              if (finalValidatedList) break;
            }
          }

          if (finalValidatedList) {
             console.log(`[DEBUG] Successfully parsed ${finalValidatedList.length} items from JSON.`);
             break; // Success!
          }
          
          throw new Error(`Sieve failed. Raw output length: ${rawText.length}. Look at debug log above.`);

        } catch (attemptErr) {
          console.warn(`[ATTEMPT ${attempt} FAIL]: ${attemptErr.message}`);
          if (attemptErr.message === 'API_RATE_LIMIT' || attemptErr.message === 'API_OVERLOAD' || attempt === 3) throw attemptErr;
          await new Promise(r => setTimeout(r, 2000 * attempt));
        }
      }

      // 5. Finalize and Save
      const finalWords = finalValidatedList.map((item: any) => ({
        word: wordMap[item.id],
        confidence_score: item.score,
        source_batch_file: currentFilePath,
        original_order_index: item.id
      })).filter((w: any) => w.word);

      if (finalWords.length > 0) {
        const { error: insErr } = await supabase.from('candidate_words').insert(finalWords);
        if (insErr) throw insErr;
        console.log(`[SAVED] ${finalWords.length} words for ${currentFilePath}`);
      }

      // Mark Done
      await fetch(ORCHESTRATOR_URL, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mark_done', file_path: currentFilePath }) 
      });
      
      await supabase.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', keyRecord.id);

    } catch (err) {
      console.error(`[CRITICAL CYCLE ERROR] File: ${currentFilePath} | Error: ${err.message}`);

      // Explicitly notify Orchestrator of failure so it can be re-queued/retried later
      if (currentFilePath) {
        try {
          await fetch(ORCHESTRATOR_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              action: 'fail_work', 
              file_path: currentFilePath, 
              error: err.message 
            })
          });
          console.log(`[RELEASED] ${currentFilePath} sent back to orchestrator.`);
        } catch (postErr) {
          console.error(`[FATAL] Could not notify orchestrator of failure: ${postErr.message}`);
        }
      }

      // Stop the worker if the error is environment-related (API Limits or Overload)
      if (err.message === 'API_RATE_LIMIT' || err.message === 'API_OVERLOAD' || err.message.includes('No active/available Gemini keys')) {
        console.warn('Stopping worker to prevent sequential failures due to API/Key issues.');
        break;
      }

      // Brief cooldown before next cycle attempt
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

runValidator();