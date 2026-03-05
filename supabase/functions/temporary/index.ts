import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7'

Deno.serve(async (req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  )

  const WORDS_PER_FILE = 100;
  const BATCH_SIZE = 5000; // How many words to process per trigger

  try {
    // 1. READ CHECKPOINT FROM DATABASE
    const { data: checkpoint, error: cpErr } = await supabase
      .from('export_checkpoint')
      .select('last_offset')
      .eq('id', 1)
      .single();

    if (cpErr) throw new Error("Could not read checkpoint. Run the SQL first.");
    const currentOffset = checkpoint.last_offset;

    // 2. GET TOTAL COUNT (For progress reporting)
    const { data: totalCount } = await supabase.rpc('get_low_confidence_count');

    // 3. FETCH THE WORDS
    const { data: wordList, error: fetchErr } = await supabase.rpc('get_low_confidence_words', {
      p_limit: BATCH_SIZE,
      p_offset: currentOffset
    });

    if (fetchErr) throw fetchErr;
    if (!wordList || wordList.length === 0) {
      return new Response(JSON.stringify({ message: "All caught up! No more words to export." }));
    }

    console.log(`Processing ${wordList.length} words starting from index ${currentOffset}...`);

    // 4. GENERATE FILES
    for (let i = 0; i < wordList.length; i += WORDS_PER_FILE) {
      const chunk = wordList.slice(i, i + WORDS_PER_FILE);
      const globalStart = currentOffset + i + 1;
      const globalEnd = currentOffset + i + chunk.length;

      // Format Content: "1. Word", "2. Word"
      const fileContent = chunk
        .map((item: any, idx: number) => `${currentOffset + i + idx + 1}. ${item.extracted_word}`)
        .join('\n');

      const fileName = `inspection_set_${globalStart}_to_${globalEnd}.txt`;

      await supabase.storage
        .from('inspection_bucket')
        .upload(fileName, fileContent, { upsert: true });
    }

    // 5. UPDATE CHECKPOINT IN DATABASE
    const nextOffset = currentOffset + wordList.length;
    await supabase
      .from('export_checkpoint')
      .update({ last_offset: nextOffset, updated_at: new Date().toISOString() })
      .eq('id', 1);

    const percent = ((nextOffset / Number(totalCount)) * 100).toFixed(2);

    return new Response(JSON.stringify({
      status: "Batch Uploaded Successfully",
      range: `${currentOffset + 1} to ${nextOffset}`,
      progress: `${percent}% of total database completed`,
      remaining: Number(totalCount) - nextOffset,
      action: "Trigger again to process the next 5,000 words."
    }), { headers: { "Content-Type": "application/json" } });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
})