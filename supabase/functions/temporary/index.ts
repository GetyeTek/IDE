import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7'

Deno.serve(async (req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  )

  // 1. Get Offset from Request Body (default to 0)
  const { offset = 0 } = await req.json().catch(() => ({ offset: 0 }));
  
  const WORDS_PER_FILE = 100;
  const DB_FETCH_LIMIT = 5000; // Large batch fetch per execution
  let currentOffset = offset;
  let wordsInThisRun = 0;

  try {
    // 2. Get Global Progress Stats
    const { data: totalCount, error: countErr } = await supabase.rpc('get_low_confidence_count');
    if (countErr) throw countErr;

    console.log(`Starting export from offset ${currentOffset}. Total words to process: ${totalCount}`);

    // 3. Fetch the batch for this specific run
    const { data, error } = await supabase.rpc('get_low_confidence_words', {
      p_limit: DB_FETCH_LIMIT,
      p_offset: currentOffset
    });

    if (error) throw error;
    if (!data || data.length === 0) {
      return new Response(JSON.stringify({ message: "No more words to process", totalCount }), { status: 200 });
    }

    // 4. Process the words into files
    for (let i = 0; i < data.length; i += WORDS_PER_FILE) {
      const chunk = data.slice(i, i + WORDS_PER_FILE);
      
      // Add global order number (Current Offset + Index in Batch + 1)
      const fileContent = chunk
        .map((item: any, index: number) => `${currentOffset + i + index + 1}. ${item.extracted_word}`)
        .join('\n');

      // Unique filename based on the starting word number
      const startNum = currentOffset + i + 1;
      const endNum = currentOffset + i + chunk.length;
      const fileName = `words_${startNum}_to_${endNum}.txt`;

      const { error: uploadError } = await supabase.storage
        .from('inspection_bucket')
        .upload(fileName, fileContent, {
          contentType: 'text/plain',
          upsert: true
        });

      if (uploadError) console.error(`Error uploading ${fileName}:`, uploadError.message);
    }

    wordsInThisRun = data.length;
    const nextOffset = currentOffset + wordsInThisRun;
    const percentComplete = ((nextOffset / totalCount) * 100).toFixed(2);

    return new Response(JSON.stringify({ 
      status: "Success",
      progress: {
        total_low_confidence_words: totalCount,
        processed_until_now: nextOffset,
        remaining: totalCount - nextOffset,
        percent_complete: `${percentComplete}%`
      },
      instructions: `To continue, call this function again with offset: ${nextOffset}`
    }), {
      headers: { "Content-Type": "application/json" },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
})