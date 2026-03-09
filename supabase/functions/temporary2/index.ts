import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const BUCKET = 'V2';
const WORDS_PER_FILE = 100;
const FILES_PER_BATCH = 50;

const FILE_LIST = ['freq_4.txt', 'freq_5.txt', 'freq_6.txt', 'freq_7.txt', 'freq_8.txt', 'freq_9.txt', 'freq_10.txt', 'freq_11.txt', 'freq_12.txt', 'freq_13.txt', 'freq_14.txt', 'freq_15.txt', 'freq_16.txt', 'freq_17.txt', 'freq_18.txt', 'freq_19.txt', 'freq_20.txt', 'freq_21.txt', 'freq_22.txt', 'freq_23.txt', 'freq_24.txt', 'freq_25.txt', 'freq_26.txt', 'freq_27.txt', 'freq_28.txt', 'freq_29.txt', 'freq_30.txt', 'freq_31.txt', 'freq_32.txt', 'freq_33.txt', 'freq_34.txt', 'freq_35.txt', 'freq_36.txt', 'freq_37.txt', 'freq_38.txt', 'freq_39.txt', 'freq_40.txt', 'freq_41.txt', 'freq_42.txt', 'freq_43.txt', 'freq_44.txt', 'freq_45.txt', 'freq_46.txt', 'freq_47.txt', 'freq_48.txt', 'freq_49.txt', 'freq_50.txt', 'freq_51.txt', 'freq_52.txt', 'freq_53.txt', 'freq_54.txt', 'freq_55.txt', 'freq_56.txt', 'freq_57.txt', 'freq_58.txt', 'freq_59.txt', 'freq_60.txt', 'freq_61.txt', 'freq_62.txt', 'freq_63.txt', 'freq_64.txt', 'freq_65.txt', 'freq_66.txt', 'freq_67.txt', 'freq_68.txt', 'freq_69.txt', 'freq_70.txt', 'freq_71.txt', 'freq_72.txt', 'freq_73.txt', 'freq_74.txt', 'freq_75.txt', 'freq_76.txt', 'freq_77.txt', 'freq_78.txt', 'freq_79.txt', 'freq_80.txt', 'freq_81.txt', 'freq_82.txt', 'freq_83.txt', 'freq_84.txt', 'freq_85.txt', 'freq_86.txt', 'freq_87.txt', 'freq_88.txt', 'freq_89.txt', 'freq_90.txt', 'freq_91.txt', 'freq_92.txt', 'freq_93.txt', 'freq_94.txt', 'freq_95.txt', 'freq_96.txt', 'freq_97.txt', 'freq_98.txt', 'freq_99.txt', 'freq_100.txt', 'freq_101.txt', 'freq_102.txt', 'freq_103.txt', 'freq_104.txt', 'freq_105.txt', 'freq_106.txt', 'freq_107.txt', 'freq_108.txt', 'freq_109.txt', 'freq_110.txt', 'freq_111.txt', 'freq_112.txt', 'freq_113.txt', 'freq_114.txt', 'freq_115.txt', 'freq_116.txt', 'freq_117.txt', 'freq_118.txt', 'freq_119.txt', 'freq_120.txt', 'freq_121.txt', 'freq_122.txt', 'freq_123.txt', 'freq_124.txt', 'freq_125.txt', 'freq_126.txt', 'freq_127.txt', 'freq_128.txt', 'freq_129.txt', 'freq_130.txt', 'freq_131.txt', 'freq_132.txt', 'freq_133.txt', 'freq_134.txt', 'freq_135.txt', 'freq_136.txt', 'freq_137.txt', 'freq_138.txt', 'freq_139.txt', 'freq_140.txt', 'freq_141.txt', 'freq_142.txt', 'freq_143.txt', 'freq_144.txt', 'freq_145.txt', 'freq_146.txt', 'freq_147.txt', 'freq_148.txt', 'freq_149.txt', 'freq_150.txt', 'freq_151.txt', 'freq_152.txt', 'freq_153.txt', 'freq_154.txt', 'freq_155.txt', 'freq_157.txt', 'freq_158.txt', 'freq_160.txt', 'freq_162.txt', 'freq_165.txt', 'freq_167.txt', 'freq_169.txt', 'freq_171.txt', 'freq_172.txt', 'freq_174.txt', 'freq_176.txt', 'freq_181.txt', 'freq_182.txt', 'freq_197.txt'];

// Global error listeners for Deno platform-level errors
self.addEventListener("unhandledrejection", (e) => {
  console.error("[FATAL UNHANDLED REJECTION]:", e.reason);
});

serve(async (req) => {
  console.log("[START] Function Invoked");
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    let state = null;
    let fileData = null;
    let SOURCE_FILE = "";
    let FOLDER = "";

    // --- SEQUENTIAL MANIFEST PROCESSING ---
    for (const filename of FILE_LIST) {
      // 1. Check DB for this specific file
      let { data: existingState, error: stateError } = await supabase
        .from('processing_state_union')
        .select('*')
        .eq('source_filename', filename)
        .maybeSingle();

      if (stateError) throw stateError;

      // 2. If already completed, move to next file in manifest
      if (existingState && existingState.status === 'completed') {
        continue;
      }

      // 3. If no state exists, initialize it (Upsert)
      if (!existingState) {
        console.log(`[INIT] Creating state for ${filename}`);
        const subfolder = filename.replace('.txt', '');
        const { data: newState, error: insertError } = await supabase
          .from('processing_state_union')
          .upsert({
            source_filename: filename,
            subfolder_name: subfolder,
            status: 'processing',
            last_word_index_processed: 0
          })
          .select()
          .single();
        
        if (insertError) throw insertError;
        existingState = newState;
      }

      // 4. Try to download the file
      const { data: dl, error: downloadError } = await supabase.storage
        .from(BUCKET)
        .download(filename);

      if (downloadError) {
        console.error(`[MISSING] ${filename} not found in storage. Skipping.`);
        await supabase.from('processing_state_union').update({ status: 'skipped_missing' }).eq('source_filename', filename);
        continue;
      }

      // Found a valid file to process!
      state = existingState;
      SOURCE_FILE = filename;
      FOLDER = `union/${state.subfolder_name}`;
      fileData = dl;
      console.log(`[PROCESSING] ${SOURCE_FILE}`);
      break;
    }

    if (!fileData) {
      return new Response(JSON.stringify({ message: "All files in manifest are completed." }), { status: 200 });
    }

    // Determine starting point based on DB state
    const startWordIndex = state.last_word_index_processed || 0;

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
      .from('processing_state_union')
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
    // LOG TO CONSOLE AS RAW (This is your best chance to see it in Supabase Logs)
    console.error("--- CRITICAL EXECUTION FAILURE ---");
    console.error("Error Name:", error?.name);
    console.error("Error Message:", error?.message);
    console.error("Stack Trace:", error?.stack);
    console.error("Raw Error String:", String(error));
    
    return new Response(
      JSON.stringify({ 
        error: "Execution Failed", 
        msg: error?.message, 
        name: error?.name 
      }), 
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
})