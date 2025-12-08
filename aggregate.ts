// --- START OF FILE source/aggregate.ts ---

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Pinecone } from 'https://esm.sh/@pinecone-database/pinecone@2';

// --- CONFIGURATION ---
const TARGET_NAMESPACE = 'all-universities'; // The new, combined namespace
const BATCH_SIZE = 100; // How many vectors to fetch/upsert at a time

// --- SETUP CLIENTS ---
console.log("Initializing clients...");
const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const pc = new Pinecone({
  apiKey: Deno.env.get('PINECONE_API_KEY')!
});

// NOTE: You need the full index host URL for this script, not just the index name.
// Get this from your Pinecone dashboard. It's different from the Deno Deploy env var.
const pineconeIndex = pc.Index(Deno.env.get('PINECONE_INDEX_HOST')!);
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
    console.error(`Could not delete vectors (this is okay if namespace is new): ${e.message}`);
  }

  // 3. Loop through each source namespace and transfer its vectors
  for (const ns of sourceNamespaces) {
    console.log(`\n--- Processing source namespace: ${ns} ---`);
    let allVectors = [];
    let paginationToken: string | undefined = undefined;

    // Pinecone's list() endpoint paginates, so we loop until we have all IDs
    do {
      const listRes: any = await pineconeIndex.namespace(ns).list({ nextToken: paginationToken });
      if (listRes.vectors && listRes.vectors.length > 0) {
        const ids = listRes.vectors.map((v: any) => v.id);
        
        // Fetch the full vector data for the retrieved IDs
        const fetchRes = await pineconeIndex.namespace(ns).fetch(ids);
        const vectors = Object.values(fetchRes.vectors);
        allVectors.push(...vectors);
        console.log(`  Fetched ${vectors.length} vectors... (Total so far: ${allVectors.length})`);
      }
      paginationToken = listRes.pagination?.nextToken;
    } while (paginationToken);

    if (allVectors.length === 0) {
      console.log(`  No vectors found in namespace ${ns}. Skipping.`);
      continue;
    }

    // 4. Upsert the collected vectors into the target namespace in batches
    console.log(`  Starting upsert of ${allVectors.length} vectors to "${TARGET_NAMESPACE}"...`);
    for (let i = 0; i < allVectors.length; i += BATCH_SIZE) {
        const batch = allVectors.slice(i, i + BATCH_SIZE);
        await pineconeIndex.namespace(TARGET_NAMESPACE).upsert(batch);
        console.log(`    Upserted batch ${Math.floor(i/BATCH_SIZE) + 1}...`);
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
