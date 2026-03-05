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

      const aiResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${api_key}`, {
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemInstruction }] },
          contents: [{ parts: [{ text: `BATCH:\n${text}` }] }],
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
        })
      });

      const result = await aiResp.json();

      if (!result.candidates || result.candidates.length === 0) {
        const feedback = result.promptFeedback ? JSON.stringify(result.promptFeedback) : "No Feedback";
        const err = result.error ? JSON.stringify(result.error) : "None";
        throw new Error(`AI_REFUSAL for ${file_path}: Feedback: ${feedback} | Error: ${err} | Full: ${JSON.stringify(result)}`);
      }

      const rawText = result.candidates[0].content.parts[0].text;

      // Robust JSON Extraction: Find the array boundaries in case of AI chatter
      const startIdx = rawText.indexOf('[');
      const endIdx = rawText.lastIndexOf(']');

      if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
        throw new Error(`JSON_NOT_FOUND: Could not find valid JSON array markers in response for ${file_path}`);
      }

      const cleanJson = rawText.substring(startIdx, endIdx + 1);
      const validatedList = JSON.parse(cleanJson);

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