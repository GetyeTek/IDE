import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const BUCKET = 'V2';
const SOURCE_FILE = 'freq_2.txt';
const WORDS_PER_FILE = 100;
const FILES_PER_BATCH = 25; 

serve(async (req) => {
  try {
    // 1. Initialize Supabase Client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // 2. Parse and Validate Batch Number (Fixes the NaN issue)
    const body = await req.json().catch(() => ({}));
    const batch_number = Number(body.batch_number);
    
    if (isNaN(batch_number)) {
      return new Response(
        JSON.stringify({ error: "Invalid batch_number. Please provide a number in the JSON body." }), 
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // 3. Download the source Amharic word list
    const { data: fileData, error: downloadError } = await supabase.storage
      .from(BUCKET)
      .download(SOURCE_FILE);

    if (downloadError || !fileData) {
      throw new Error(`Could not download ${SOURCE_FILE}: ${downloadError?.message}`);
    }

    const text = await fileData.text();
    // Use regex to split by any whitespace (spaces, tabs, newlines)
    const allWords = text.split(/\s+/).filter(w => w.trim().length > 0);
    const totalWords = allWords.length;

    // 4. Calculate Slices
    const wordsPerExecution = FILES_PER_BATCH * WORDS_PER_FILE; // 2,500
    const startWordIndex = batch_number * wordsPerExecution;
    const endWordIndex = Math.min(startWordIndex + wordsPerExecution, totalWords);

    if (startWordIndex >= totalWords) {
      return new Response(
        JSON.stringify({ message: "Done! Start index exceeds total word count.", total_words: totalWords }), 
        { status: 200 }
      );
    }

    // 5. State Tracking: Mark as processing
    await supabase.from('processing_state')
      .update({ total_words_found: totalWords, status: 'processing' })
      .eq('source_filename', SOURCE_FILE);

    const createdFiles = [];

    // 6. Logic Loop: Create 25 files
    for (let i = 0; i < FILES_PER_BATCH; i++) {
      const fileStartIndex = startWordIndex + (i * WORDS_PER_FILE);
      const fileEndIndex = fileStartIndex + WORDS_PER_FILE;

      // Stop if we run out of words
      if (fileStartIndex >= totalWords) break;

      const chunk = allWords.slice(fileStartIndex, fileEndIndex);
      const content = chunk.join('\n');
      
      // Filename logic: freq_2/batch_1.txt, freq_2/batch_2.txt...
      const globalFileIndex = (batch_number * FILES_PER_BATCH) + i + 1;
      const filePath = `freq_2/batch_${globalFileIndex}.txt`;

      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(filePath, content, {
          contentType: 'text/plain',
          upsert: true // Allows re-running without "file already exists" errors
        });

      if (!uploadError) {
        createdFiles.push(filePath);
      } else {
        console.error(`Upload error for ${filePath}:`, uploadError);
      }
    }

    // 7. Update Tracking Table
    const isFinished = endWordIndex >= totalWords;
    const { error: updateError } = await supabase.from('processing_state')
      .update({ 
        last_word_index_processed: endWordIndex,
        total_files_created: (batch_number * FILES_PER_BATCH) + createdFiles.length,
        status: isFinished ? 'completed' : 'processing',
        updated_at: new Date().toISOString()
      })
      .eq('source_filename', SOURCE_FILE);

    // 8. Final Response
    return new Response(
      JSON.stringify({ 
        status: "success",
        batch_processed: batch_number,
        processed_range: `${startWordIndex} to ${endWordIndex}`,
        files_created: createdFiles.length,
        total_words: totalWords,
        is_completed: isFinished
      }), 
      { headers: { "Content-Type": "application/json" } }
    );

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }), 
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
})