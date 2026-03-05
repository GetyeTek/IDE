import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7'

Deno.serve(async (req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  )

  const WORDS_PER_FILE = 100;
  const TARGET_BATCH_SIZE = 25000; // Total words we WANT to process in this run
  const INTERNAL_FETCH_SIZE = 1000; // Max allowed by Supabase API per call
  const CONCURRENCY_LIMIT = 30;

  try {
    const startTime = Date.now();

    // 1. Get Live Stats
    const { data: statsData } = await supabase.rpc('get_processing_stats');
    const grandTotal = statsData || 86627;

    // 2. Get Current Checkpoint
    const { data: checkpoint } = await supabase.from('export_checkpoint').select('last_offset').eq('id', 1).single();
    let currentOffset = checkpoint?.last_offset || 0;

    // 3. Fetch words in a loop until we hit TARGET_BATCH_SIZE or run out of data
    let allWords = [];
    console.log(`[START] Fetching words starting from ${currentOffset}...`);
    
    while (allWords.length < TARGET_BATCH_SIZE) {
      const remainingToFetch = TARGET_BATCH_SIZE - allWords.length;
      const fetchSize = Math.min(INTERNAL_FETCH_SIZE, remainingToFetch);

      const { data: chunk, error: fetchErr } = await supabase.rpc('get_low_confidence_words', {
        p_limit: fetchSize,
        p_offset: currentOffset + allWords.length
      });

      if (fetchErr) throw fetchErr;
      if (!chunk || chunk.length === 0) break; // No more words in DB

      allWords.push(...chunk);
      if (chunk.length < fetchSize) break; // Reached the end of the database
    }

    const wordsInThisRun = allWords.length;
    let filesCreated = 0;

    // 4. Process Uploads
    if (wordsInThisRun > 0) {
      const uploadTasks = [];
      for (let i = 0; i < wordsInThisRun; i += WORDS_PER_FILE) {
        const chunk = allWords.slice(i, i + WORDS_PER_FILE);
        const startIdx = currentOffset + i + 1;
        const endIdx = currentOffset + i + chunk.length;

        const content = chunk.map((w: any, idx: number) => {
          return `${startIdx + idx}. ${w.extracted_word || 'N/A'}`;
        }).join('\n');
        
        const fileName = `batch_${String(startIdx).padStart(6, '0')}_to_${String(endIdx).padStart(6, '0')}.txt`;
        uploadTasks.push(supabase.storage.from('inspection_bucket').upload(fileName, content, { upsert: true }));
      }

      for (let i = 0; i < uploadTasks.length; i += CONCURRENCY_LIMIT) {
          await Promise.all(uploadTasks.slice(i, i + CONCURRENCY_LIMIT)); 
      }
      filesCreated = uploadTasks.length;

      // Update Checkpoint in DB
      const nextOffset = currentOffset + wordsInThisRun;
      await supabase.from('export_checkpoint').update({ last_offset: nextOffset }).eq('id', 1);
      currentOffset = nextOffset;
    }

    // 5. Final Stats
    const remaining = Math.max(0, grandTotal - currentOffset);
    const progressPercent = ((currentOffset / grandTotal) * 100).toFixed(2);
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    return new Response(JSON.stringify({
      status: remaining === 0 ? "COMPLETED" : "PROCESSING",
      stats: {
        progress: `${progressPercent}%`,
        total_target_words: grandTotal,
        total_processed_so_far: currentOffset,
        words_remaining: remaining,
        files_in_bucket_estimate: Math.ceil(currentOffset / WORDS_PER_FILE)
      },
      current_run: {
        words_extracted: wordsInThisRun,
        files_uploaded: filesCreated,
        time_taken: `${duration}s`
      }
    }), { headers: { "Content-Type": "application/json" } });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
})