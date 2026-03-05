import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

const ORCHESTRATOR_URL = 'https://xvldfsmxskhemkslsbym.supabase.co/functions/v1/validator-orchestrator';
const WORKER_ID = `val_worker_${Math.random().toString(36).substring(7)}`;

async function runValidator() {
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // 1. Get Work Packet
  const resp = await fetch(ORCHESTRATOR_URL, {
    method: 'POST',
    body: JSON.stringify({ action: 'get_work', worker_id: WORKER_ID })
  });
  const { file_path, api_key, key_id, error } = await resp.json();
  if (error) { console.log("No work found."); return; }

  console.log(`[STARTING] Validating ${file_path}...`);

  // 2. Download and Parse File
  const { data: blob } = await supabase.storage.from('inspection_bucket').download(file_path);
  const text = await blob.text();
  const lines = text.split('\n').filter(l => l.trim());
  const wordMap: Record<number, string> = {};
  lines.forEach(line => {
    const match = line.match(/^(\d+)\.\s+(.+)$/);
    if (match) wordMap[parseInt(match[1])] = match[2].trim();
  });

  // 3. Prompt Gemini
  const systemInstruction = `
    ROLE: Elite Amharic Linguist / OCR Auditor.
    TASK: Identify VALID Amharic words from a list.
    
    CRITERIA FOR INVALIDITY:
    - Morphological Junk: Combinations of characters that violate Ethiopic linguistic rules (e.g., impossible consonant-vowel transitions).
    - OCR Artifacts: Strings containing residual Latin characters, numbers disguised as letters, or punctuation marks treated as letters (e.g., 'ሰላም፥' is valid but '፥፥' is not).
    - Semantic Nonsense: Strings that form a shape but have no possible root (መነሻ ቃል) or context in the Amharic language.
    - Truncation: Words that are clearly half-formed or cut off.

    OUTPUT: RETURN A JSON ARRAY OF OBJECTS ONLY. NO TEXT.
    Format: [{"id": number, "score": 1-10}]
    Only include words you are 80%+ certain are real dictionary-valid Amharic words.`;

  const aiResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-8b:generateContent?key=${api_key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemInstruction }] },
      contents: [{ parts: [{ text: `LIST TO VALIDATE:\n${text}` }] }],
      generationConfig: { responseMimeType: 'application/json' }
    })
  });

  const result = await aiResp.json();
  const validatedList = JSON.parse(result.candidates[0].content.parts[0].text);

  // 4. Extract and Save
  const finalWords = validatedList.map((item: any) => ({
    word: wordMap[item.id],
    confidence_score: item.score,
    source_batch_file: file_path,
    original_order_index: item.id
  })).filter((w: any) => w.word);

  if (finalWords.length > 0) {
    await supabase.from('candidate_words').insert(finalWords);
    console.log(`[SAVED] ${finalWords.length} valid words found in ${file_path}`);
  }

  // 5. Cleanup
  await fetch(ORCHESTRATOR_URL, { method: 'POST', body: JSON.stringify({ action: 'mark_done', file_path }) });
  await supabase.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', key_id);
}

runValidator();