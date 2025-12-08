// --- START OF FILE IDE-main/aggregate.ts ---

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Pinecone, Index } from 'https://esm.sh/@pinecone-database/pinecone@2';

// --- CONFIGURATION ---
const TARGET_NAMESPACE = 'all-universities'; 
const BATCH_SIZE = 100; 
const QUERY_TOP_K = 10000; // Max allowed by Pinecone

// --- SETUP CLIENTS ---
console.log("Initializing clients...");

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const PINECONE_API_KEY = Deno.env.get('PINECONE_API_KEY');
const PINECONE_INDEX_NAME = Deno.env.get('PINECONE_INDEX_NAME');

console.log(`[Env Check] PINECONE_INDEX_NAME: ${PINECONE_INDEX_NAME}`); 

if (!PINECONE_INDEX_NAME) {
    console.error("ERROR: PINECONE_INDEX_NAME is not set.");
    Deno.exit(1);
}

const supabaseAdmin = createClient(
  SUPABASE_URL!,
  SUPABASE_SERVICE_ROLE_KEY!
);

const pc = new Pinecone({
  apiKey: PINECONE_API_KEY!
});

const pineconeIndex: Index = pc.Index(PINECONE_INDEX_NAME!);
console.log("Clients initialized.");

async function main() {
  console.log("Starting vector aggregation process...");

  // 1. Get all university IDs
  const { data: universities, error: uniError } = await supabaseAdmin.from('universities').select('id');
  if (uniError) throw new Error(`Failed to fetch universities: ${uniError.message}`);
  const sourceNamespaces = universities.map(u => u.id);
  console.log(`Found ${sourceNamespaces.length} source namespaces.`);

  // 2. Clear target namespace
  try {
    console.log(`[Pinecone] Deleting from namespace: ${TARGET_NAMESPACE}`);
    await pineconeIndex.namespace(TARGET_NAMESPACE).deleteAll();
    console.log("Target namespace cleared.");
  } catch (e: any) {
    console.warn(`Target namespace cleanup note: ${e.message}`);
  }

  // 3. Loop through source namespaces
  for (const ns of sourceNamespaces) {
    console.log(`\n--- Processing source namespace: ${ns} ---`);
    let vectorsToUpsert: any[] = [];
    
    try {
        console.log(`[Pinecone] Querying namespace: "${ns}" (Retrieving Data Directly)`);
        
        // OPTIMIZATION: We fetch values and metadata HERE, so we don't need a second 'fetch' call
        const queryRes = await pineconeIndex.namespace(ns).query({
            vector: Array(768).fill(0), // Dummy vector
            topK: QUERY_TOP_K, 
            includeMetadata: true, // Get metadata now
            includeValues: true,   // Get vector values now
        });
        
        if (!queryRes.matches || queryRes.matches.length === 0) {
            console.log(`  No matches found for namespace ${ns}.`);
            continue;
        }

        // Map the query results directly to the format expected by Upsert
        vectorsToUpsert = queryRes.matches.map(match => ({
            id: match.id,
            values: match.values,
            metadata: match.metadata
        }));

        console.log(`  Retrieved ${vectorsToUpsert.length} vectors directly from query.`);

    } catch (queryError: any) { 
        if (queryError.message && queryError.message.includes('HTTP status 404')) {
            console.warn(`  Namespace "${ns}" not found. Skipping.`);
            continue; 
        } else {
            console.error(`  Error querying namespace "${ns}": ${queryError.message}`);
            continue;
        }
    }

    if (vectorsToUpsert.length === 0) {
        continue;
    }

    // 4. Upsert the collected vectors
    console.log(`  Starting upsert of ${vectorsToUpsert.length} vectors to target namespace...`);
    for (let i = 0; i < vectorsToUpsert.length; i += BATCH_SIZE) {
        const batch = vectorsToUpsert.slice(i, i + BATCH_SIZE);
        try {
            // console.log(`[Pinecone] Upserting batch ${Math.floor(i/BATCH_SIZE) + 1}...`);
            await pineconeIndex.namespace(TARGET_NAMESPACE).upsert(batch);
        } catch (upsertError: any) {
            console.error(`  Error upserting batch starting at ${i}: ${upsertError.message}`);
        }
    }
    console.log(`  Upsert complete for ${ns}.`);
  }

  console.log("\nAggregation process completed successfully!");
}

main().catch(err => {
  console.error("\n--- FATAL ERROR ---");
  console.error(err);
  Deno.exit(1);
});
