import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const BUCKET = 'V2';
const WORDS_PER_FILE = 100;
const FILES_PER_BATCH = 25; // 2,500 words per request

serve(async (req) => {
  try {
    // 1. Setup Supabase Client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // 2. Parse request body (Expects {"batch_number": 0})
    const { batch_number } = await req.json();
    
    // 3. Download the source file
    const { data: fileData, error: downloadError } = await supabase.storage
      .from(BUCKET)
      .download('freq_2.txt');

    if (downloadError) throw downloadError;

    const text = await fileData.text();
    // Split by any whitespace/newlines and filter out empties
    const allWords = text.split(/\s+/).filter(w => w.length > 0);
    const totalWords = allWords.length;

    // 4. Calculate offsets
    // batch_number 0 starts at word 0
    // Each batch processes (25 files * 100 words) = 2,500 words
    const wordsPerExecution = FILES_PER_BATCH * WORDS_PER_FILE;
    const startWordIndex = batch_number * wordsPerExecution;
    const endWordIndex = Math.min(startWordIndex + wordsPerExecution, totalWords);

    if (startWordIndex >= totalWords) {
      return new Response(JSON.stringify({ message: "All words processed already" }), { status: 200 });
    }

    // 5. Update state to 'processing'
    await supabase.from('processing_state')
      .update({ total_words_found: totalWords, status: 'processing' })
      .eq('source_filename', 'freq_2.txt');

    const createdFiles = [];

    // 6. Loop to create 25 files
    for (let i = 0; i < FILES_PER_BATCH; i++) {
      const fileStartIndex = startWordIndex + (i * WORDS_PER_FILE);
      const fileEndIndex = fileStartIndex + WORDS_PER_FILE;

      if (fileStartIndex >= totalWords) break;

      const chunk = allWords.slice(fileStartIndex, fileEndIndex);
      const content = chunk.join('\n');
      
      // Filename: freq_2/chunk_1.txt, freq_2/chunk_2.txt, etc.
      // Global count: (batch_number * 25) + i
      const globalFileIndex = (batch_number * FILES_PER_BATCH) + i + 1;
      const filePath = `freq_2/batch_${globalFileIndex}.txt`;

      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(filePath, content, {
          contentType: 'text/plain',
          upsert: true
        });

      if (!uploadError) createdFiles.push(filePath);
    }

    // 7. Update tracking table
    const { error: updateError } = await supabase.from('processing_state')
      .update({ 
        last_word_index_processed: endWordIndex,
        total_files_created: (batch_number * FILES_PER_BATCH) + createdFiles.length,
        status: endWordIndex >= totalWords ? 'completed' : 'processing'
      })
      .eq('source_filename', 'freq_2.txt');

    return new Response(
      JSON.stringify({ 
        processed_range: `${startWordIndex} to ${endWordIndex}`,
        files_created: createdFiles.length,
        total_words: totalWords
      }), 
      { headers: { "Content-Type": "application/json" } }
    );

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
})