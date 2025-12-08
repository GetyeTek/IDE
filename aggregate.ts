// --- START OF FILE source/aggregate.ts ---

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Pinecone, Index } from 'https://esm.sh/@pinecone-database/pinecone@2';

// --- CONFIGURATION ---
const TARGET_NAMESPACE = 'all-universities'; // The new, combined namespace
const BATCH_SIZE = 100; // How many vectors to fetch/upsert at a time
const QUERY_TOP_K = 10000; // Pinecone's max topK is 10,000 for query()

// --- SETUP CLIENTS ---
console.log("Initializing clients...");
const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const pc = new Pinecone({
  apiKey: Deno.env.get('PINECONE_API_KEY')!
});

const pineconeIndex: Index = pc.Index(Deno.env.get('PINECONE_INDEX_HOST')!);
console.log("Clients initialized.");

async function main() {
  console.log("Starting vector aggregation process...");

  // 1. Get all university IDs (which are our source namespaces)
  const { data: universities, error: uniError } = await supabaseAdmin.from('universities').select('id');
  if (uniError) throw new Error(`Failed to fetch universities: ${uniError.message}`);
  const sourceNamespaces = universities.map(u => u.id);
  console.log(`Found ${sourceNamespaces.length} source namespaces to process.`);

  // 2. Clear out the old data in the target namespace to avoid duplicates
  try {
    console.log(`Deleting all vectors in target namespace: "${TARGET_NAMESPACE}"...`);
    await pineconeIndex.namespace(TARGET_NAMESPACE).deleteAll();
    console.log("Target namespace cleared successfully.");
  } catch (e) {
    console.warn(`Could not delete vectors from target namespace (this is okay if namespace is new): ${e.message}`);
  }

  // 3. Loop through each source namespace and transfer its vectors
  for (const ns of sourceNamespaces) {
    console.log(`\n--- Processing source namespace: ${ns} ---`);
    let allSourceVectorIds: string[] = [];
    
    // *** UPDATED: Use 'university_id' for the match-all filter ***
    const MATCH_ALL_FILTER = { "university_id": { "$ne": "non_existent_uuid_for_match_all" } };
                                                                            
    try {
        let fetchedCount = 0;
        
        do {
            const queryRes = await pineconeIndex.namespace(ns).query({
                vector: Array(768).fill(0), // Dummy vector
                topK: QUERY_TOP_K, // Fetch up to QUERY_TOP_K IDs
                filter: MATCH_ALL_FILTER,
                includeMetadata: false,
                includeValues: false,
            });
            
            if (!queryRes.matches || queryRes.matches.length === 0) {
                break;
            }

            const currentBatchIds = queryRes.matches.map(match => match.id);
            allSourceVectorIds.push(...currentBatchIds);
            fetchedCount += currentBatchIds.length;

            console.log(`  Queried ${fetchedCount} IDs from namespace ${ns}...`);

            // If the number of matches is less than QUERY_TOP_K, we've likely found all.
            // Note: This relies on TopK being large enough to cover all vectors in a namespace.
            // For namespaces with >10,000 vectors, true pagination would be more complex.
            if (currentBatchIds.length < QUERY_TOP_K) {
                break;
            }
        } while (true); 

    } catch (queryError) {
        console.error(`  Error querying IDs from namespace ${ns}: ${queryError.message}`);
        continue;
    }

    if (allSourceVectorIds.length === 0) {
      console.log(`  No vectors found in namespace ${ns}. Skipping.`);
      continue;
    }

    console.log(`  Collected ${allSourceVectorIds.length} unique vector IDs from namespace ${ns}.`);

    // 4. Fetch the full vector data for the collected IDs in batches
    let vectorsToUpsert = [];
    console.log(`  Fetching full vector data for ${allSourceVectorIds.length} IDs...`);
    for (let i = 0; i < allSourceVectorIds.length; i += BATCH_SIZE) {
        const batchIds = allSourceVectorIds.slice(i, i + BATCH_SIZE);
        const fetchRes = await pineconeIndex.namespace(ns).fetch(batchIds);
        
        const fetchedVectors = Object.values(fetchRes.vectors || {});
        vectorsToUpsert.push(...fetchedVectors);
        console.log(`    Fetched batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(allSourceVectorIds.length / BATCH_SIZE)}.`);
    }

    if (vectorsToUpsert.length === 0) {
        console.log(`  No vectors fetched for namespace ${ns}. Skipping upsert.`);
        continue;
    }

    // 5. Upsert the collected vectors into the target namespace in batches
    console.log(`  Starting upsert of ${vectorsToUpsert.length} vectors to "${TARGET_NAMESPACE}"...`);
    for (let i = 0; i < vectorsToUpsert.length; i += BATCH_SIZE) {
        const batch = vectorsToUpsert.slice(i, i + BATCH_SIZE);
        await pineconeIndex.namespace(TARGET_NAMESPACE).upsert(batch);
        console.log(`    Upserted batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(vectorsToUpsert.length / BATCH_SIZE)} into ${TARGET_NAMESPACE}.`);
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
