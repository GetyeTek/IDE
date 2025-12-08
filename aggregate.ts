// --- START OF FILE IDE-main/aggregate.ts ---

// --- START OF FILE source/aggregate.ts ---

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Pinecone, Index } from 'https://esm.sh/@pinecone-database/pinecone@2';

// --- CONFIGURATION ---
const TARGET_NAMESPACE = 'all-universities'; // The new, combined namespace
const BATCH_SIZE = 100; // How many vectors to fetch/upsert at a time
const QUERY_TOP_K = 10000; // Pinecone's max topK is 10,000 for query()

// --- SETUP CLIENTS ---
console.log("Initializing clients...");

// Log environment variables before use
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const PINECONE_API_KEY = Deno.env.get('PINECONE_API_KEY');
const PINECONE_INDEX_HOST = Deno.env.get('PINECONE_INDEX_HOST');

console.log(`[Env Check] SUPABASE_URL present: ${!!SUPABASE_URL}`);
console.log(`[Env Check] SUPABASE_SERVICE_ROLE_KEY present: ${!!SUPABASE_SERVICE_ROLE_KEY}`);
// IMPORTANT: DO NOT log the full API key or service role key! Just check if present.
console.log(`[Env Check] PINECONE_API_KEY present: ${!!PINECONE_API_KEY}`);
console.log(`[Env Check] PINECONE_INDEX_HOST: ${PINECONE_INDEX_HOST}`); // Log the host URL to verify it's correct

const supabaseAdmin = createClient(
  SUPABASE_URL!,
  SUPABASE_SERVICE_ROLE_KEY!
);

const pc = new Pinecone({
  apiKey: PINECONE_API_KEY!
});

// NOTE: Use the full index host URL for the Pinecone client here
const pineconeIndex: Index = pc.Index(PINECONE_INDEX_HOST!);
console.log("Clients initialized.");

async function main() {
  console.log("Starting vector aggregation process...");

  // 1. Get all university IDs (which are our source namespaces)
  const { data: universities, error: uniError } = await supabaseAdmin.from('universities').select('id');
  if (uniError) throw new Error(`Failed to fetch universities from Supabase: ${uniError.message}`);
  const sourceNamespaces = universities.map(u => u.id);
  console.log(`Found ${sourceNamespaces.length} source namespaces to potentially process.`);

  // 2. Clear out the old data in the target namespace to avoid duplicates
  try {
    console.log(`Deleting all vectors in target namespace: "${TARGET_NAMESPACE}"...`);
    // Added explicit logging of namespace being deleted
    console.log(`[Pinecone] Deleting from namespace: ${TARGET_NAMESPACE}`);
    await pineconeIndex.namespace(TARGET_NAMESPACE).deleteAll();
    console.log("Target namespace cleared successfully.");
  } catch (e: any) {
    console.warn(`Could not delete vectors from target namespace (this is okay if namespace is new or 404): ${e.message}`);
  }

  // 3. Loop through each source namespace and transfer its vectors
  for (const ns of sourceNamespaces) {
    console.log(`\n--- Processing source namespace: ${ns} ---`);
    let allSourceVectorIds: string[] = [];
    
    // REMOVED THE MATCH_ALL_FILTER - we will query without a filter to get all IDs
                                                                            
    try {
        let fetchedCount = 0;
        
        do {
            // Updated log message to reflect no filter
            console.log(`[Pinecone] Querying namespace: "${ns}" with topK: ${QUERY_TOP_K}`);
            const queryRes = await pineconeIndex.namespace(ns).query({
                vector: Array(768).fill(0), // Dummy vector
                topK: QUERY_TOP_K, // Fetch up to QUERY_TOP_K IDs
                // REMOVED THE FILTER PROPERTY
                includeMetadata: false,
                includeValues: false,
            });
            
            if (!queryRes.matches || queryRes.matches.length === 0) {
                console.log(`  No matches found for namespace ${ns}.`);
                break;
            }

            const currentBatchIds = queryRes.matches.map(match => match.id);
            allSourceVectorIds.push(...currentBatchIds);
            fetchedCount += currentBatchIds.length;

            console.log(`  Queried ${fetchedCount} IDs from namespace ${ns}... (last batch size: ${currentBatchIds.length})`);

            if (currentBatchIds.length < QUERY_TOP_K) {
                break;
            }
        } while (true); 

    } catch (queryError: any) { 
        if (queryError.message && queryError.message.includes('HTTP status 404')) {
            console.warn(`  Namespace "${ns}" not found in Pinecone Index "${PINECONE_INDEX_HOST}". Skipping this namespace.`);
            continue; 
        } else {
            console.error(`  Unhandled error querying IDs from namespace "${ns}": ${queryError.message}`);
            continue;
        }
    }

    if (allSourceVectorIds.length === 0) {
      console.log(`  No vectors found in namespace "${ns}". Skipping fetch and upsert.`);
      continue;
    }

    console.log(`  Collected ${allSourceVectorIds.length} unique vector IDs from namespace "${ns}".`);

    // 4. Fetch the full vector data for the collected IDs in batches
    let vectorsToUpsert = [];
    console.log(`  Fetching full vector data for ${allSourceVectorIds.length} IDs from namespace "${ns}"...`);
    for (let i = 0; i < allSourceVectorIds.length; i += BATCH_SIZE) {
        const batchIds = allSourceVectorIds.slice(i, i + BATCH_SIZE);
        try {
            console.log(`[Pinecone] Fetching batch from namespace: "${ns}", IDs: ${batchIds.length}`);
            const fetchRes = await pineconeIndex.namespace(ns).fetch(batchIds);
            
            const fetchedVectors = Object.values(fetchRes.vectors || {});
            vectorsToUpsert.push(...fetchedVectors);
            console.log(`    Fetched batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(allSourceVectorIds.length / BATCH_SIZE)}. (Fetched ${fetchedVectors.length} vectors)`);
        } catch (fetchError: any) {
            console.error(`  Error fetching vectors for namespace "${ns}", batch starting at index ${i}: ${fetchError.message}. Skipping this batch.`);
        }
    }

    if (vectorsToUpsert.length === 0) {
        console.log(`  No vectors successfully fetched for namespace "${ns}". Skipping upsert.`);
        continue;
    }

    // 5. Upsert the collected vectors into the target namespace in batches
    console.log(`  Starting upsert of ${vectorsToUpsert.length} vectors to target namespace "${TARGET_NAMESPACE}"...`);
    for (let i = 0; i < vectorsToUpsert.length; i += BATCH_SIZE) {
        const batch = vectorsToUpsert.slice(i, i + BATCH_SIZE);
        try {
            console.log(`[Pinecone] Upserting batch into target namespace: "${TARGET_NAMESPACE}", vectors: ${batch.length}`);
            await pineconeIndex.namespace(TARGET_NAMESPACE).upsert(batch);
            console.log(`    Upserted batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(vectorsToUpsert.length / BATCH_SIZE)} into ${TARGET_NAMESPACE}.`);
        } catch (upsertError: any) {
            console.error(`  Error upserting vectors into target namespace "${TARGET_NAMESPACE}", batch starting at index ${i}: ${upsertError.message}. Skipping this batch.`);
        }
    }
    console.log(`--- Finished processing ${ns} ---`);
  }

  console.log("\nAggregation process completed successfully!");
}

main().catch(err => {
  console.error("\n--- FATAL ERROR ---");
  console.error(err);
  Deno.exit(1);
});
