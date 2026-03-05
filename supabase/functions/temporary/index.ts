import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7'

Deno.serve(async (req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  )

  const WORDS_PER_FILE = 100;
  const BATCH_SIZE = 25000; // PROCESS 25,000 WORDS PER TRIGGER (250 Files)

  try {
    const startTime = Date.now();

    // 1. READ CHECKPOINT
    const { data: checkpoint, error: cpErr } = await supabase
      .from('export_checkpoint')
      .select('last_offset')
      .eq('id', 1)
      .single();

    if (cpErr) throw new Error("Checkpoint not found. Run SQL first.");
    const currentOffset = checkpoint.last_offset;

    // 2. GET TOTAL REMAINING (For display)
    const { data: totalCount } = await supabase.rpc('get_low_confidence_count');

    // 3. FETCH LARGE BLOCK FROM DB
    console.log(`[START] Fetching ${BATCH_SIZE} words from offset ${currentOffset}...`);
    const { data: wordList, error: fetchErr } = await supabase.rpc('get_low_confidence_words', {
      p_limit: BATCH_SIZE,
      p_offset: currentOffset
    });

    if (fetchErr) throw fetchErr;
    if (!wordList || wordList.length === 0) {
      return new Response(JSON.stringify({ message: "COMPLETE: No more words to export." }));
    }

    // 4. GENERATE AND UPLOAD FILES
    const totalFilesToCreate = Math.ceil(wordList.length / WORDS_PER_FILE);
    console.log(`[PROCESS] Creating ${totalFilesToCreate} files...`);

    for (let i = 0; i < wordList.length; i += WORDS_PER_FILE) {
      const chunk = wordList.slice(i, i + WORDS_PER_FILE);
      const globalStart = currentOffset + i + 1;
      const globalEnd = currentOffset + i + chunk.length;

      // Fast string builder
      let fileContent = "";
      for (let j = 0; j < chunk.length; j++) {
        fileContent += `${currentOffset + i + j + 1}. ${chunk[j].extracted_word}\n`;
      }

      const fileName = `inspection_set_${globalStart}_to_${globalEnd}.txt`;

      // Upload (Wait for each to ensure we don't overwhelm the network)
      const { error: uploadErr } = await supabase.storage
        .from('inspection_bucket')
        .upload(fileName, fileContent, { upsert: true });
        
      if (uploadErr) console.error(`Failed ${fileName}:`, uploadErr.message);
    }

    // 5. UPDATE PROGRESS
    const nextOffset = currentOffset + wordList.length;
    await supabase
      .from('export_checkpoint')
      .update({ last_offset: nextOffset, updated_at: new Date().toISOString() })
      .eq('id', 1);

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    const percent = ((nextOffset / Number(totalCount)) * 100).toFixed(2);

    return new Response(JSON.stringify({
      status: "SUCCESS",
      time_taken: `${duration}s`,
      files_created: totalFilesToCreate,
      last_word_exported: nextOffset,
      completion: `${percent}%`,
      remaining: Number(totalCount) - nextOffset,
      instruction: "Refresh or trigger again to process next 25k words."
    }), { headers: { "Content-Type": "application/json" } });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
})