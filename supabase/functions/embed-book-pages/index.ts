import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, accept-encoding",
};

// Config Constants
const GEMINI_MODEL = "text-embedding-004";
const CHUNK_MAX_SIZE = 1000;
const CHUNK_OVERLAP = 200;
const DIMENSIONS = 768;

// Hardcoded Testing Defaults
const DEFAULT_BOOK_ID = "38953d3b-7740-4e97-9634-66434e53f024";
const DEFAULT_BATCH_SIZE = 50;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  console.log("\n=======================================================");
  console.log(`[START] Embedding Pipeline Triggered at ${new Date().toISOString()}`);
  console.log("=======================================================\n");

  let book_id = DEFAULT_BOOK_ID;
  let batch_size = DEFAULT_BATCH_SIZE;

  try {
    const body = await req.json();
    if (body.book_id) book_id = body.book_id;
    if (body.batch_size !== undefined) batch_size = body.batch_size;
  } catch (e) {
    console.log(`[TEST RUN] No request payload parsed or GET request received. Defaulting to Book: ${book_id} | Batch Size: ${batch_size}`);
  }

  try {
    if (!book_id) {
      console.error("[FATAL ERROR] Missing required parameter: 'book_id'");
      return new Response(JSON.stringify({ error: "Missing book_id" }), { status: 400, headers: corsHeaders });
    }

    // 1. Validate Environment Variables
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const PINECONE_API_KEY = Deno.env.get('PINECONE_API_KEY');
    const PINECONE_HOST = Deno.env.get('PINECONE_INDEX_HOST');

    if (!SUPABASE_URL || !SUPABASE_KEY) console.error("[FATAL ERROR] Supabase environment variables are missing!");
    if (!PINECONE_API_KEY) console.error("[FATAL ERROR] PINECONE_API_KEY is missing from Supabase Vault!");
    if (!PINECONE_HOST) console.error("[FATAL ERROR] PINECONE_INDEX_HOST is missing from Supabase Vault!");

    if (!PINECONE_API_KEY || !PINECONE_HOST) {
      throw new Error("Server configuration error: Missing Pinecone Secrets.");
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_KEY!);

    // 2. Acquire Locked Jobs via RPC
    console.log(`[DB] Attempting to acquire up to ${batch_size} jobs for Book: ${book_id}...`);
    const { data: jobs, error: jobsError } = await supabase.rpc('acquire_embedding_jobs', {
      p_book_id: book_id,
      p_batch_size: batch_size
    });

    if (jobsError) {
      console.error(`[DB ERROR] Failed to acquire jobs from RPC: ${jobsError.message}`);
      throw jobsError;
    }

    if (!jobs || jobs.length === 0) {
      console.log(`[EXIT] No pending or retriable jobs found for Book: ${book_id}. Pipeline idle.`);
      return new Response(JSON.stringify({ message: "No jobs to process." }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    console.log(`[SUCCESS] Acquired ${jobs.length} jobs. Locking rows for processing...`);

    // 3. Fetch Book Metadata & TOC
    console.log(`[DB] Fetching Book Metadata for ID: ${book_id}`);
    const { data: bookData, error: bookError } = await supabase
      .from('books')
      .select('title, toc, page_offset')
      .eq('id', book_id)
      .single();

    if (bookError) {
      console.error(`[DB ERROR] Failed to fetch book metadata: ${bookError.message}`);
      throw bookError;
    }

    // 4. Build TOC Flattener (Hierarchical Path Mapping)
    console.log(`[SYSTEM] Flattening TOC Hierarchy...`);
    const flatTOC: { page: number, path: string }[] = [];
    const flatten = (nodes: any[], parentPath = '') => {
      if (!nodes) return;
      for (const node of nodes) {
        const currentPath = parentPath ? `${parentPath} / ${node.title}` : node.title;
        if (node.page) flatTOC.push({ page: node.page, path: currentPath });
        flatten(node.children, currentPath);
      }
    };
    flatten(bookData.toc);
    flatTOC.sort((a, b) => a.page - b.page);
    console.log(`[SYSTEM] Built ${flatTOC.length} TOC hierarchical reference points.`);

    const getChapterPath = (page: number) => {
      let activePath = "General Content";
      for (const node of flatTOC) {
        if (node.page <= page) activePath = node.path;
        else break;
      }
      return activePath;
    };

    // 5. Pre-fetch the physical pages needed for these jobs
    const pageNumbersToFetch = [...new Set(jobs.map((j: any) => j.page_number))];
    console.log(`[DB] Fetching ${pageNumbersToFetch.length} physical pages from book_pages table...`);
    
    const { data: pagesData, error: pagesError } = await supabase
      .from('book_pages')
      .select('page_number, content_json')
      .eq('book_id', book_id)
      .in('page_number', pageNumbersToFetch);

    if (pagesError) {
      console.error(`[DB ERROR] Failed to fetch pages data: ${pagesError.message}`);
      throw pagesError;
    }

    const pagesMap = new Map();
    pagesData.forEach(p => pagesMap.set(p.page_number, p.content_json));

    // --- TEXT EXTRACTION & CHUNKING HELPERS ---
    const extractText = (block: any): string => {
        let text = [];
        if (block.main) text.push(block.main);
        if (block.sub) text.push(block.sub);
        if (block.title) text.push(block.title);
        if (block.body) text.push(block.body);
        if (block.text) text.push(block.text);
        if (block.items && Array.isArray(block.items)) text.push(block.items.join(' '));
        if (block.premises) text.push(block.premises.join(' '));
        if (block.conclusion) text.push(block.conclusion);
        if (block.question) text.push(block.question);
        return text.join(' ').replace(/<[^>]+>/g, '').trim(); 
    };

    const chunkText = (text: string): string[] => {
      if (text.length <= CHUNK_MAX_SIZE) return [text];
      const chunks = [];
      let i = 0;
      while (i < text.length) {
        chunks.push(text.slice(i, i + CHUNK_MAX_SIZE));
        i += (CHUNK_MAX_SIZE - CHUNK_OVERLAP);
      }
      return chunks;
    };

    // 6. PROCESS JOBS SEQUENTIALLY
    console.log(`\n--- BEGINNING INGESTION LOOP (${jobs.length} Jobs) ---`);
    let successCount = 0;
    let failCount = 0;

    for (const job of jobs) {
      const jobIdLog = `[JOB: ${job.job_id.split('-')[0]}]`;
      console.log(`${jobIdLog} Processing Page ${job.page_number} | Block ${job.block_index}`);

      try {
        const pageContent = pagesMap.get(job.page_number);
        if (!pageContent || !pageContent[job.block_index]) {
          console.warn(`${jobIdLog} Block data missing or index out of bounds. Marking complete (skipped).`);
          await supabase.rpc('complete_embedding_job', { p_job_id: job.job_id });
          successCount++;
          continue;
        }

        const block = pageContent[job.block_index];
        const rawText = extractText(block);

        if (!rawText || rawText.length < 10 || block.type === 'spacer' || block.type === 'logic-footer') {
          console.log(`${jobIdLog} Insufficient text or ignored block type (${block.type}). Marking complete.`);
          await supabase.rpc('complete_embedding_job', { p_job_id: job.job_id });
          successCount++;
          continue;
        }

        const chapterPath = getChapterPath(job.page_number);
        const textChunks = chunkText(rawText);
        console.log(`${jobIdLog} Extracted ${rawText.length} chars. Split into ${textChunks.length} chunks. Chapter: "${chapterPath}"`);

        const pineconeVectors = [];

        // Generate embeddings for each chunk
        for (let cIdx = 0; cIdx < textChunks.length; cIdx++) {
          const chunkText = textChunks[cIdx];
          
          console.log(`${jobIdLog} [GEMINI] Requesting embedding for Chunk ${cIdx} via Key ID: ${job.api_key_id}...`);
          
          const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:embedContent?key=${job.api_key}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: `models/${GEMINI_MODEL}`,
              content: { parts: [{ text: chunkText }] },
              taskType: "RETRIEVAL_DOCUMENT",
              title: chapterPath,
              outputDimensionality: DIMENSIONS
            })
          });

          if (geminiRes.status === 429) {
            console.error(`${jobIdLog} [GEMINI ERROR 429] Rate limit hit on Key ID ${job.api_key_id}. Cooling down key...`);
            await supabase.rpc('cooldown_api_key', { p_key_id: job.api_key_id });
            throw new Error(`Gemini 429 Rate Limit. Key cooled down.`);
          }

          if (!geminiRes.ok) {
            const errText = await geminiRes.text();
            console.error(`${jobIdLog} [GEMINI ERROR ${geminiRes.status}] ${errText}`);
            throw new Error(`Gemini API Error: ${geminiRes.status}`);
          }

          const geminiData = await geminiRes.json();
          const vector = geminiData.embedding?.values;

          if (!vector) {
            console.error(`${jobIdLog} [GEMINI ERROR] No embedding values returned in response:`, geminiData);
            throw new Error("Empty vector received from Gemini");
          }

          // Format for Pinecone
          const vectorId = `b_${book_id}_p${job.page_number}_blk${job.block_index}_c${cIdx}`;
          pineconeVectors.push({
            id: vectorId,
            values: vector,
            metadata: {
              book_id: book_id,
              book_title: bookData.title,
              chapter_title: chapterPath,
              page_number: job.page_number,
              block_type: block.type || 'unknown',
              chunk_index: cIdx,
              text_snippet: chunkText
            }
          });
        }

        // Upsert to Pinecone
        console.log(`${jobIdLog} [PINECONE] Upserting ${pineconeVectors.length} vectors to namespace: ${book_id}...`);
        
        // Ensure Host format is perfectly clean
        const cleanHost = PINECONE_HOST.replace(/\/$/, '').replace(/^https?:\/\//, '');
        const pineconeRes = await fetch(`https://${cleanHost}/vectors/upsert`, {
          method: 'POST',
          headers: {
            'Api-Key': PINECONE_API_KEY,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            vectors: pineconeVectors,
            namespace: book_id
          })
        });

        if (!pineconeRes.ok) {
          const pErr = await pineconeRes.text();
          console.error(`${jobIdLog} [PINECONE ERROR ${pineconeRes.status}] ${pErr}`);
          throw new Error(`Pinecone Upsert Failed: ${pErr}`);
        }

        console.log(`${jobIdLog} [SUCCESS] Pinecone upsert verified.`);
        
        // Mark Job Complete
        await supabase.rpc('complete_embedding_job', { p_job_id: job.job_id });
        successCount++;

        // Add a micro-delay (100ms) to respect free-tier network steady-state
        await new Promise(res => setTimeout(res, 100));

      } catch (jobErr) {
        console.error(`${jobIdLog} [FAILED] Aborting job. Reason: ${jobErr.message}`);
        await supabase.rpc('fail_embedding_job', { p_job_id: job.job_id, p_error: jobErr.message });
        failCount++;
      }
    }

    console.log("\n=======================================================");
    console.log(`[COMPLETE] Pipeline finished. Success: ${successCount} | Failed: ${failCount}`);
    console.log("=======================================================\n");

    return new Response(JSON.stringify({ 
      status: "Pipeline finished", 
      processed: jobs.length,
      success: successCount,
      failed: failCount
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (globalError) {
    console.error(`\n[FATAL PIPELINE CRASH] ${globalError.message}\n`);
    return new Response(JSON.stringify({ error: globalError.message }), { status: 500, headers: corsHeaders });
  }
});