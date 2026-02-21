import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

serve(async (req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  const targetFile = 'rare_words_1.txt';

  try {
    console.log(`[SURVEYOR] Starting audit for ${targetFile}...`);

    // 1. Fetch Source from Storage
    const { data: storageData, error: storageErr } = await supabase.storage
      .from('Chunks')
      .download(targetFile);

    if (storageErr) throw new Error(`Storage error: ${storageErr.message}`);
    const sourceText = await storageData.text();
    const sourceLines = sourceText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);

    // 2. Fetch Processed Words from DB
    // We fetch in chunks to avoid memory issues if the table is huge
    let allProcessedWords = new Set();
    let { data: dbRecords, error: dbErr } = await supabase
      .from('processed_words')
      .select('words')
      .eq('source_file', targetFile);

    if (dbErr) throw new Error(`DB error: ${dbErr.message}`);

    dbRecords?.forEach(record => {
      record.words.forEach((item: any) => {
        if (item.word) allProcessedWords.add(item.word.trim());
      });
    });

    // 3. Comparison Logic
    let matches = 0;
    let missingIndices = [];
    let sampleMissing = [];

    for (let i = 0; i < sourceLines.length; i++) {
      const line = sourceLines[i];
      if (allProcessedWords.has(line)) {
        matches++;
      } else {
        missingIndices.push(i);
        if (sampleMissing.length < 10) sampleMissing.push({ line: i, word: line });
      }
    }

    // 4. Gap Detection (Sequential Missing blocks)
    const gaps = [];
    if (missingIndices.length > 0) {
      let gapStart = missingIndices[0];
      let last = missingIndices[0];

      for (let j = 1; j < missingIndices.length; j++) {
        if (missingIndices[j] !== last + 1) {
          if (last - gapStart > 5) { // Only log significant gaps
            gaps.push({ fromLine: gapStart, toLine: last, count: last - gapStart + 1 });
          }
          gapStart = missingIndices[j];
        }
        last = missingIndices[j];
      }
    }

    const stats = {
      file: targetFile,
      totalSourceLines: sourceLines.length,
      uniqueWordsInDB: allProcessedWords.size,
      exactMatches: matches,
      missingCount: missingIndices.length,
      coveragePct: ((matches / sourceLines.length) * 100).toFixed(2) + '%',
      significantGapsFound: gaps.length,
      topGaps: gaps.sort((a, b) => b.count - a.count).slice(0, 5),
      sampleMissingWords: sampleMissing
    };

    return new Response(JSON.stringify(stats, null, 2), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});