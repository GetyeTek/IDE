// --- START OF FILE source/aggregate.ts ---

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Pinecone, Index } from 'https://esm.sh/@pinecone-database/pinecone@2'; // Import Index type

// --- CONFIGURATION ---
const TARGET_NAMESPACE = 'all-universities'; // The new, combined namespace
const BATCH_SIZE = 100; // How many vectors to fetch/upsert at a time
const QUERY_TOP_K = 10000; // Adjusted to Pinecone's max `topK` for comprehensive ID retrieval

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

    // Iterate by querying to get all IDs (as a substitute for 'list()' method)
    // Using a "match all" filter based on your confirmed 'exam_id' metadata field.
    const MATCH_ALL_FILTER = { "exam_id": { "$ne": "non_existent_id_xyz" } }; // This is guaranteed to match all vectors with an exam_id

    try {
        let currentBatchIds: string[] = [];
        let fetchedCount = 0;

        // Note: Pinecone's query is primarily for semantic search, and while we can
        // use it for ID retrieval with a broad filter, it has limitations for *guaranteed*
        // full scans of IDs if a namespace has more than Pinecone's max `topK` (10,000).
        // For most practical purposes, QUERY_TOP_K=10000 will be sufficient per namespace.
        // A more complex solution for truly massive namespaces would involve filtering by
        // a range of metadata values (e.g., timestamp) to paginate.
        const queryRes = await pineconeIndex.namespace(ns).query({
            vector: Array(768).fill(0), // Dummy vector
            topK: QUERY_TOP_K, // Fetch up to QUERY_TOP_K IDs
            filter: MATCH_ALL_FILTER,
            includeMetadata: false,
            includeValues: false,
        });
            
        if (queryRes.matches && queryRes.matches.length > 0) {
            currentBatchIds = queryRes.matches.map(match => match.id);
            allSourceVectorIds.push(...currentBatchIds);
            fetchedCount += currentBatchIds.length;
            console.log(`  Queried ${fetchedCount} IDs from namespace ${ns}.`);
        } else {
            console.log(`  No IDs found for filter in namespace ${ns}.`);
        }
    } catch (queryError) {
        console.error(`  Error querying IDs from namespace ${ns}: ${queryError.message}`);
        continue; // Skip to next namespace if there's an issue with ID retrieval
    }

    if (allSourceVectorIds.length === 0) {
      console.log(`  No vectors found in namespace ${ns}. Skipping.`);
      continue;
    }

    console.log(`  Collected ${allSourceVectorIds.length} vector IDs from namespace ${ns}.`);

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
});```

#### 2. Re-Deploy GitHub Action

1.  **Commit and Push** the updated `aggregate.ts` to your `GetyeTek/IDE` repository.
2.  **Trigger the GitHub Action** manually from your phone's GitHub Actions tab again.
3.  **Monitor the logs carefully.** This *should* now complete successfully and populate your `all-universities` namespace.

#### 3. Update Your Chat Edge Function (`source/chat.ts` - assuming this is a separate file)

Now that `aggregate.ts` is fixed and running, your **chat function** needs to be updated to query the new `all-universities` namespace.

**If your chat function is *also* `source/index.ts`**, then you should re-use the complete `source/index.ts` file I provided in our discussion "The Complete Supabase Edge Function" from December 7th, at 10:14 PM. That file already contains the `triggerAggregationWorkflow` and the correct logic to query `AGGREGATED_NAMESPACE` (which is `all-universities`).

**If your chat function is a *new, separate file* (e.g., `source/chat.ts`), here is the content for it:**

```typescript
// --- START OF FILE source/chat.ts (Example structure) ---
// This is your user-facing chat API function

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Pinecone, type QueryResponse } from 'https://esm.sh/@pinecone-database/pinecone@2'; // Added QueryResponse type
// Make sure these match the environment variables on your Supabase Edge Function for chat
const AGGREGATED_NAMESPACE = 'all-universities';
const CONTEXT_MATCH_COUNT = 5; // How many documents to fetch from Pinecone for context

// --- TYPE DEFINITIONS (from your original code, ensure consistent) ---
interface ApiKey {
  id: number;
  api_key: string;
}

interface Question {
  id: string;
  text: string;
  question_number: string;
  question_type: string;
  points: number | null;
  options: any;
  matching_data: any;
  section: {
    id: string;
    title: string;
    instructions: string | null;
    shared_context: any;
    exam: {
      id: string;
      course_name: string;
      course_code: string | null;
      exam_type: string;
      school: string | null;
      department: string | null;
      date: string | null;
      university_id: string;
      university: { id: string; name: string };
    };
  };
}

// Represents one message in the chat history
interface ChatMessage {
    role: 'user' | 'model';
    parts: [{ text: string }];
}

// The expected request body for the /exam-chat-api endpoint
interface ChatPayload {
    message: string;
    history?: ChatMessage[];
    universityId?: string;
    courseName?: string;
}

// --- API KEY MANAGER (from your original code, ensure consistent) ---
class ApiKeyManager {
  private keys: ApiKey[] = [];
  private currentIndex = 0;
  private supabaseAdmin: SupabaseClient;

  constructor(supabaseAdmin: SupabaseClient) {
    this.supabaseAdmin = supabaseAdmin;
  }

  async initialize(): Promise<void> {
    const { data, error } = await this.supabaseAdmin
      .from('api_keys')
      .select('id, api_key')
      .eq('service', 'gemini')
      .eq('is_active', true)
      .or(`cooldown_until.is.null,cooldown_until.lt.${new Date().toISOString()}`)
      .order('last_used_at', { ascending: true, nullsFirst: true });

    if (error) {
      console.error("[KeyManager] ERROR fetching API keys:", error);
      throw new Error(`[KeyManager] Failed to fetch API keys: ${error.message}`);
    }

    if (!data || data.length === 0) {
      console.error("[KeyManager] No available Gemini API keys found.");
      throw new Error("[KeyManager] No available Gemini API keys found!");
    }

    this.keys = data;
    console.log(`[KeyManager] Loaded ${this.keys.length} valid keys.`);
  }

  getNextKey(): ApiKey {
    if (this.keys.length === 0) {
      console.error("[KeyManager] Tried to rotate keys but none exist.");
      throw new Error("[KeyManager] No keys available for processing.");
    }

    const key = this.keys[this.currentIndex % this.keys.length];
    console.log(`[KeyManager] Using key ID ${key.id}`);
    this.currentIndex++;

    return key;
  }

  async putKeyOnCooldown(keyId: number): Promise<void> {
    console.warn(`[KeyManager] Putting key ${keyId} on cooldown for 24 hours.`);

    const tomorrow = new Date();
    tomorrow.setHours(tomorrow.getHours() + 24);

    const { error } = await this.supabaseAdmin
      .from('api_keys')
      .update({ cooldown_until: tomorrow.toISOString() })
      .eq('id', keyId);

    if (error) console.error("[KeyManager] ERROR updating cooldown:", error);
  }

  async markKeyAsUsed(keyId: number): Promise<void> {
    const { error } = await this.supabaseAdmin
      .from('api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', keyId);

    if (error) console.error("[KeyManager] ERROR updating last_used_at:", error);
  }
}

// --- GLOBAL CLIENTS (from your original code, ensure consistent) ---
const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const supabaseAnon = createClient( // You might need supabaseAnon for fetching general university/course lists
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_ANON_KEY')!
);


const pc = new Pinecone({
  apiKey: Deno.env.get('PINECONE_API_KEY')!
});

const pineconeIndex = pc.Index(Deno.env.get('PINECONE_INDEX_NAME')!); // Use index name for chat queries


// --- HELPER FUNCTIONS (from your original code, ensure consistent) ---

// This function is for QUERYING. It transforms the user's raw message
// into a format that semantically matches the indexed documents.
function constructQueryText(message: string): string {
  const prefix = "Exam question asking about: ";
  return `${prefix}${message}`;
}

function logLlmContexts(contexts: string[]): void {
  console.log(`\n🔎 [LLM CONTEXT LOG] Delivering ${contexts.length} context blocks to Gemini:`);
  console.log("==========================================================");
  
  if (contexts.length === 0) {
    console.log("   (No contexts found - Model will use general knowledge)");
  } else {
    contexts.forEach((ctx, index) => {
      console.log(`\n--- 📄 Context Block #${index + 1} ---\n${ctx}\n-------------------------------------`);
    });
  }
  
  console.log("==========================================================\n");
}

async function generateSingleEmbedding(text: string, key: ApiKey): Promise<number[]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${key.api_key}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: "models/gemini-embedding-001",
        content: { parts: [{ text }] },
        outputDimensionality: 768
      })
    });

    if (!response.ok) {
      const body = await response.text();
      console.error(`[EmbeddingAPI] ERROR from key ${key.id} | Status ${response.status} | Body: ${body}`);
      throw new Error(`API_ERROR::${response.status}`);
    }

    const data = await response.json();
    return data.embedding.values;

  } catch (err) {
    console.error(`[EmbeddingAPI] FETCH FAILURE using key ${key.id}:`, err);
    throw err;
  }
}

async function generateChatResponse(
    prompt: string,
    history: ChatMessage[],
    key: ApiKey
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key.api_key}`;
  
  const contents = [
      ...history,
      { role: 'user', parts: [{ text: prompt }] }
  ];

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents }),
    });

    if (!response.ok) {
      const body = await response.text();
      console.error(`[ChatAPI] ERROR from key ${key.id} | Status ${response.status} | Body: ${body}`);
      throw new Error(`API_ERROR::${response.status}`);
    }
    const data = await response.json();
    if (!data.candidates || data.candidates.length === 0) {
      console.error("[ChatAPI] Received no candidates in response:", data);
      throw new Error("No response content from model");
    }

    return data.candidates[0].content.parts[0].text;

  } catch (err) {
    console.error(`[ChatAPI] FETCH FAILURE using key ${key.id}:`, err);
    throw err;
  }
}


// --- MAIN HANDLER for the Chat API ---
Deno.serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
  const url = new URL(req.url);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // --- ROUTE: /exam-chat-api (for frontend chat functionality) ---
  if (url.pathname === '/exam-chat-api') { // Ensure this matches your Edge Function name in Supabase
    try {
        const { message, history = [], universityId, courseName }: ChatPayload = await req.json();

        if (!message) {
            return new Response(JSON.stringify({ error: "Message is required" }), {
                status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }
        
        const keyManager = new ApiKeyManager(supabaseAdmin); // Use supabaseAdmin here as well
        await keyManager.initialize();

        const embeddingKey = keyManager.getNextKey();
        const queryText = constructQueryText(message);
        
        console.log(`[ChatAPI] Original message: "${message}"`);
        console.log(`[ChatAPI] Transformed text for embedding: "${queryText}"`);

        const queryVector = await generateSingleEmbedding(queryText, embeddingKey);
        await keyManager.markKeyAsUsed(embeddingKey.id);

        const filter: Record<string, any> = {};
        if (courseName) {
            filter.course_name = { "$eq": courseName };
        }

        let queryResult: QueryResponse;
        
        // Determine which namespace to query
        let namespaceToQuery: string;
        if (universityId === 'all') {
            namespaceToQuery = AGGREGATED_NAMESPACE; // Use the pre-aggregated namespace
        } else if (universityId) {
            namespaceToQuery = universityId; // Query the specific university namespace
        } else {
            console.warn('[ChatAPI] No universityId provided. Defaulting to "all-universities".');
            namespaceToQuery = AGGREGATED_NAMESPACE;
        }

        console.log(`[Pinecone] Querying single namespace: "${namespaceToQuery}" with filter:`, filter);
        queryResult = await pineconeIndex.namespace(namespaceToQuery).query({
            vector: queryVector,
            topK: CONTEXT_MATCH_COUNT, // This constant needs to be defined in this file
            filter: Object.keys(filter).length > 0 ? filter : undefined,
            includeMetadata: true,
            includeValues: false,
        });

        console.log(`[Pinecone] Found ${queryResult.matches.length} potential matches.`);
        if (queryResult.matches.length > 0) {
            console.log('[Pinecone] Top match (score: ' + queryResult.matches[0].score + '):', queryResult.matches[0].metadata);
        }

        const contextIds = queryResult.matches.map(match => match.id);

        let formattedContexts: string[] = [];
        let contextText = "No relevant documents found.";
        if (contextIds.length > 0) {
            const { data: questions, error } = await supabaseAdmin // Use supabaseAdmin to bypass RLS
                .from('questions')
                .select('text, section:sections(shared_context)')
                .in('id', contextIds);

            if (error) throw new Error(`Failed to fetch context from Supabase: ${error.message}`);

            formattedContexts = (questions || []).map(q => {
                let context = 'N/A';
                if (q.section?.shared_context) {
                    if (typeof q.section.shared_context === 'string') {
                        context = q.section.shared_context;
                    } else if (q.section.shared_context.text) {
                        context = q.section.shared_context.text;
                    }
                }
                return `Context Passage: ${context}\nExam Question: ${q.text}`;
            });
            if (formattedContexts.length > 0) {
                contextText = formattedContexts.join('\n---\n');
            }
        }

        logLlmContexts(formattedContexts); // Log the actual contexts delivered

        const finalPrompt = `
You are an intelligent AI assistant for students, acting as an expert on past exam materials.

**Your Task:**
Answer the "User's Question" based on the "Provided Context" below.

**Rules of Engagement:**
1.  **Analyze Context First:** If the "Provided Context" contains a direct and relevant answer to the user's question, synthesize your response primarily from it.
2.  **Use General Knowledge if Needed:** If the context is empty, irrelevant, or incomplete, answer using your general knowledge. When you do this, you MUST preface your answer with a phrase like, "While I couldn't find a specific answer in the provided exam materials, my general understanding is..."
3.  **Be Invisible:** NEVER say "the context says," "the retrieved documents," or "based on the text I was given." Your process should be seamless to the user. You are the expert.

--- PROVIDED CONTEXT ---
${contextText}
--- END CONTEXT ---

User's Question: ${message}
`;

        const chatKey = keyManager.getNextKey();
        const aiResponse = await generateChatResponse(finalPrompt, history, chatKey);
        await keyManager.markKeyAsUsed(chatKey.id);

        return new Response(JSON.stringify({ reply: aiResponse }), {
            status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });

    } catch (error) {
        console.error("--- CHAT HANDLER ERROR ---", error);
        return new Response(
            JSON.stringify({ error: error.message }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
  }


  // --- ROUTE: / (for background embedding job) ---
  if (url.pathname === '/') {
    try {
      const authHeader = req.headers.get('Authorization');
      if (authHeader !== `Bearer ${Deno.env.get('CRON_SECRET')}`) {
          return new Response('Unauthorized', { status: 401 });
      }

      const keyManager = new ApiKeyManager(supabaseAdmin);
      await keyManager.initialize();
  
      const { data: questions, error } = await supabaseAdmin
        .from('questions')
        .select(`
          id, text, question_number, question_type, points, options, matching_data,
          section:sections (
            id, title, instructions, shared_context,
            exam:exams (
              id, course_name, course_code, exam_type, school, department, date, university_id,
              university:universities (id, name)
            )
          )
        `)
        .or(`embedding_status.eq.pending,and(embedding_status.eq.failed,retry_count.lt.3)`)
        .limit(BATCH_SIZE);
  
      if (error) {
        console.error("[FetchQuestions] ERROR:", error);
        throw error;
      }
  
      if (!questions || questions.length === 0) {
        return new Response(
          JSON.stringify({ message: "No pending or retryable questions to process." }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
  
      console.log(`[System] Processing ${questions.length} questions...`);
  
      const updateRes = await supabaseAdmin
        .from('questions')
        .update({ embedding_status: 'processing' })
        .in('id', questions.map(q => q.id));
  
      if (updateRes.error) {
        console.error("[StatusUpdate] ERROR setting processing:", updateRes.error);
      }
  
      const results = [];
  
      for (let i = 0; i < questions.length; i += CONCURRENCY_LIMIT) {
        const chunk = questions.slice(i, i + CONCURRENCY_LIMIT);
  
        const promises = chunk.map(async question => {
          const key = keyManager.getNextKey();
  
          try {
            const text = constructEmbeddingText(question);
            const vector = await generateSingleEmbedding(text, key);
            await keyManager.markKeyAsUsed(key.id);
  
            return { status: 'success', question, vector };
  
          } catch (err) {
            if (String(err.message || "").includes("API_ERROR::429")) {
              console.warn(`[RateLimit] Key ${key.id} triggered 429. Cooling.`);
              await keyManager.putKeyOnCooldown(key.id);
            }
  
            console.error(`[ProcessQuestion] ERROR for question ${question.id}:`, err);
            return { status: 'failed', question, error: String(err) };
          }
        });
  
        const chunkResults = await Promise.all(promises);
        results.push(...chunkResults);
      }
  
      const good = results.filter(r => r.status === 'success');
      const bad = results.filter(r => r.status === 'failed');
  
      if (good.length > 0) {
        const payload = good.map(job => ({
          id: job.question.id,
          values: job.vector,
          metadata: {
            exam_id: job.question.section.exam.id,
            section_id: job.question.section.id,
            university_id: job.question.section.exam.university_id,
            course_name: job.question.section.exam.course_name || 'Unknown Course',
            course_code: job.question.section.exam.course_code || 'N/A',
            exam_type: job.question.section.exam.exam_type,
            question_type: job.question.question_type,
            school: job.question.section.exam.school || 'N/A',
            department: job.question.section.exam.department || 'N/A',
            date: job.question.section.exam.date || 'N/A'
          }
        }));
  
        const grouped = payload.reduce((acc, vec) => {
          const ns = vec.metadata.university_id;
          if (!acc[ns]) acc[ns] = [];
          acc[ns].push(vec);
          return acc;
        }, {} as Record<string, typeof payload>);
  
        for (const ns in grouped) {
          console.log(`[Pinecone] Upserting ${grouped[ns].length} vectors into namespace "${ns}"`);
          await pineconeIndex.namespace(ns).upsert(grouped[ns]);
        }
  
        const doneRes = await supabaseAdmin
          .from('questions')
          .update({ embedding_status: 'completed', retry_count: 0 })
          .in('id', good.map(j => j.question.id));
  
        if (doneRes.error) console.error("[StatusUpdate] ERROR marking completed:", doneRes.error);
      }
  
      if (bad.length > 0) {
        const ids = bad.map(j => j.question.id);
  
        console.warn(`[Retry] Marking ${ids.length} failed questions for retry.`);
  
        const retryRes = await supabaseAdmin.rpc('increment_retry_count', {
          question_ids: ids
        });
  
        if (retryRes.error) console.error("[Retry] ERROR incrementing retry count:", retryRes.error);
      }
  
      return new Response(
        JSON.stringify({
          message: `Processing complete. Success: ${good.length}, Failed: ${bad.length}.`
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
  
    } catch (error) {
      console.error("--- FATAL SERVER ERROR ---", error);
  
      return new Response(
        JSON.stringify({ error: error.message, stack: error.stack }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  return new Response(JSON.stringify({ error: 'Not Found' }), {
    status: 404, headers: { "Content-Type": "application/json" },
  });
});
