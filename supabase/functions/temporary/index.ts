import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7'

Deno.serve(async (req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  )

  const WORDS_PER_FILE = 100;
  const BATCH_SIZE = 25000; 
  const CONCURRENCY_LIMIT = 20; // Upload 20 files at the same time

  try {
    const startTime = Date.now();

    // 1. Get Checkpoint
    const { data: checkpoint } = await supabase.from('export_checkpoint').select('last_offset').eq('id', 1).single();
    const currentOffset = checkpoint?.last_offset || 0;

    // 2. Fetch words
    const { data: wordList, error: fetchErr } = await supabase.rpc('get_low_confidence_words', {
      p_limit: BATCH_SIZE,
      p_offset: currentOffset
    });

    if (fetchErr) throw fetchErr;
    if (!wordList || wordList.length === 0) return new Response(JSON.stringify({ message: "DONE" }));

    console.log(`[TURBO] Fetched ${wordList.length} words. Preparing uploads...`);

    // 3. Prepare File Batches
    const uploadTasks = [];
    for (let i = 0; i < wordList.length; i += WORDS_PER_FILE) {
      const chunk = wordList.slice(i, i + WORDS_PER_FILE);
      const startIdx = currentOffset + i + 1;
      const endIdx = currentOffset + i + chunk.length;

      const content = chunk.map((w: any, idx: number) => `${startIdx + idx}. ${w.extracted_word}`).join('\n');
      const fileName = `batch_${startIdx}_to_${endIdx}.txt`;

      // Define the upload task but don't "await" it yet
      const task = supabase.storage.from('inspection_bucket').upload(fileName, content, { upsert: true });
      uploadTasks.push(task);
    }

    // 4. Execute Uploads in Parallel Chunks (to avoid slamming the network)
    for (let i = 0; i < uploadTasks.length; i += CONCURRENCY_LIMIT) {
        const group = uploadTasks.slice(i, i + CONCURRENCY_LIMIT);
        await Promise.all(group); 
        console.log(`[PROGRESS] Uploaded ${i + group.length} / ${uploadTasks.length} files...`);
    }

    // 5. Save Progress
    const nextOffset = currentOffset + wordList.length;
    await supabase.from('export_checkpoint').update({ last_offset: nextOffset }).eq('id', 1);

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    
    return new Response(JSON.stringify({
      status: "SUCCESS",
      time: `${duration}s`,
      words_processed: wordList.length,
      files_created: uploadTasks.length,
      new_offset: nextOffset
    }));

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
})