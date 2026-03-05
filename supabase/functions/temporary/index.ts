import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7'

Deno.serve(async (req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  )

  const WORDS_PER_FILE = 100;
  const TARGET_BATCH_SIZE = 25000; 
  const INTERNAL_FETCH_SIZE = 1000; 
  const CONCURRENCY_LIMIT = 50; // High speed

  try {
    const startTime = Date.now();

    // 1. Get Live Stats from DB
    const { data: statsData } = await supabase.rpc('get_processing_stats');
    // Fix: Handle the array return safely
    const grandTotal = Array.isArray(statsData) ? statsData[0].total_low_confidence : (statsData?.total_low_confidence || 86627);

    // 2. Get Current Checkpoint
    const { data: checkpoint } = await supabase.from('export_checkpoint').select('last_offset').eq('id', 1).single();
    const currentOffset = checkpoint?.last_offset || 0;

    // 3. Fetch words in a loop (Bypasses 1000 row API limit)
    let allWords = [];
    while (allWords.length < TARGET_BATCH_SIZE) {
      const remainingToFetch = TARGET_BATCH_SIZE - allWords.length;
      const fetchSize = Math.min(INTERNAL_FETCH_SIZE, remainingToFetch);

      const { data: chunk, error: fetchErr } = await supabase.rpc('get_low_confidence_words', {
        p_limit: fetchSize,
        p_offset: currentOffset + allWords.length
      });

      if (fetchErr) throw fetchErr;
      if (!chunk || chunk.length === 0) break;

      allWords.push(...chunk);
      if (chunk.length < fetchSize) break;
    }

    const wordsInThisRun = allWords.length;
    let filesUploadedInThisRun = 0;

    // 4. Process Uploads
    if (wordsInThisRun > 0) {
      const uploadTasks = [];
      for (let i = 0; i < wordsInThisRun; i += WORDS_PER_FILE) {
        const chunk = allWords.slice(i, i + WORDS_PER_FILE);
        const startIdx = currentOffset + i + 1;
        const endIdx = currentOffset + i + chunk.length;

        const content = chunk.map((w: any, idx: number) => `${startIdx + idx}. ${w.extracted_word || 'N/A'}`).join('\n');
        const fileName = `batch_${String(startIdx).padStart(6, '0')}_to_${String(endIdx).padStart(6, '0')}.txt`;
        
        uploadTasks.push(supabase.storage.from('inspection_bucket').upload(fileName, content, { upsert: true }));
      }

      for (let i = 0; i < uploadTasks.length; i += CONCURRENCY_LIMIT) {
          await Promise.all(uploadTasks.slice(i, i + CONCURRENCY_LIMIT)); 
      }
      filesUploadedInThisRun = uploadTasks.length;

      // Update Database Pointer
      const nextOffset = currentOffset + wordsInThisRun;
      await supabase.from('export_checkpoint').update({ last_offset: nextOffset }).eq('id', 1);
    }

    // 5. STORAGE AUDIT: Count actual files in bucket
    const { data: bucketFiles } = await supabase.storage.from('inspection_bucket').list('', { limit: 10000 });
    const actualFileCount = bucketFiles?.length || 0;

    // 6. CALCULATE FINAL STATS
    const newOffset = currentOffset + wordsInThisRun;
    const remainingWords = Math.max(0, grandTotal - newOffset);
    const progressPercent = ((newOffset / grandTotal) * 100).toFixed(2);
    
    // Sync Check: Does (Words Processed / 100) match the File Count?
    const expectedFileCount = Math.floor(newOffset / WORDS_PER_FILE);
    const isPerfectSync = actualFileCount === expectedFileCount;

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    return new Response(JSON.stringify({
      overall_status: remainingWords === 0 ? "COMPLETED" : "IN_PROGRESS",
      sync_audit: {
        is_perfect_sync: isPerfectSync,
        files_in_bucket: actualFileCount,
        files_expected: expectedFileCount,
        sync_notes: isPerfectSync ? "Database and Storage are identical." : "Minor mismatch: Check if manual deletions occurred."
      },
      progress_stats: {
        completion: `${progressPercent}%`,
        total_words_to_process: grandTotal,
        total_words_processed: newOffset,
        words_remaining: remainingWords
      },
      current_run_details: {
        words_extracted: wordsInThisRun,
        new_files_created: filesUploadedInThisRun,
        execution_time: `${duration}s`
      }
    }), { headers: { "Content-Type": "application/json" } });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
})