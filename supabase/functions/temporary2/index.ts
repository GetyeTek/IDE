import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const BUCKET = 'V2';
const SOURCE_FILE = 'freq_2.txt';
const FOLDER = 'freq_2';
const WORDS_PER_FILE = 100;
const FILES_PER_BATCH = 25; 

serve(async (req) => {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // 1. Get current progress from the database
    const { data: state, error: stateError } = await supabase
      .from('processing_state')
      .select('*')
      .eq('source_filename', SOURCE_FILE)
      .single();

    if (stateError || !state) {
      throw new Error("Could not find processing state in DB. Ensure SQL was run.");
    }

    // Determine starting point based on DB state
    const startWordIndex = state.last_word_index_processed || 0;

    // 2. Download the master file
    const { data: fileData, error: downloadError } = await supabase.storage
      .from(BUCKET)
      .download(SOURCE_FILE);

    if (downloadError) throw downloadError;

    const text = await fileData.text();
    const allWords = text.trim().split(/\s+/);
    const totalWords = allWords.length;

    if (startWordIndex >= totalWords) {
      return new Response(JSON.stringify({ message: "Already completed all words." }), { status: 200 });
    }

    const createdFiles = [];
    let currentPointer = startWordIndex;

    // 3. Loop to create 25 files
    for (let i = 0; i < FILES_PER_BATCH; i++) {
      if (currentPointer >= totalWords) break;

      const fileStartIndex = currentPointer;
      const fileEndIndex = Math.min(fileStartIndex + WORDS_PER_FILE, totalWords);
      
      const chunk = allWords.slice(fileStartIndex, fileEndIndex);
      
      // 4. ADD CONTINUOUS NUMBERING
      // We use (fileStartIndex + index + 1) to get the global position
      const numberedContent = chunk.map((word, index) => {
        const globalNumber = fileStartIndex + index + 1;
        return `${globalNumber}. ${word}`;
      }).join('\n');

      // 5. Calculate global batch/file ID for the filename
      const globalFileIndex = Math.floor(currentPointer / WORDS_PER_FILE) + 1;
      const filePath = `${FOLDER}/batch_${globalFileIndex}.txt`;

      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(filePath, numberedContent, {
          contentType: 'text/plain',
          upsert: true
        });

      if (!uploadError) {
        createdFiles.push(filePath);
        currentPointer = fileEndIndex; // Move pointer forward
      }
    }

    // 6. Update the Tracking Table with new progress
    const isFinished = currentPointer >= totalWords;
    const { error: dbUpdateError } = await supabase
      .from('processing_state')
      .update({ 
        total_words_found: totalWords,
        last_word_index_processed: currentPointer,
        total_files_created: Math.ceil(currentPointer / WORDS_PER_FILE),
        status: isFinished ? 'completed' : 'processing',
        updated_at: new Date().toISOString()
      })
      .eq('source_filename', SOURCE_FILE);

    if (dbUpdateError) throw dbUpdateError;

    return new Response(
      JSON.stringify({ 
        status: "success",
        resumed_from: startWordIndex,
        stopped_at: currentPointer,
        files_created: createdFiles.length,
        total_progress: `${((currentPointer / totalWords) * 100).toFixed(2)}%`
      }), 
      { headers: { "Content-Type": "application/json" } }
    );

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
})