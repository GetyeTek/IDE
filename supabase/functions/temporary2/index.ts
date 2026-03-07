import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// --- HARDCODED CONFIGURATION ---
const BUCKET = 'V2';
const SOURCE_FILE = 'freq_2.txt';
const FOLDER = 'freq_2';
const WORDS_PER_FILE = 100;
const FILES_PER_BATCH = 25; 
// -------------------------------

serve(async (req) => {
  try {
    // 1. Initialize Supabase Client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // 2. Parse Batch Number safely
    let batch_number = 0;
    try {
      const body = await req.json();
      // Ensure it is treated as a number
      batch_number = Number(body.batch_number) || 0;
    } catch (e) {
      console.log("No JSON body found or invalid, defaulting to batch 0");
      batch_number = 0;
    }

    // 3. Download the master file
    const { data: fileData, error: downloadError } = await supabase.storage
      .from(BUCKET)
      .download(SOURCE_FILE);

    if (downloadError) throw downloadError;

    const text = await fileData.text();
    // Split by any whitespace and remove empty strings
    const allWords = text.trim().split(/\s+/);
    const totalWords = allWords.length;

    // 4. Calculate Slices
    const wordsPerExecution = FILES_PER_BATCH * WORDS_PER_FILE; // 2500
    const startWordIndex = batch_number * wordsPerExecution;
    const endWordIndex = Math.min(startWordIndex + wordsPerExecution, totalWords);

    // Stop if we are out of bounds
    if (startWordIndex >= totalWords) {
      return new Response(JSON.stringify({ 
        status: "completed", 
        message: `Start index ${startWordIndex} exceeds total words ${totalWords}` 
      }), { status: 200 });
    }

    const createdFiles = [];

    // 5. Loop to create up to 25 files
    for (let i = 0; i < FILES_PER_BATCH; i++) {
      const fileStartIndex = startWordIndex + (i * WORDS_PER_FILE);
      const fileEndIndex = fileStartIndex + WORDS_PER_FILE;

      // Break loop if we run out of words mid-batch
      if (fileStartIndex >= totalWords) break;

      const chunk = allWords.slice(fileStartIndex, fileEndIndex);
      const content = chunk.join('\n');
      
      // Filename calculation
      const globalFileIndex = (batch_number * FILES_PER_BATCH) + i + 1;
      const filePath = `${FOLDER}/batch_${globalFileIndex}.txt`;

      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(filePath, content, {
          contentType: 'text/plain',
          upsert: true
        });

      if (!uploadError) {
        createdFiles.push(filePath);
      } else {
        console.error(`Failed to upload ${filePath}:`, uploadError);
      }
    }

    // 6. Update the Tracking Table (SQL)
    const isFinished = endWordIndex >= totalWords;
    const { error: dbError } = await supabase
      .from('processing_state')
      .update({ 
        total_words_found: totalWords,
        last_word_index_processed: endWordIndex,
        total_files_created: (batch_number * FILES_PER_BATCH) + createdFiles.length,
        status: isFinished ? 'completed' : 'processing',
        updated_at: new Date().toISOString()
      })
      .eq('source_filename', SOURCE_FILE);

    if (dbError) console.error("Database update error:", dbError);

    // 7. Success Response
    return new Response(
      JSON.stringify({ 
        batch_processed: batch_number,
        processed_range: `${startWordIndex} to ${endWordIndex}`,
        files_created_in_this_run: createdFiles.length,
        total_words_in_source: totalWords,
        is_source_complete: isFinished
      }), 
      { 
        headers: { "Content-Type": "application/json" },
        status: 200 
      }
    );

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }), 
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
})