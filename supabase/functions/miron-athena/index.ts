import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, accept-encoding",
};

const GEMINI_MODEL = "gemini-3.1-flash-lite-preview";

// Define the Tools (Function Calling)
const toolsDefinition = {
  functionDeclarations: [
    {
      name: "fetch_book_context",
      description: "Fetch text content from a specific book or general context if no ID is known. Use this to read the textbook material.",
      parameters: {
        type: "OBJECT",
        properties: {
          search_query: { type: "STRING", description: "Topic to search for." },
        },
        required: ["search_query"]
      }
    },
    {
      name: "fetch_questions",
      description: "Fetch exam or practice questions from the database based on a topic.",
      parameters: {
        type: "OBJECT",
        properties: {
          topic: { type: "STRING" },
          limit: { type: "INTEGER", description: "Number of questions to fetch, max 5." }
        },
        required: ["topic"]
      }
    },
    {
      name: "open_page",
      description: "Instruct the user's UI to open a specific book and page number.",
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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { history, prompt, context } = await req.json();

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // 1. API Key Round-Robin & Cooldown Engine
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
      const cooldownTime = new Date(Date.now() + 5 * 60000).toISOString(); // 5 min cooldown
      await supabase.from('api_keys').update({ cooldown_until: cooldownTime }).eq('id', keyId);
      console.warn(`[API ENGINE] Key ID ${keyId} hit 429. Cooled down until ${cooldownTime}.`);
    }

    // 2. Gemini Communication Wrapper
    async function callGemini(contents: any[], tools: any[] = []) {
      let attempts = 0;
      const maxAttempts = 3;

      while (attempts < maxAttempts) {
        const keyRecord = await getGeminiKey();
        
        const payload: any = { contents };
        if (tools.length > 0) payload.tools = tools;

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

        if (!res.ok) {
          const err = await res.text();
          throw new Error(`Gemini API Error: ${res.status} ${err}`);
        }

        return await res.json();
      }
      throw new Error("Failed to contact Gemini after multiple round-robin attempts.");
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

    // 4. Initial Request to Gemini
    let geminiResponse = await callGemini(messages, [toolsDefinition]);
    let candidate = geminiResponse.candidates?.[0];

    // 5. Tool Execution Loop
    if (candidate?.content?.parts?.some((p: any) => p.functionCall)) {
      const functionCall = candidate.content.parts.find((p: any) => p.functionCall).functionCall;
      const { name, args } = functionCall;
      
      console.log(`[MIRON] Executing tool: ${name}`, args);
      let toolResult = {};

      if (name === "fetch_book_context") {
        executedTools.push(`Synthesized library records for "${args.search_query}"`);
        // Simple heuristic search on book_pages snippet or text.
        const { data } = await supabase.from('book_pages').select('content_json').limit(5);
        toolResult = { status: "success", data: "Sample extracted thermodynamics context..." }; // Replace with real full text search
      } 
      else if (name === "fetch_questions") {
        executedTools.push(`Cross-referenced examination archive for "${args.topic}"`);
        const { data } = await supabase.from('questions').select('text, options').ilike('text', `%${args.topic}%`).limit(args.limit || 3);
        toolResult = { status: "success", questions: data || [] };
      }
      else if (name === "open_page") {
        executedTools.push(`Located exact anchor at Book ${args.book_id}, Page ${args.page_number}`);
        uiCommand = { action: 'open_page', book_id: args.book_id, page_number: args.page_number };
        toolResult = { status: "success", message: "User is being navigated to the page." };
      }

      // Append function call and result to history, call Gemini again for final synthesis
      messages.push(candidate.content);
      messages.push({
        role: "user",
        parts: [{
          functionResponse: {
            name: name,
            response: { name, content: toolResult }
          }
        }]
      });

      geminiResponse = await callGemini(messages);
      candidate = geminiResponse.candidates?.[0];
    }

    // 6. Return Data
    const finalText = candidate?.content?.parts?.[0]?.text || "My cognitive link was interrupted. Please try again.";

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