import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, accept-encoding",
};

const GEMINI_MODEL = "gemini-3.1-flash-lite-preview";
const GEMINI_EMBEDDING_MODEL = "gemini-embedding-001";
const EMBEDDING_DIMENSIONS = 768;

const MIRON_SYSTEM_PROMPT = `You are Miron Athena, an elite, hyper-intelligent academic AI assistant.
Your goal is to provide precise, deeply analytical, and highly structured answers to university students.
You have access to a specific catalog of university courses.

AVAILABLE COURSE CATALOG:
"FLEN 1011" - "COMMUNICATIVE ENGLISH LANGUAGE SKILLS"
"ECEG 1052" - "COMPUTER PROGRAMMING"
"CEN 2201" - "ENGINEERING MECHANICS"
"MGMT 1012" - "ENTREPRENEURSHIP"
"BIOL 1012" - "GENERAL BIOLOGY"
"CHEM 1012" - "GENERAL CHEMISTRY"
"PHYS 1011" - "GENERAL PHYSICS"
"PSYC 1011" - "GENERAL PSYCHOLOGY"
"SOSC 1011" - "GENERAL SOCIAL SCIENCE"
"GEES 1011" - "GEOGRAPHY"
"GLTR 1012" - "GLOBAL TRENDS"
"HIST 1012" - "HISTORY"
"INCL 1012" - "INCLUSIVENESS"
"ICT 1011" - "INFORMATION & COMMUNICATION TECHNOLOGY (ICT)"
"ECON 1011" - "INTRODUCTION TO ECONOMICS"
"EMTE 1012" - "INTRODUCTION TO EMERGING TECHNOLOGIES"
"LOCT 1011" - "LOGIC AND CRITICAL THINKING"
"MATH 1012" - "MATHEMATICS FOR NATURAL SCIENCES"
"MATH 1011" - "MATHEMATICS FOR SOCIAL SCIENCES"
"MCIE 1012" - "MORAL AND CIVIC EDUCATION"
"SPSC 1011" - "PHYSICAL EDUCATION"
"STAT 2011" - "PROBABILITY AND STATISTICS"
"ANTH 1012" - "SOCIAL ANTHROPOLOGY"

DUAL-ENGINE RETRIEVAL INSTRUCTIONS:
When a user asks an academic question, you MUST execute a dual-retrieval strategy in parallel during your FIRST turn:
1. Call "search_textbook_material" to perform a semantic vector search.
   - IMPORTANT: Distill the user's conversational text into a highly optimized, dense keyword query. (e.g., "What is the formula for kinetic energy?" -> "kinetic energy formula physics velocity mass").
   - If you know the course the user is referring to, provide the course code or name. If not, leave it empty to search across all books.
2. Call "get_book_toc" using the course name/code to understand the structural context of the subject.

After executing BOTH tools simultaneously, evaluate the results:
- If "search_textbook_material" returns highly relevant snippets, synthesize your answer immediately and explicitly cite the book and page number provided in the metadata.
- If the semantic snippets are insufficient, use the TOC you retrieved to identify the exact chapter/section title where the answer likely resides, and call "read_book_section" to read the entire chunk.
- If the user's message is a simple greeting or non-academic, do not call any tools.`;

// Define the Tools (Function Calling)
const toolsDefinition = {
  functionDeclarations: [
    {
      name: "search_textbook_material",
      description: "Perform a semantic vector search across textbook materials. Use this to instantly find specific facts, formulas, or concepts.",
      parameters: {
        type: "OBJECT",
        properties: {
          optimized_query: { type: "STRING", description: "A highly optimized, dense string of keywords representing the core concept." },
          course_code: { type: "STRING", description: "The course code or name (e.g., 'PHYS 1011'). Leave empty to search globally across all books." }
        },
        required: ["optimized_query"]
      }
    },
    {
      name: "get_book_toc",
      description: "Fetch the Table of Contents (TOC) of a specific book to understand its structure.",
      parameters: {
        type: "OBJECT",
        properties: {
          query: { type: "STRING", description: "The exact course NAME or CODE (e.g., 'GENERAL BIOLOGY' or 'BIOL 1012')" }
        },
        required: ["query"]
      }
    },
    {
      name: "read_book_section",
      description: "Read the full text of a specific chapter or section. Use the exact section_title obtained from the TOC.",
      parameters: {
        type: "OBJECT",
        properties: {
          book_id: { type: "STRING", description: "The exact book_id returned from get_book_toc" },
          section_title: { type: "STRING", description: "Exact title of the section from the TOC" }
        },
        required: ["book_id", "section_title"]
      }
    },
    {
      name: "open_page",
      description: "Instruct the user's UI to visually open a specific book and page number.",
      parameters: {
        type: "OBJECT",
        properties: {
          book_id: { type: "STRING" },
          page_number: { type: "INTEGER" }
        },
        required: ["book_id", "page_number"]
      }
    }
  ]
};

// Helper to flatten UI JSON blocks into readable text for the LLM
function extractTextFromBlockArray(blocks: any[]) {
  return blocks.map(b => {
    if (!b) return '';
    let text = [];
    if (b.main) text.push(b.main);
    if (b.sub) text.push(b.sub);
    if (b.title) text.push(b.title);
    if (b.body) text.push(b.body);
    if (b.text) text.push(b.text);
    if (b.items && Array.isArray(b.items)) text.push(b.items.join(' '));
    if (b.premises) text.push(b.premises.join(' '));
    if (b.conclusion) text.push(b.conclusion);
    if (b.question) text.push(b.question);
    return text.join(' ').replace(/<[^>]+>/g, '').trim(); 
  }).filter(Boolean).join('\n');
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { history, prompt, context } = await req.json();

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const PINECONE_API_KEY = Deno.env.get('PINECONE_API_KEY');
    const PINECONE_HOST = Deno.env.get('PINECONE_INDEX_HOST');

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    // 1. API Key Round-Robin Engine
    async function getGeminiKey() {
      const now = new Date();
      const { data: keys, error } = await supabase
        .from('api_keys')
        .select('*')
        .eq('service', 'gemini')
        .eq('is_active', true)
        .order('last_used_at', { ascending: true, nullsFirst: true });

      if (error) throw error;

      const availableKeys = keys.filter(k => !k.cooldown_until || new Date(k.cooldown_until) < now);
      if (availableKeys.length === 0) throw new Error("No active Gemini API keys available. All are in cooldown.");

      const selected = availableKeys[0];
      await supabase.from('api_keys').update({ last_used_at: now.toISOString() }).eq('id', selected.id);
      return selected;
    }

    async function flagKeyCooldown(keyId: number) {
      const cooldownTime = new Date(Date.now() + 5 * 60000).toISOString(); 
      await supabase.from('api_keys').update({ cooldown_until: cooldownTime }).eq('id', keyId);
    }

    // 2. Gemini Communication Wrapper (Generation & Embedding)
    async function callGemini(contents: any[], tools: any[] = [], systemInstruction?: string) {
      let attempts = 0;
      while (attempts < 3) {
        const keyRecord = await getGeminiKey();
        const payload: any = { contents };
        if (tools.length > 0) payload.tools = tools;
        if (systemInstruction) payload.systemInstruction = { parts: [{ text: systemInstruction }] };

        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${keyRecord.api_key}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (res.status === 429) {
          await flagKeyCooldown(keyRecord.id);
          attempts++;
          continue;
        }

        if (!res.ok) throw new Error(`Gemini API Error: ${res.status} ${await res.text()}`);
        return await res.json();
      }
      throw new Error("Failed to contact Gemini after multiple round-robin attempts.");
    }

    async function generateEmbedding(text: string) {
      let attempts = 0;
      while (attempts < 3) {
        const keyRecord = await getGeminiKey();
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBEDDING_MODEL}:embedContent?key=${keyRecord.api_key}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: `models/${GEMINI_EMBEDDING_MODEL}`,
            content: { parts: [{ text }] },
            taskType: "RETRIEVAL_QUERY",
            outputDimensionality: EMBEDDING_DIMENSIONS
          })
        });

        if (res.status === 429) {
          await flagKeyCooldown(keyRecord.id);
          attempts++;
          continue;
        }

        if (!res.ok) throw new Error(`Gemini Embedding Error: ${res.status} ${await res.text()}`);
        const data = await res.json();
        return data.embedding?.values;
      }
      throw new Error("Failed to generate embedding.");
    }

    // 3. Prepare Conversation State
    let messages = [];
    if (context) {
      messages.push({ role: "user", parts: [{ text: `Current Context visible to user:\n"${context}"\n\nAnalyze this context if the user refers to it.` }]});
      messages.push({ role: "model", parts: [{ text: "Acknowledged. I have the context mapped." }]});
    }

    history.forEach((msg: any) => {
      messages.push({
        role: msg.side === 'user' ? 'user' : 'model',
        parts: [{ text: msg.text }]
      });
    });
    
    messages.push({ role: "user", parts: [{ text: prompt }] });

    const executedTools: string[] = [];
    let uiCommand = null;
    let isToolCall = true;
    let loopCount = 0;
    let finalText = "";

    // 4. The Agentic Loop with Parallel Execution
    while (isToolCall && loopCount < 5) {
      const geminiResponse = await callGemini(messages, [toolsDefinition], MIRON_SYSTEM_PROMPT);
      const candidate = geminiResponse.candidates?.[0];

      const functionCallParts = candidate?.content?.parts?.filter((p: any) => p.functionCall) || [];

      if (functionCallParts.length > 0) {
        console.log(`[MIRON LOOP ${loopCount}] Executing ${functionCallParts.length} tool(s) in parallel.`);
        
        // Map all function calls to Promises and execute concurrently
        const toolExecutionPromises = functionCallParts.map(async (part: any) => {
          const { name, args } = part.functionCall;
          console.log(`  -> Running Tool: ${name}`, args);
          let toolResult: any = {};

          try {
            if (name === "search_textbook_material") {
              if (!PINECONE_API_KEY || !PINECONE_HOST) throw new Error("Pinecone secrets missing.");
              executedTools.push(`Vector search executed for: "${args.optimized_query}"`);
              
              const queryVector = await generateEmbedding(args.optimized_query);
              const cleanHost = PINECONE_HOST.replace(/\/$/, '').replace(/^https?:\/\//, '');

              let targetNamespaces: string[] = [];
              if (args.course_code) {
                const { data } = await supabase.from('books').select('id').ilike('title', `%${args.course_code}%`).limit(1);
                if (data && data.length > 0) targetNamespaces.push(data[0].id);
              }

              // If no specific course was targeted or found, search ALL active books (Scatter-Gather)
              if (targetNamespaces.length === 0) {
                const { data } = await supabase.from('books').select('id');
                if (data) targetNamespaces = data.map(b => b.id);
              }

              // Query namespaces in parallel
              const searchPromises = targetNamespaces.map(async (namespace) => {
                const res = await fetch(`https://${cleanHost}/query`, {
                  method: 'POST',
                  headers: { 'Api-Key': PINECONE_API_KEY, 'Content-Type': 'application/json' },
                  body: JSON.stringify({ namespace, vector: queryVector, topK: 3, includeMetadata: true })
                });
                if (!res.ok) return [];
                const resData = await res.json();
                return resData.matches || [];
              });

              const resultsArray = await Promise.all(searchPromises);
              const allMatches = resultsArray.flat();
              
              // Sort gathered results globally by score
              allMatches.sort((a: any, b: any) => b.score - a.score);
              const topMatches = allMatches.slice(0, 5).map((m: any) => m.metadata);
              
              toolResult = { status: "success", matches: topMatches };
            }
            else if (name === "get_book_toc") {
              executedTools.push(`Consulted syllabus for "${args.query}"`);
              const { data } = await supabase.from('books').select('id, title, toc').ilike('title', `%${args.query}%`).limit(1);
              if (data && data.length > 0) {
                toolResult = { status: "success", book_id: data[0].id, title: data[0].title, toc: data[0].toc || "No TOC available." };
              } else {
                toolResult = { status: "error", message: "Book not found in catalog." };
              }
            } 
            else if (name === "read_book_section") {
              executedTools.push(`Reading material: "${args.section_title}"`);
              const { data: books } = await supabase.from('books').select('id, toc').eq('id', args.book_id).single();
              
              if (books) {
                const flatToc: any[] = [];
                function flatten(nodes: any[]) {
                  for (const n of nodes) {
                    flatToc.push(n);
                    if (n.children) flatten(n.children);
                  }
                }
                flatten(books.toc || []);

                const targetIdx = flatToc.findIndex((n: any) => n.title.toLowerCase().includes(args.section_title.toLowerCase()));
                
                if (targetIdx !== -1) {
                  const startPage = flatToc[targetIdx].page;
                  let endPage = 99999;
                  
                  for (let i = targetIdx + 1; i < flatToc.length; i++) {
                    if (flatToc[i].page && flatToc[i].page > startPage) {
                      endPage = flatToc[i].page;
                      break;
                    }
                  }

                  const { data: pages } = await supabase.from('book_pages')
                    .select('page_number, content_json')
                    .eq('book_id', args.book_id)
                    .gte('page_number', startPage)
                    .lt('page_number', endPage)
                    .order('page_number', { ascending: true })
                    .limit(10);

                  let sectionText = "";
                  if (pages) {
                    sectionText = pages.map(p => `--- PAGE ${p.page_number} ---\n` + extractTextFromBlockArray(p.content_json || [])).join("\n\n");
                  }
                  toolResult = { status: "success", text: sectionText || "Section is empty." };
                } else {
                  toolResult = { status: "error", message: "Section not found in TOC." };
                }
              } else {
                toolResult = { status: "error", message: "Book ID invalid." };
              }
            }
            else if (name === "open_page") {
              executedTools.push(`Located anchor at Book ${args.book_id}, Page ${args.page_number}`);
              uiCommand = { action: 'open_page', book_id: args.book_id, page_number: args.page_number };
              toolResult = { status: "success", message: "User is being navigated to the page." };
            }
          } catch (e) {
            toolResult = { status: "error", message: e.message };
          }

          return { name, content: toolResult };
        });

        const toolResponses = await Promise.all(toolExecutionPromises);

        // Push Miron's request and our Tool Responses into the history to keep the loop going
        messages.push(candidate.content);
        messages.push({
          role: "user",
          parts: toolResponses.map(res => ({
            functionResponse: {
              name: res.name,
              response: { name: res.name, content: res.content }
            }
          }))
        });

        loopCount++;
      } else {
        // Miron chose to reply with standard text instead of calling a tool. Break the loop.
        isToolCall = false;
        finalText = candidate?.content?.parts?.[0]?.text || "My cognitive link was interrupted. Please try again.";
      }
    }

    if (loopCount >= 5) {
      finalText = "I had to abort my analysis—the thought process exceeded optimal boundaries. Please narrow your question.";
    }

    return new Response(JSON.stringify({ 
      response: finalText,
      thoughts: executedTools,
      ui_command: uiCommand
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error) {
    console.error(`[MIRON FATAL] ${error.message}`);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});