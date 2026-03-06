import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7'

Deno.serve(async (req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  )

  const WORDS_PER_FILE = 100;
  const TARGET_BATCH_SIZE = 25000; 
  const INTERNAL_FETCH_SIZE = 1000; 
  const CONCURRENCY_LIMIT = 40; 
  const FOLDER = "lone_wolves";

  try {
    const startTime = Date.now();

    // 1. Get Live Stats for Importance 6
    const { data: statsData } = await supabase.rpc('get_stats_lw');
    const grandTotal = Array.isArray(statsData) ? statsData[0].total_count : 47649;

    // 2. Get Checkpoint from the NEW table
    const { data: checkpoint } = await supabase.from('export_checkpoint_lw').select('last_offset').eq('id', 1).single();
    let currentOffset = checkpoint?.last_offset || 0;

    // 3. Parallel Fetch Loop
    let allWords = [];
    while (allWords.length < TARGET_BATCH_SIZE) {
      const remainingToFetch = TARGET_BATCH_SIZE - allWords.length;
      const fetchSize = Math.min(INTERNAL_FETCH_SIZE, remainingToFetch);

      const { data: chunk, error: fetchErr } = await supabase.rpc('get_lone_wolf_words', {
        p_limit: fetchSize,
        p_offset: currentOffset + allWords.length
      });

      if (fetchErr) throw fetchErr;
      if (!chunk || chunk.length === 0) break;

      allWords.push(...chunk);
      if (chunk.length < fetchSize) break;
    }

    const wordsInThisRun = allWords.length;
    let filesCreated = 0;

    // 4. Batch Uploads to the NEW folder
    if (wordsInThisRun > 0) {
      const uploadTasks = [];
      for (let i = 0; i < wordsInThisRun; i += WORDS_PER_FILE) {
        const chunk = allWords.slice(i, i + WORDS_PER_FILE);
        const startIdx = currentOffset + i + 1;
        const endIdx = currentOffset + i + chunk.length;

        const content = chunk.map((w: any, idx: number) => `${startIdx + idx}. ${w.extracted_word || 'N/A'}`).join('\n');
        
        // SAVE IN imp_6/ SUBFOLDER
        const fileName = `${FOLDER}/batch_6_${String(startIdx).padStart(6, '0')}_to_${String(endIdx).padStart(6, '0')}.txt`;
        uploadTasks.push(supabase.storage.from('inspection_bucket').upload(fileName, content, { upsert: true }));
      }

      for (let i = 0; i < uploadTasks.length; i += CONCURRENCY_LIMIT) {
          await Promise.all(uploadTasks.slice(i, i + CONCURRENCY_LIMIT)); 
      }
      filesCreated = uploadTasks.length;

      // Update the NEW checkpoint table
      const nextOffset = currentOffset + wordsInThisRun;
      await supabase.from('export_checkpoint_lw').update({ last_offset: nextOffset }).eq('id', 1);
      currentOffset = nextOffset;
    }

    // 5. Build Response Stats
    const remaining = Math.max(0, grandTotal - currentOffset);
    const progressPercent = ((currentOffset / grandTotal) * 100).toFixed(2);
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    return new Response(JSON.stringify({
      status: remaining === 0 ? "COMPLETED_IMP6" : "PROCESSING_IMP6",
      stats: {
        progress: `${progressPercent}%`,
        total_imp6_target: grandTotal,
        processed_so_far: currentOffset,
        remaining: remaining
      },
      run_details: {
        words_extracted: wordsInThisRun,
        files_uploaded: filesCreated,
        folder_path: `inspection_bucket/${FOLDER}/`,
        time: `${duration}s`
      }
    }), { headers: { "Content-Type": "application/json" } });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
})