import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7'

Deno.serve(async (req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  )

  const WORDS_PER_FILE = 100;
  const BATCH_SIZE = 25000; 
  const CONCURRENCY_LIMIT = 20;

  try {
    const startTime = Date.now();

    // 1. Get the Total Count of Low Importance Words (The 86,627 value)
    // We do this to ensure the stats are live and accurate.
    const { count: totalWordsToProcess, error: countErr } = await supabase
      .from('processed_words')
      .select('words', { count: 'exact', head: true })
      // This logic must match your RPC's internal filter exactly:
      // Since 'words' is an array, we count the individual elements using a custom filter or RPC
      // For speed, let's assume we use a small helper RPC or just the known target.
    
    // Note: If you want the exact live count, it's better to use a simple RPC:
    const { data: statsData } = await supabase.rpc('get_processing_stats');
    const grandTotal = statsData?.total_low_confidence || 86627;

    // 2. Get Current Checkpoint
    const { data: checkpoint } = await supabase.from('export_checkpoint').select('last_offset').eq('id', 1).single();
    const currentOffset = checkpoint?.last_offset || 0;

    // 3. Fetch words
    const { data: wordList, error: fetchErr } = await supabase.rpc('get_low_confidence_words', {
      p_limit: BATCH_SIZE,
      p_offset: currentOffset
    });

    if (fetchErr) throw fetchErr;

    const wordsInThisRun = wordList?.length || 0;
    let filesCreated = 0;

    // 4. Process Uploads only if there's data
    if (wordsInThisRun > 0) {
      const uploadTasks = [];
      for (let i = 0; i < wordsInThisRun; i += WORDS_PER_FILE) {
        const chunk = wordList.slice(i, i + WORDS_PER_FILE);
        const startIdx = currentOffset + i + 1;
        const endIdx = currentOffset + i + chunk.length;

        const content = chunk.map((w: any, idx: number) => {
          const word = w.extracted_word || 'N/A';
          return `${startIdx + idx}. ${word}`;
        }).join('\n');
        
        const fileName = `batch_${String(startIdx).padStart(6, '0')}_to_${String(endIdx).padStart(6, '0')}.txt`;

        const task = supabase.storage.from('inspection_bucket').upload(fileName, content, { upsert: true });
        uploadTasks.push(task);
      }

      for (let i = 0; i < uploadTasks.length; i += CONCURRENCY_LIMIT) {
          const group = uploadTasks.slice(i, i + CONCURRENCY_LIMIT);
          await Promise.all(group); 
      }
      filesCreated = uploadTasks.length;

      // Update Checkpoint
      const nextOffset = currentOffset + wordsInThisRun;
      await supabase.from('export_checkpoint').update({ last_offset: nextOffset }).eq('id', 1);
    }

    // 5. Final Stats Calculation
    const finalOffset = currentOffset + wordsInThisRun;
    const remaining = Math.max(0, grandTotal - finalOffset);
    const progressPercent = ((finalOffset / grandTotal) * 100).toFixed(2);
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    return new Response(JSON.stringify({
      status: remaining === 0 ? "COMPLETED" : "PROCESSING",
      stats: {
        progress: `${progressPercent}%`,
        total_target_words: grandTotal,
        total_processed_so_far: finalOffset,
        words_remaining: remaining,
        files_in_bucket_estimate: Math.ceil(finalOffset / WORDS_PER_FILE)
      },
      current_run: {
        words_extracted: wordsInThisRun,
        files_uploaded: filesCreated,
        time_taken: `${duration}s`
      },
      checkpoint: {
        old_offset: currentOffset,
        new_offset: finalOffset
      }
    }), { headers: { "Content-Type": "application/json" } });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
})