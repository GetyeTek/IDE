import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7'

Deno.serve(async (req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  )

  const WORDS_PER_FILE = 100;
  const DB_FETCH_LIMIT = 5000; // Large batch fetch
  let offset = 0;
  let fileCount = 1;
  let totalWordsProcessed = 0;

  try {
    console.log("Starting export process...");

    while (true) {
      // 1. Fetch a large batch of words from the RPC
      const { data, error } = await supabase.rpc('get_low_confidence_words', {
        p_limit: DB_FETCH_LIMIT,
        p_offset: offset
      });

      if (error) throw error;
      if (!data || data.length === 0) break;

      // 2. Divide the batch into groups of 100
      for (let i = 0; i < data.length; i += WORDS_PER_FILE) {
        const chunk = data.slice(i, i + WORDS_PER_FILE);
        
        // 3. Format the text (1. Word1, 2. Word2...)
        const fileContent = chunk
          .map((item: any, index: number) => `${index + 1}. ${item.extracted_word}`)
          .join('\n');

        const fileName = `batch_${fileCount}.txt`;

        // 4. Upload to Storage
        const { error: uploadError } = await supabase.storage
          .from('inspection_bucket')
          .upload(fileName, fileContent, {
            contentType: 'text/plain',
            upsert: true
          });

        if (uploadError) {
          console.error(`Error uploading ${fileName}:`, uploadError.message);
        } else {
          console.log(`Successfully uploaded ${fileName}`);
        }

        fileCount++;
      }

      totalWordsProcessed += data.length;
      offset += DB_FETCH_LIMIT;

      // Safety break: stop if we've processed a huge amount in one go to avoid timeout
      // You can trigger the function again with a higher offset if needed
      if (data.length < DB_FETCH_LIMIT) break;
    }

    return new Response(JSON.stringify({ 
      message: "Export Complete", 
      files_created: fileCount - 1,
      total_words: totalWordsProcessed 
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