import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// 1. Polyfill document (Must run before library loads)
if (typeof document === "undefined") {
  (globalThis as any).document = { currentScript: null };
}

// --- CONFIGURATION ---
const GITHUB_USER = "GetyeTek"; 
const DEFAULT_REPO = "IDE"; 
const MAIN_BRANCH = "main";
const DEV_BRANCH = "conduit-dev";

// --- AI REGISTRY & ROUTING ---
interface AIProvider {
  name: string;
  baseUrl: string;
  model: string;
  apiKeyEnv: string;
  type: 'openai' | 'google';
}

interface AIConfig {
  providers: Record<string, AIProvider>;
  roles: {
    chat: string;
    architect: string;
    fast_fix: string;
    analyst: string;
  };
}

const DEFAULT_AI_CONFIG: AIConfig = {
  providers: {
    'default_main': {
      name: 'DeepSeek V3 (OpenRouter)',
      baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
      model: 'deepseek/deepseek-chat',
      apiKeyEnv: 'Deepseek_API',
      type: 'openai'
    },
    'default_analyst': {
       name: 'Gemini Flash (Google)',
       baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent',
       model: '', // Model is in URL for Google Native
       apiKeyEnv: 'GEMINI_API_KEY',
       type: 'google'
    }
  },
  roles: {
    chat: 'default_main',
    architect: 'default_main',
    fast_fix: 'default_main',
    analyst: 'default_analyst'
  }
};

function resolveProvider(role: keyof AIConfig['roles'], config?: AIConfig): AIProvider | null {
  const effectiveConfig = config || DEFAULT_AI_CONFIG;
  // Fallback to default if roles missing in custom config
  const providerKey = effectiveConfig.roles?.[role] || DEFAULT_AI_CONFIG.roles[role];
  const provider = effectiveConfig.providers?.[providerKey] || DEFAULT_AI_CONFIG.providers[providerKey];
  return provider || null;
}

// Initialize Supabase
const supabase = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "" 
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// --- UTILITIES ---
function base64ToText(str: string) {
    try {
        const binString = atob(str.replace(/\s/g, ''));
        const bytes = Uint8Array.from(binString, (m) => m.codePointAt(0)!);
        return new TextDecoder().decode(bytes);
    } catch (e) { return ""; }
}

function textToBase64(str: string) {
    const bytes = new TextEncoder().encode(str);
    const binString = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
    return btoa(binString);
}

function escapeRegExp(string: string) { 
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); 
}

function isRecordInScope(record: any, scopePath: string): boolean {
    if (!scopePath || scopePath === "/" || scopePath === "") return true;
    if (record.type === 'Checkpoint') return true; // Always show checkpoints
    // Allow if matches scope OR is an Edge Function operation
    if (record.ops && Array.isArray(record.ops)) {
        return record.ops.some((op: any) => 
            (op.file_path && op.file_path.startsWith(scopePath)) || 
            op.is_resolved_ef ||
            (op.file_path && op.file_path.includes("supabase/functions/"))
        );
    }
    if (record.data && record.data.results && Array.isArray(record.data.results)) {
        return record.data.results.some((res: any) => 
            (res.file && res.file.startsWith(scopePath)) ||
            (res.file && res.file.includes("supabase/functions/"))
        );
    }
    return true;
}

function getNumberedContent(content: string): string {
  if (!content) return "";
  const lines = content.split("\n");
  const pad = lines.length.toString().length;
  return lines.map((line, i) => `${(i + 1).toString().padStart(pad)} | ${line}`).join("\n");
}

// --- GITHUB API HELPERS ---
const getHeaders = () => ({
  "Authorization": `token ${Deno.env.get("GITHUB_PAT")}`,
  "Accept": "application/vnd.github.v3+json",
  "Content-Type": "application/json",
  "User-Agent": "Conduit-IDE-Agent",
});

async function githubFetch(repo: string, path: string, options: RequestInit = {}) {
  // Intelligent Repo Parsing: If 'owner/repo' is passed, use it directly. Otherwise prepend GITHUB_USER.
  const cleanRepo = repo.includes('/') ? repo : `${GITHUB_USER}/${repo}`;
  const url = `https://api.github.com/repos/${cleanRepo}${path}`;
  
  const res = await fetch(url, { ...options, headers: { ...getHeaders(), ...options.headers } });
  
  if (!res.ok) {
      const text = await res.text();
      // Pass through the actual GitHub error details for debugging
      throw new Error(`GitHub API Error ${res.status} on ${url}: ${text}`);
  }
  if (res.status === 204) return {}; 
  return res.json();
}

async function getFileRaw(repo: string, filePath: string, ref: string) {
  try {
    const data = await githubFetch(repo, `/contents/${filePath}?ref=${ref}`);
    return { content: data.content, sha: data.sha }; 
  } catch (e: any) { 
    console.error(`[getFileRaw] Error on ${filePath}:`, e.message);
    return { content: "", sha: "" }; 
  }
}

async function updateFile(repo: string, filePath: string, content: string, sha: string, branch: string, message: string) {
  const encoded = textToBase64(content);
  const payload: any = { message, content: encoded, branch };
  if(sha) payload.sha = sha;
  
  const res = await githubFetch(repo, `/contents/${filePath}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  return res.commit.sha;
}

async function deleteFile(repo: string, filePath: string, sha: string, branch: string, message: string) {
  const payload = { message, sha, branch };
  const res = await githubFetch(repo, `/contents/${filePath}`, {
    method: "DELETE",
    body: JSON.stringify(payload),
  });
  return res.commit?.sha; 
}

async function dispatchWorkflow(repo: string, eventType: string, payload: any = {}) {
  await githubFetch(repo, `/dispatches`, {
    method: "POST",
    body: JSON.stringify({ event_type: eventType, client_payload: payload }),
  });
  return true;
}

async function triggerWorkflowFile(repo: string, workflowId: string, ref: string, inputs: any = {}) {
  // Debug log to console (viewable in Supabase Edge Function logs)
  console.log(`[GitHub Dispatch] Target: ${workflowId}, Ref: ${ref}, Inputs:`, JSON.stringify(inputs));
  
  await githubFetch(repo, `/actions/workflows/${workflowId}/dispatches`, {
    method: "POST",
    body: JSON.stringify({ ref: ref, inputs: inputs }),
  });
  return true;
}

async function ensureBranchExists(repo: string) {
  // 1. Check if DEV_BRANCH already exists
  try { 
      await githubFetch(repo, `/branches/${DEV_BRANCH}`); 
      return; 
  } catch (e) { /* Branch doesn't exist, proceed to create it */ }

  let baseSha = "";
  
  // 2. Try to find existing 'main' or 'master'
  try {
      const main = await githubFetch(repo, `/git/ref/heads/${MAIN_BRANCH}`);
      baseSha = main.object.sha;
  } catch (e) {
      try {
          // Fallback: Check for 'master' just in case
          const master = await githubFetch(repo, `/git/ref/heads/master`);
          baseSha = master.object.sha;
      } catch (e2) {
          // 3. REPO IS EMPTY (No main, no master)
          // We must create the "Root Commit" by creating a README
          console.log("Repo appears empty. Initializing with README.md...");
          try {
              // Create README directly on MAIN to initialize the repo history
              await updateFile(repo, "README.md", "# Project Initialized by Conduit", "", MAIN_BRANCH, "Initial commit");
              
              // Now that the commit exists, get its SHA
              const newMain = await githubFetch(repo, `/git/ref/heads/${MAIN_BRANCH}`);
              baseSha = newMain.object.sha;
          } catch (e3: any) {
              console.error("Failed to auto-initialize repo:", e3);
              throw new Error("Repository is empty and auto-initialization failed. Please create a README.md manually on GitHub.");
          }
      }
  }

  // 4. Create the DEV_BRANCH
  if (baseSha) {
      try {
          await githubFetch(repo, `/git/refs`, { 
              method: "POST", 
              body: JSON.stringify({ ref: `refs/heads/${DEV_BRANCH}`, sha: baseSha }) 
          });
      } catch (e:any) {
          console.error("Error creating dev branch refs:", e);
      }
  }
}

// --- AI CORE SERVICES ---

async function genericRequestAI(role: keyof AIConfig['roles'], messages: any[], config?: AIConfig, tools?: any[], responseFormat?: any): Promise<any> {
  const provider = resolveProvider(role, config);
  if (!provider) throw new Error(`No provider found for role: ${role}`);

  // --- DEBUG LOGGING ---
  // 1. Critical Console Log (Visible in Supabase Dashboard)
  console.log(`\n=== [AI PROMPT SENT] Role: ${role} | Provider: ${provider.name} ===`);
  console.log(JSON.stringify(messages, null, 2));
  if (tools) console.log("TOOLS:", JSON.stringify(tools, null, 2));
  console.log("=== [END PROMPT] ===\n");

  // 2. Persistent DB Log
  // We use a try-catch to ensure logging failure doesn't block the actual AI request
  try {
      await supabase.from('conduit_logs').insert({
          repo_name: 'DEBUG_TRACE', // Utility function doesn't know repo, using placeholder
          type: 'ai_prompt_dump',
          data: { 
              role, 
              provider: provider.name, 
              model: provider.model, 
              timestamp: new Date().toISOString(),
              messages_preview: messages 
          }
      });
  } catch (e) { console.error("Background log failed:", e); }
  
  // Advanced Rotation Logic: Fetch Least-Recently-Used key from 'api_keys' table
  const serviceMap: Record<string, string> = { 
      'Deepseek_API': 'deepseek', 
      'GEMINI_API_KEY': 'gemini', 
      'GROQ_API_KEY': 'groq' 
  };
  const serviceName = serviceMap[provider.apiKeyEnv];
  let apiKey = "";

  if (serviceName) {
      const { data: keyRow } = await supabase
          .from('api_keys')
          .select('id, api_key')
          .eq('service', serviceName)
          .eq('is_active', true)
          .or(`cooldown_until.is.null,cooldown_until.lt.${new Date().toISOString()}`)
          .order('last_used_at', { ascending: true, nullsFirst: true })
          .limit(1)
          .maybeSingle();

      if (keyRow) {
          apiKey = keyRow.api_key;
          // Mark as used immediately to move it to the end of the rotation queue
          await supabase.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', keyRow.id);
      }
  }

  // Fallback to Env Var if no key found in DB or service not mapped
  if (!apiKey) {
      apiKey = Deno.env.get(provider.apiKeyEnv) || "";
      if (!apiKey) {
          if (provider.apiKeyEnv && provider.apiKeyEnv.length > 10) apiKey = provider.apiKeyEnv;
          else throw new Error(`Missing API Key: No active keys for '${serviceName || provider.apiKeyEnv}' in DB or Env`);
      }
  }

  // ADAPTER: Google Native
  if (provider.type === 'google') {
    const promptText = messages.map(m => `[${m.role.toUpperCase()}]: ${m.content}`).join('\n');
    const url = `${provider.baseUrl}?key=${apiKey}`;
    
    const payload: any = { 
        contents: [{ parts: [{ text: promptText }] }] 
    };

    // MAP OPENAI TOOLS TO GOOGLE FUNCTION DECLARATIONS
    if (tools && tools.length > 0) {
        const mapType = (t: any) => {
            // Flatten union types ["integer", "null"] -> "INTEGER"
            const rawType = Array.isArray(t) ? t[0] : t;
            if (rawType === "integer") return "INTEGER";
            if (rawType === "string") return "STRING";
            if (rawType === "boolean") return "BOOLEAN";
            if (rawType === "number") return "NUMBER";
            if (rawType === "object") return "OBJECT";
            if (rawType === "array") return "ARRAY";
            return "STRING"; // Fallback
        };

        const transformSchema = (schema: any): any => {
            const newSchema: any = { type: mapType(schema.type) };
            if (schema.properties) {
                newSchema.properties = {};
                for (const key in schema.properties) {
                    newSchema.properties[key] = transformSchema(schema.properties[key]);
                }
            }
            if (schema.required) newSchema.required = schema.required;
            return newSchema;
        };

        payload.tools = [{
            function_declarations: tools.map((t: any) => ({
                name: t.function.name,
                description: t.function.description,
                parameters: transformSchema(t.function.parameters)
            }))
        }];
    }
    
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await res.json();
    
    if (data.error) throw new Error(`Google AI Error: ${data.error.message || JSON.stringify(data.error)}`);
    
    // --- RAW DEBUG LOG (Supabase Dashboard) ---
    console.log(`\n=== [AI RESPONSE RECEIVED] Provider: ${provider.name} (Google) ===`);
    console.log(JSON.stringify(data, null, 2));
    console.log("=== [END RESPONSE] ===\n");

    const part = data.candidates?.[0]?.content?.parts?.[0];
    let tool_calls = undefined;
    
    if (part?.functionCall) {
        // Map Gemini FunctionCall to OpenAI ToolCall format
        tool_calls = [{
            function: {
                name: part.functionCall.name,
                // Gemini args are objects, OpenAI expects JSON strings
                arguments: JSON.stringify(part.functionCall.args)
            }
        }];
    }

    return { 
      raw: data, 
      content: part?.text || "",
      tool_calls: tool_calls
    };
  }

  // ADAPTER: OpenAI Compatible (Standard)
  const body: any = {
    model: provider.model,
    messages: messages,
  };
  if (tools) body.tools = tools;
  if (tools) body.tool_choice = "auto";
  if (responseFormat) body.response_format = responseFormat;

  const res = await fetch(provider.baseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify(body)
  });
  
  const data = await res.json();

  // --- RAW DEBUG LOG (Supabase Dashboard) ---
  console.log(`\n=== [AI RESPONSE RECEIVED] Provider: ${provider.name} (Standard) ===`);
  console.log(JSON.stringify(data, null, 2));
  console.log("=== [END RESPONSE] ===\n");
  
  if (!res.ok || data.error) {
      const errMsg = data.error ? (data.error.message || JSON.stringify(data.error)) : `HTTP ${res.status} ${res.statusText}`;
      throw new Error(`Provider Error (${provider.name}): ${errMsg}`);
  }

  return {
    raw: data,
    content: data.choices?.[0]?.message?.content || "",
    tool_calls: data.choices?.[0]?.message?.tool_calls
  };
}

// 1. Syntax Repair
async function repairSyntaxWithAI(codeBlock: string, errorMessage: string, config?: AIConfig): Promise<{ fixed_code: string | null; explanation: string }> {
    console.log("--- AI REPAIR SYNTAX START ---");
    const systemInstruction = `You are a JS/HTML/CSS Syntax Repair Agent. Fix the syntax error without changing logic. Call the 'provide_fixed_code' function.`;
    const tools = [{ 
        type: "function", 
        function: { 
            name: "provide_fixed_code", 
            description: "Return corrected code", 
            parameters: { 
                type: "object", 
                properties: { fixed_code: { type: "string" }, explanation: { type: "string" } }, 
                required: ["fixed_code", "explanation"] 
            } 
        } 
    }];

    try {
        console.log(`[SyntaxRepair] Prompting AI. Code Len: ${codeBlock.length}, Error: ${errorMessage}`);
        
        const messages = [
            { role: "system", content: systemInstruction },
            { role: "user", content: "Code:\n" + codeBlock + "\nError:\n" + errorMessage }
        ];

        const result = await genericRequestAI('fast_fix', messages, config, tools);
        const toolCall = result.tool_calls?.[0];
        if (toolCall && toolCall.function.name === "provide_fixed_code") {
             const args = JSON.parse(toolCall.function.arguments);
             return { fixed_code: args.fixed_code, explanation: args.explanation };
        }
        return { fixed_code: null, explanation: "AI failed to call tool." };
    } catch (e: any) { console.error("[SyntaxRepair] Error:", e); return { fixed_code: null, explanation: e.message }; }
}

// 2. Self-Healing (Healer)
async function consultAI(fileContent: string, failedOp: any, failReason: string, config?: AIConfig): Promise<{ fixedOp: any | null; reason: string; score: number }> {
  console.log(`--- CONSULT AI (HEALER) START for ${failedOp?.action} ---`);
  
  const systemInstruction = `YOU ARE THE CONDUIT ADAPTIVE SELF-HEALING ENGINE.

### MISSION
A code patch failed because the 'find_block' or 'anchor' provided by the user did not match the file content EXACTLY. Your mission is to find where that code was INTENDED to go by performing high-level semantic and fuzzy matching.

### CORE MATCHING RULES
1. WHITESPACE INDEPENDENCE: Ignore all tabs, spaces, and newlines. If the logic is the same, it is a MATCH.
2. SEMANTIC EQUIVALENCE: 'obj.prop' is the same as 'obj . prop'. 'x=1' is the same as 'x = 1'.
3. CONTEXTUAL ANCHORING: If the target code is generic (like just a '}' or 'else'), look at the lines BEFORE and AFTER to confirm the location.
4. DEGRADATION TOLERANCE: If the user provided 5 lines of code, but the file only has 4 of them (and 1 changed slightly), treat it as a match on those lines.

### OUTPUT STRATEGIES (Choose ONE)
- STRATEGY A (Range Replace): Use 'start_line' and 'end_line' if you found the exact block. This is the most reliable.
- STRATEGY B (Line Insert): Use 'anchor_line' if the user wanted to 'insert_after' or 'insert_before' a line that moved.
- STRATEGY C (String Anchor): Use 'new_anchor_text' if you found a more unique string that the Patcher can use for a standard match.

### DATA INTEGRITY REQUIREMENTS
- confidence_score: MUST BE AN INTEGER BETWEEN 0 AND 100. DO NOT USE DECIMALS (e.g., Use 95, NOT 0.95).
- start_line / end_line: These are 1-based indices corresponding to the line numbers provided in the 'File' context.
- explanation: Be technical. Explain exactly what caused the mismatch (e.g., "User expected a single line, but the file split the arguments across lines 12-14").

### EXAMPLE SCENARIOS

Scenario 1: User wants to replace a function, but added a comment in the find_block that doesn't exist.
- Fix: Set 'start_line' and 'end_line' to the actual function boundaries in the file. Set score to 90.

Scenario 2: User wants to insert after 'const x = 10', but the file has 'const x=10' (no spaces).
- Fix: Set 'anchor_line' to the line number where 'const x=10' exists. Set score to 100.

Scenario 3: The code is nowhere to be found.
- Fix: Set 'can_fix' to false. Explain that the logic appears to have been deleted. Set score to 0.

Final Instruction: Look at the line numbers provided in the context carefully. If a block starts on line 10 and ends on line 15, 'start_line' is 10 and 'end_line' is 15.`;

  const tools = [{ 
    type: "function",
    function: { 
        name: "suggest_fix", 
        description: "Provide the correct coordinates or strings to fix a failed patch operation.", 
        parameters: { 
            type: "object", 
            properties: { 
                can_fix: { 
                    type: "boolean",
                    description: "Whether you successfully located the intended code target."
                }, 
                confidence_score: { 
                    type: "integer", 
                    minimum: 0, 
                    maximum: 100, 
                    description: "Integer from 0-100. 100 = Certain match. 0 = Not found. DO NOT USE FLOATS."
                }, 
                explanation: { 
                    type: "string",
                    description: "Detailed technical reasoning for why the original match failed and why this new target is correct."
                }, 
                start_line: { 
                    type: ["integer", "null"], 
                    description: "The 1-based start line number of the code block to be replaced."
                }, 
                end_line: { 
                    type: ["integer", "null"], 
                    description: "The 1-based end line number of the code block to be replaced."
                }, 
                anchor_line: { 
                    type: ["integer", "null"], 
                    description: "For insertion ops: The 1-based line number to act as the anchor."
                }, 
                new_anchor_text: { 
                    type: ["string", "null"], 
                    description: "A unique, exact string from the file that can be used as a new anchor."
                } 
            }, 
            required: ["can_fix", "explanation", "confidence_score"] 
        } 
    } 
  }];

  try {
    const userPrompt = "File:\n" + getNumberedContent(fileContent) + "\nOp:\n" + JSON.stringify(failedOp) + "\nError:\n" + failReason;
    console.log("[Healer] Prompt Sent (Excluding File):", systemInstruction + "\nOp: " + JSON.stringify(failedOp) + "\nReason: " + failReason);
    
    const messages = [
        { role: "system", content: systemInstruction },
        { role: "user", content: userPrompt }
    ];
    
    const result = await genericRequestAI('fast_fix', messages, config, tools);
    console.log("🔥 [HEALER RAW DEBUG]:", JSON.stringify(result, null, 2));
    
    const toolCall = result.tool_calls?.[0];
    if (!toolCall || toolCall.function.name !== "suggest_fix") {
        // Fallback: If AI refused to call tool, return its text response as the reason
        const rawText = result.content || "AI returned no content and no tool calls.";
        return { fixedOp: null, reason: `AI Refusal: ${rawText.substring(0, 200)}`, score: 0 };
    }
    
    const args = JSON.parse(toolCall.function.arguments);

    // DEFENSIVE CODING: Normalize score. AI sometimes returns 0.95 instead of 95.
    let score = args.confidence_score;
    if (score <= 1 && score > 0) score = score * 100;

    if (!args || !args.can_fix || score < 60) return { fixedOp: null, reason: args?.explanation || "Low confidence match", score: score || 0 };
    
    const newOp = { ...failedOp, is_ai_fix: true };
    if (args.start_line) {
        newOp.ai_strategy = "range_replace";
        newOp.start_line = args.start_line;
        newOp.end_line = args.end_line || args.start_line;
    } 
    else if (args.anchor_line) {
        newOp.ai_strategy = "line_insert";
        newOp.anchor_line = args.anchor_line;
    }
    else if (args.new_anchor_text) {
        // If AI gives a better string, swap it into the original operation
        if (newOp.action === "replace_block") newOp.find_block = args.new_anchor_text;
        else newOp.anchor = args.new_anchor_text;
        newOp.is_ai_fix = false; // Run it through standard logic with the new string
    }
    return { fixedOp: newOp, reason: args.explanation, score: args.confidence_score };
  } catch (e: any) { console.error("[Healer] Error:", e); return { fixedOp: null, reason: e.message, score: 0 }; }
}

// 3. Code Sanity Checker (Context-Aware)
async function checkCodeSanity(code: string, op: any, config?: AIConfig): Promise<{ sane: boolean; issues: string }> {
    console.log("--- SANITY CHECK START ---");
    
    const prompt = `
    I just performed a code modification. Check if it introduced any FATAL syntax errors.
    
    OPERATION PERFORMED:
    ${JSON.stringify(op, null, 2)}
    
    RESULTING FILE CONTENT:
    ${code.substring(0, 15000)}
    
    TASK:
    1. Focus specifically on the area where the operation occurred.
    2. Check for disturbed nesting, unclosed braces/tags, or invalid syntax caused by this specific change.
    3. Ignore pre-existing issues unrelated to this change.
    
    OUTPUT JSON ONLY: { "sane": boolean, "issues": "concise description of error" }
    `;

    try {
        console.log("[Sanity] Prompt Sent (Op Only):", JSON.stringify(op));
        
        const result = await genericRequestAI('fast_fix', [{ role: "user", content: prompt }], config, undefined, { type: "json_object" });
        console.log("[Sanity] Response:", JSON.stringify(result.raw));
        
        const text = result.content || "{}";
        const json = JSON.parse(text);
        return { sane: !!json.sane, issues: json.issues || "" };
    } catch (e) { console.error("[Sanity] Error:", e); return { sane: true, issues: "" }; }
}

// 4. STEP A: DETECTIVE (Analyze Logs & Identify Files)
async function analyzeLogsAndIdentifyFiles(logText: string, config?: AIConfig): Promise<{ summary: string, files: string[] }> {
    console.log("--- ANALYZE LOGS START ---");

    const prompt = `
    You are a CI/CD Build Failure Analyzer.
    
    TASK 1: Write a DETAILED technical summary of why the build failed.
            - Include specific error messages, line numbers, and stack trace details.
            - Explicitly explain the root cause.
    TASK 2: Identify the specific file path(s) in the repo causing the error.
    
    CRITICAL FORMAT REQUIREMENT:
    1. Write the summary first.
    2. END YOUR RESPONSE with a valid JSON array of file paths wrapped in tags.
    
    TEMPLATE FOR THE END OF RESPONSE:
    <<<FILES
    [
        "path/to/file1.ext",
        "path/to/file2.ext"
    ]
    FILES>>>

    LOGS:
    ${logText}
    `;

    try {
        console.log(`[Detective] Sending Log Analysis...`);

        // The universal adapter handles the Google/OpenAI specific formatting
        const result = await genericRequestAI('analyst', [{ role: "user", content: prompt }], config);
        const rawOutput = result.content || "";

        let summary = rawOutput;
        let files: string[] = [];

        // 1. Try Strict JSON Parsing
        const jsonMatch = rawOutput.match(/<<<FILES\s*([\s\S]*?)\s*FILES>>>/);
        
        if (jsonMatch && jsonMatch[1]) {
            try {
                files = JSON.parse(jsonMatch[1]);
                summary = rawOutput.replace(jsonMatch[0], "").trim();
            } catch (e) { console.error("Failed to parse file list JSON", e); }
        } 
        
        // 2. FALLBACK: If AI ignored JSON, Regex search the text for file paths
        if (files.length === 0) {
            console.log("[Detective] JSON not found, attempting regex extraction...");
            const pathRegex = /(?:[\w-]+\/)+[\w-]+\.[a-z]{2,4}/gi;
            const matches = rawOutput.match(pathRegex);
            if (matches) {
                // Deduplicate and filter
                files = [...new Set(matches)].filter(p => !p.includes("..."));
                console.log("[Detective] Recovered files via regex:", files);
            }
        }

        // Clean up paths (remove /home/runner/work/... if present)
        files = files.map(f => {
            const parts = f.split('/');
            const srcIndex = parts.indexOf('src');
            if (srcIndex > 0) return parts.slice(srcIndex - 1).join('/'); 
            return f;
        });

        return { summary, files };
    } catch (e) {
        console.error("[Detective] Gemini Error:", e);
        return { summary: "AI Analysis Failed", files: [] };
    }
}

// 5. STEP B: SURGEON (Generate Fix from Summary + Full Files)
async function generateFixFromFullContext(summary: string, contextFiles: any[], changeContext: string, config?: AIConfig): Promise<string> {
    console.log("--- GENERATE FIX (SURGEON) START ---");
    
    // Full Content - No Truncation as requested
    const filesStr = contextFiles.map((f:any) => 
        `FILE: ${f.path}\n${base64ToText(f.content)}` // <-- NO SUBSTRING()
    ).join("\n---\n");

    const prompt = `
    You are a Strict Code Patch Generator.
    The CI Build Failed.
    
    ERROR SUMMARY:
    ${summary}

    CONTEXT FILES (FULL CONTENT):
    ${filesStr}

    LAST COMMIT DIFF (Likely Source of Error):
    ${changeContext || "No change context available. Analyze the full file."}

    TASK:
    Generate a JSON Patch Array to fix the error.
    
    CRITICAL RULES:
    1. Every operation MUST include "file_path" and it must be one of the paths provided in the CONTEXT.
    2. Use "replace_block" or "insert_after".
    3. First operation MUST be a "comment" with a CONCISE, ONE-LINE summary of the fix (Max 100 chars).
    4. RETURN RAW JSON ARRAY ONLY. No markdown.

    SCHEMA REFERENCE:
    - REPLACE: { "file_path": "string", "action": "replace_block", "find_block": "EXACT_CODE_MATCH", "replace_with": "NEW_CODE" }
    - INSERT: { "file_path": "string", "action": "insert_after", "anchor": "EXACT_UNIQUE_LINE", "content": "NEW_CODE" }
    - COMMENT: { "action": "comment", "text": "SUMMARY_OF_CHANGES" } 
    `;

    try {
        console.log("[Surgeon] Prompt Prepared.");
        console.log("Error Summary:", summary);
        console.log("Diff Context:", changeContext);
        console.log("Files included:", contextFiles.map((c:any)=>c.path));

        const result = await genericRequestAI('architect', [{ role: "user", content: prompt }], config);
        console.log("[Surgeon] Response:", JSON.stringify(result.raw));
        
        const text = result.content || "[]";
        
        // Robust JSON Extraction using Regex
        const match = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/```\s*([\s\S]*?)\s*```/);
        if (match) return match[1].trim();

        // Fallback: Try to find the first '[' and last ']' if no markdown blocks
        const start = text.indexOf('[');
        const end = text.lastIndexOf(']');
        if (start !== -1 && end !== -1 && end > start) {
            return text.substring(start, end + 1);
        }

        return "[]";
    } catch (e) { console.error("[Surgeon] Error:", e); return "[]"; }
}

// --- PATCHER ENGINE ---

// Helper: Finds code block ignoring whitespace, tabs, newlines, and quote styles
function findBlockRobust(originalContent: string, searchBlock: string): { start: number; end: number } | null {
  if (!searchBlock || !originalContent) return null;

  const createFingerprint = (str: string) => {
    let clean = "";
    const map: number[] = [];
    for (let i = 0; i < str.length; i++) {
      if (!/\s/.test(str[i])) {
        clean += str[i];
        map.push(i);
      }
    }
    return { clean, map };
  };

  const fileFP = createFingerprint(originalContent);
  const searchFP = createFingerprint(searchBlock);

  // 1. Strict Structural Match
  let matchIndex = fileFP.clean.indexOf(searchFP.clean);

  // 2. Quote-Agnostic Fallback (e.g. " vs ')
  if (matchIndex === -1) {
    const normalizeQuotes = (s: string) => s.replace(/['"`]/g, '"');
    matchIndex = normalizeQuotes(fileFP.clean).indexOf(normalizeQuotes(searchFP.clean));
  }

  if (matchIndex === -1) return null;

  const start = fileFP.map[matchIndex];
  const end = fileFP.map[matchIndex + searchFP.clean.length - 1] + 1;
  return { start, end };
}

function applyOperation(content: string, op: any) {
  const lines = content.split("\n");
  
  // Helper to find line by trimmed content
  const getLineIndex = (anchor: string) => {
      const cleanAnchor = anchor.trim();
      return lines.findIndex(l => l.trim() === cleanAnchor);
  };

  try {
    // --- AI HEALING ---
    if (op.is_ai_fix) {
        if (op.ai_strategy === "range_replace" && op.start_line && op.end_line) {
            lines.splice(op.start_line - 1, (op.end_line - op.start_line) + 1, op.replace_with || op.content || "");
            return { newContent: lines.join("\n"), success: true, score: 95, message: `✨ AI: ${op.explanation}` };
        }
        if (op.ai_strategy === "line_insert" && op.anchor_line) {
            const idx = op.anchor_line - 1;
            const payload = op.replace_with || op.content || "";
            if (op.action === "insert_after") {
                lines.splice(idx + 1, 0, payload);
            } else if (op.action === "insert_before") {
                lines.splice(idx, 0, payload);
            } else {
                // If original was 'replace_block', we replace exactly that line
                lines[idx] = payload;
            }
            return { newContent: lines.join("\n"), success: true, score: 95, message: `✨ AI: ${op.explanation}` };
        }
    }

    switch (op.action) {
      case "replace_block": {
        if (!op.find_block) return { newContent: content, success: false, score: 0, message: "Missing find_block" };
        
        // Strategy A: Exact Match
        if (content.includes(op.find_block)) {
            return { newContent: content.replace(op.find_block, op.replace_with || ""), success: true, score: 100, message: "Exact match" };
        }
        // Strategy B: Robust Match (Ignores whitespace/indentation)
        const match = findBlockRobust(content, op.find_block);
        if (match) {
            const before = content.substring(0, match.start);
            const after = content.substring(match.end);
            return { newContent: before + (op.replace_with || "") + after, success: true, score: 95, message: "Structure match" };
        }
        return { newContent: content, success: false, score: 0, message: "Block not found" };
      }

      case "insert_after": {
        // Strategy A: Exact Line
        let idx = lines.indexOf(op.anchor);
        // Strategy B: Trimmed Line
        if (idx === -1) idx = getLineIndex(op.anchor);
        
        if (idx !== -1) {
            lines.splice(idx + 1, 0, op.content);
            return { newContent: lines.join("\n"), success: true, score: 100, message: "Inserted after line" };
        }
        
        // Strategy C: Robust Block Anchor
        const match = findBlockRobust(content, op.anchor);
        if (match) {
             const before = content.substring(0, match.end);
             const after = content.substring(match.end);
             return { newContent: before + "\n" + op.content + after, success: true, score: 90, message: "Robust anchor match" };
        }
        return { newContent: content, success: false, score: 0, message: "Anchor not found" };
      }

      case "insert_before": {
        let idx = lines.indexOf(op.anchor);
        if (idx === -1) idx = getLineIndex(op.anchor);

        if (idx !== -1) {
            lines.splice(idx, 0, op.content);
            return { newContent: lines.join("\n"), success: true, score: 100, message: "Inserted before line" };
        }

        const match = findBlockRobust(content, op.anchor);
        if (match) {
             const before = content.substring(0, match.start);
             const after = content.substring(match.start);
             return { newContent: before + op.content + "\n" + after, success: true, score: 90, message: "Robust anchor match" };
        }
        return { newContent: content, success: false, score: 0, message: "Anchor not found" };
      }

      case "replace_between_anchors":
        const s = content.indexOf(op.start_anchor), e = content.indexOf(op.end_anchor);
        if(s > -1 && e > -1 && e > s) {
             const pre = content.substring(0, s + op.start_anchor.length), post = content.substring(e);
             return { newContent: pre + "\n" + op.content + "\n" + post, success: true, score: 100, message: "Range replaced" };
        }
        return { newContent: content, success: false, score: 0, message: "Anchors not found" };

      case "create_file": 
        return { newContent: op.content || "", success: true, score: 100, message: "Created" };

      case "delete_file":
         return { newContent: "", success: true, score: 100, message: "Deleted" };

      default: 
        return { newContent: content, success: false, score: 0, message: "Unknown action" };
    }
  } catch(e:any) { 
      return { newContent: content, success: false, score: 0, message: `Err: ${e.message}` }; 
  }
}

// --- CORE PROCESSING LOGIC ---
async function processOperations(TARGET_REPO: string, operations: any[], projectPath: string, autoSanity: boolean, config?: AIConfig) {
    const scopePath = projectPath || "";
    if (scopePath) {
        const invalidOps = operations.filter((op: any) => {
            if (!op.file_path) return false;
            // Security Exception: Allow if inside scope OR is an Edge Function deployment
            const isScoped = op.file_path.startsWith(scopePath);
            const isEf = op.is_resolved_ef === true || op.file_path.startsWith("supabase/functions/");
            return !isScoped && !isEf;
        });
        if (invalidOps.length > 0) throw new Error(`Security: Operation on ${invalidOps[0].file_path} is outside project scope '${scopePath}'`);
    }
    
    let actualOps = [...operations];
    let patchNote = "";
    if (operations[0]?.action === 'comment') {
        patchNote = operations[0].text || "";
        actualOps = operations.slice(1);
    }
    const patchTitle = patchNote ? patchNote.split('\n')[0].substring(0, 60) : `Patch: ${actualOps.length} operations`;
    
    const devBranchRef = await githubFetch(TARGET_REPO, `/git/ref/heads/${DEV_BRANCH}`);
    const shaBeforePatch = devBranchRef.object.sha;

    const fileResults: any[] = [];
    const opsByFile: Record<string, any[]> = {};
    actualOps.forEach((op: any) => { if (op.file_path) { if (!opsByFile[op.file_path]) opsByFile[op.file_path] = []; opsByFile[op.file_path].push(op); } });

    let lastCommitSha = "";
    let anyOpFailed = false;

    for (const filePath of Object.keys(opsByFile)) {
        const opLogs: any[] = [];
        const fileOps = opsByFile[filePath];
        let { content, sha } = await getFileRaw(TARGET_REPO, filePath, DEV_BRANCH);

        // --- 1. EXPLICIT FILE EXISTENCE CHECK ---
        // If file has no SHA (doesn't exist) and we aren't running a 'create_file' op, fail early.
        const isCreation = fileOps.some((op: any) => op.action === "create_file");
        if (!sha && !isCreation) {
            anyOpFailed = true;
            fileOps.forEach((op: any) => {
                opLogs.push({ 
                    type: op.action, 
                    success: false, 
                    score: 0, 
                    message: `File path not found: ${filePath}` 
                });
            });
            fileResults.push({ file: filePath, status: "error", operations: opLogs });
            continue; // Skip to next file
        }

        let currentContent = base64ToText(content);
        let anyChange = false;

        for (const op of fileOps) {
            if (op.action === "delete_file") {
                if (!sha) { opLogs.push({ type: "delete_file", success: true, score: 100, message: "File already gone" }); }
                else {
                    try {
                        lastCommitSha = await deleteFile(TARGET_REPO, filePath, sha, DEV_BRANCH, `Conduit: Delete ${filePath}`);
                        opLogs.push({ type: "delete_file", success: true, score: 100, message: "Deleted" });
                    } catch (e: any) { opLogs.push({ type: "delete_file", success: false, score: 0, message: e.message }); anyOpFailed = true; }
                }
                currentContent = ""; sha = ""; continue;
            }

            let result = (op.action === "create_file") ? applyOperation("", op) : applyOperation(currentContent, op);

            if (!result.success && op.action !== "create_file") {
                // --- 2. ENHANCED AI HEALER ---
                const { fixedOp, reason, score } = await consultAI(currentContent, op, result.message, config);
                
                if (fixedOp) {
                    fixedOp.explanation = reason; 
                    let retryResult = applyOperation(currentContent, fixedOp);
                    
                    // Sanity Check Logic
                    if (retryResult.success && autoSanity) {
                         const sanity = await checkCodeSanity(retryResult.newContent, fixedOp, config);
                         if (!sanity.sane) {
                             opLogs.push({ type: "sanity_check", success: false, message: `Sanity Failed: ${sanity.issues}` });
                             // Recursively fix sanity
                             const { fixedOp: sanityOp, reason: sanityReason } = await consultAI(currentContent, fixedOp, `The operation ${JSON.stringify(fixedOp)} caused this syntax error: ${sanity.issues}`, config);
                             if (sanityOp) {
                                 const sanityResult = applyOperation(currentContent, sanityOp);
                                 if (sanityResult.success) { retryResult = sanityResult; fixedOp.explanation = `Auto-corrected sanity issue: ${sanityReason}`; }
                             }
                         }
                    }

                    if (retryResult.success) {
                        currentContent = retryResult.newContent;
                        anyChange = true;
                        opLogs.push({ type: op.action, success: true, score: score, message: retryResult.message, ...fixedOp });
                        continue; 
                    } else {
                        anyOpFailed = true;
                        opLogs.push({ type: op.action, success: false, score: 0, message: `AI Fix Failed: ${retryResult.message}` });
                    }
                } else {
                    // --- 3. DETAILED FAILURE LOGGING ---
                    anyOpFailed = true;
                    const failMsg = score > 0 
                        ? `Block not found. (Best Match: ${score}%). AI Reason: ${reason}`
                        : `Block not found. AI could not locate target. (${reason})`;
                        
                    opLogs.push({ type: op.action, success: false, score: score, message: failMsg });
                }
            } else {
                if (result.success) { currentContent = result.newContent; anyChange = true; } else { anyOpFailed = true; }
                opLogs.push({ type: op.action, success: result.success, score: result.score, message: result.message, ...op });
            }
        }

        if (anyChange) {
            try { lastCommitSha = await updateFile(TARGET_REPO, filePath, currentContent, sha, DEV_BRANCH, `Conduit: ${fileOps.length} ops`); } 
            catch (e: any) { anyOpFailed = true; opLogs.push({ type: 'commit_file', success: false, message: `Commit failed: ${e.message}` }); }
        }
        fileResults.push({ file: filePath, status: anyChange ? "updated" : "unchanged", operations: opLogs });
    }

    if (anyOpFailed && lastCommitSha) {
        await githubFetch(TARGET_REPO, `/git/refs/heads/${DEV_BRANCH}`, { method: "PATCH", body: JSON.stringify({ sha: shaBeforePatch, force: true }) });
        const logData = { success: false, commit_sha: null, rollback_to: shaBeforePatch, message: "Patch failed, rolled back.", results: fileResults, ops: operations };
        await supabase.from('conduit_logs').insert({ repo_name: TARGET_REPO, type: 'patch_failed', data: logData });
        return logData;
    }

    const success = !anyOpFailed;
    const finalCommitSha = success ? lastCommitSha : null;
    const logData = { success, commit_sha: finalCommitSha, results: fileResults, ops: operations };

    if (success && lastCommitSha) {
        const { data: newHistory, error } = await supabase.from('conduit_history')
            .insert({ repo_name: TARGET_REPO, title: patchTitle, note: patchNote, type: "Dev", meta: `${actualOps.length} ops`, ops: operations, sha: lastCommitSha })
            .select('conduit_id')
            .single();

        if (newHistory) {
            logData.conduit_id = newHistory.conduit_id; // Add the new ID to the response
        }
        logData.sha = lastCommitSha; // Add SHA to the log data for linking
    }
    await supabase.from('conduit_logs').insert({ repo_name: TARGET_REPO, type: 'patch', data: logData });
    return logData;
}


// --- SYNTAX VALIDATION (DELEGATED) ---
async function validateWithTreeSitter(code: string, filePath: string) {
  // Replace with your actual project URL or use Env Var
  const PROJECT_REF = Deno.env.get("SUPABASE_URL")?.split("https://")[1].split(".")[0]; 
  const VALIDATOR_URL = `https://${PROJECT_REF}.supabase.co/functions/v1/syntax_validator`;
  
  // Guard: Ensure we never send undefined code to the validator
  const safeCode = code === undefined || code === null ? "" : code;
  
  // Debug Log: Track what we are actually sending
  console.log(`[SyntaxCheck] Validating ${filePath}: ${safeCode.length} bytes`);

  try {
    const res = await fetch(VALIDATOR_URL, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}` 
      },
      body: JSON.stringify({ code: safeCode, file_path: filePath })
    });

    if (!res.ok) {
       const txt = await res.text();
       throw new Error(`Validator API Error ${res.status}: ${txt}`);
    }
    
    const data = await res.json();
    
    // Adapter: Convert Validator Response -> IDE Format
    if (data.success && data.result) {
        // Return raw objects so Client/AI can use line numbers
        return { 
            supported: true, 
            valid: data.result.valid, 
            errors: data.result.errors || [],
            warning: null 
        };
    }

    // Handle case where validator processed but failed logic
    return { supported: true, valid: true, errors: [], warning: data.error || "Validator response invalid" };

  } catch (e: any) {
    console.error("Delegated Validation Error:", e);
    // If the separate function fails, we fallback to saying 'valid' so we don't block the build
    return { supported: true, valid: true, errors: [], warning: "Syntax check skipped (Service Unavailable)" };
  }
}

// --- MAIN REQUEST HANDLER ---
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { 
      action, operations, file_path, ref_sha, version_name, repo_name, 
      code_block, error_message, messages, context_files, auto_sanity, 
      workflow_id, branch, inputs, run_id, project_path, chat_id, title, user_prompt, ai_config, ...payload 
    } = await req.json();
    const TARGET_REPO = repo_name || DEFAULT_REPO;
    await ensureBranchExists(TARGET_REPO);

    // 1. INIT
    if (action === "init") {
        const scope = project_path || "";
        const { data: history } = await supabase.from('conduit_history').select('*, conduit_id').eq('repo_name', TARGET_REPO).order('conduit_id', { ascending: false }).limit(50);
        const { data: logs } = await supabase.from('conduit_logs').select('*').eq('repo_name', TARGET_REPO).order('created_at', { ascending: false }).limit(50);
        return new Response(JSON.stringify({ history: (history || []).filter((h:any)=>isRecordInScope(h, scope)), logs: (logs || []).filter((l:any)=>isRecordInScope(l, scope)) }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 2. AI CHAT
    if (action === "ai_chat") {
        const ctx = context_files && context_files.length > 0 
            ? context_files.map((f: any) => `FILE: ${f.path}\nCONTENT:\n${f.content ? base64ToText(f.content).substring(0, 5000) : "(omitted)"}\n`).join("\n---\n") 
            : "No files selected.";
            
        const sysPrompt = `You are "Conduit", an elite Senior Software Architect and Coding Engine.

=== PRIMARY DIRECTIVE ===
You exist in two states. You must dynamically switch between them based on the user's input.

STATE 1: CONSULTANT (The Default)
- Chat naturally, concisely, and intelligently.
- Analyze problems, propose solutions, and explain concepts.
- Do NOT output JSON code blocks in this state.
- Use Markdown for code snippets if explaining, but NOT for application.

STATE 2: SURGEON (The Patcher)
- Trigger this state ONLY when the user explicitly asks for code changes (e.g., "fix this", "change that", "implement X").
- In this state, your OUTPUT must be a STRICT JSON ARRAY wrapped in \`\`\`json ... \`\`\`.
- No conversational filler outside the JSON block when in Surgery mode.

=== THE SURGERY PROTOCOL (JSON OPERATIONS) ===
You have access to exactly 3 atomic operations. Do not invent others.

1. COMMENT (Mandatory Preamble)
   - Purpose: Briefly explain the intent of the patch.
   - Format: { "action": "comment", "text": "Description of changes" }

2. REPLACE_BLOCK ( The Scalpel )
   - Purpose: Modify existing files. Use this for deletions, updates, or insertions (by replacing a line with itself + new lines).
   - Format: { "action": "replace_block", "file_path": "string", "find_block": "string", "replace_with": "string" }
   - RULES:
     a. "file_path": Must EXACTLY match a path found in the === CONTEXT === block below.
     b. "find_block": This is a STRING SEARCH, not regex. It must match the target code *character-for-character*, including indentation (spaces/tabs) and newlines.
     c. UNIQUENESS: Your "find_block" must be unique enough to locate the specific area. Include surrounding lines if necessary.
     d. NO TRUNCATION: Do not put "..." or "// existing code" in "find_block". Write it out.

3. CREATE_FILE ( The Builder )
   - Purpose: Create new files or completely overwrite corrupted ones.
   - Format: { "action": "create_file", "file_path": "string", "content": "string" }

=== CRITICAL LAWS ===
- NO "insert_after", "insert_before", or "delete_file". Use "replace_block" to achieve these effects.
- ANTI-AMBIGUITY LAW: When targeting generic code (like "}", ")", "</div>", or "return;"), your "find_block" MUST include at least 1-2 surrounding lines of code to ensure uniqueness. Never target a single symbol.
- If you need to delete code: "find_block" = the code, "replace_with" = "".
- If you need to insert code: "find_block" = the anchor line, "replace_with" = "anchor line\nnew code".
- Always double-check your JSON syntax. No trailing commas.

=== REFERENCE TEMPLATE ===
\`\`\`json
[
  { "action": "comment", "text": "Fixing typo in header and adding auth helper" },
  { 
    "action": "replace_block", 
    "file_path": "src/header.ts", 
    "find_block": "export const Header = () => {\n  return <h1>Hullo</h1>;\n}", 
    "replace_with": "export const Header = () => {\n  return <h1>Hello</h1>;\n}" 
  },
  { 
    "action": "create_file", 
    "file_path": "src/auth.ts", 
    "content": "export const check = () => true;" 
  }
]
\`\`\`
`;
        
        const openAIMessages = messages.map((m: any) => ({
            role: m.role === 'model' ? 'assistant' : 'user',
            content: m.text
        }));

        // Inject System Prompt and Context into the last message to avoid shifting role history
        const lastMsg = openAIMessages[openAIMessages.length - 1];
        if (lastMsg) lastMsg.content = `${sysPrompt}\n\n=== CONTEXT (AVAILABLE FILES) ===\n${ctx}\n\n=== USER REQUEST ===\n${lastMsg.content}`;

        const result = await genericRequestAI('chat', openAIMessages, ai_config);
        return new Response(JSON.stringify({ reply: result.content || "(Empty Response from AI)" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // --- REFINED GENERATE OPS (ROBUST PROMPT & PARSER) ---
    if (action === "generate_ops") {
        if (!user_prompt) throw new Error("Prompt required");
        
        const fileContext = context_files.map((f: any) => 
            `FILE: ${f.path}\nCONTENT:\n${f.content ? base64ToText(f.content).substring(0, 3000) : "(Content omitted)"}\n`
        ).join("\n---\n");

        const systemPrompt = `You are a Strict JSON Patch Generator.
        Your goal: Convert User Request into a valid JSON Operations Array.
        
        ALLOWED OPERATIONS:
        - REPLACE: { "file_path": "string", "action": "replace_block", "find_block": "EXACT_CODE", "replace_with": "NEW_CODE" }
        
        STRICT RULES:
        1. Output ONLY a raw JSON Array. No Markdown blocks. No Explanations.
        2. Escape all quotes inside strings properly.
        3. ABSOLUTELY NO TRAILING COMMAS.
        4. 'find_block' must match whitespace EXACTLY.
        `;

        const finalPrompt = `${systemPrompt}\n=== CONTEXT ===\n${fileContext}\n=== REQUEST ===\n${user_prompt}`;
        
        const result = await genericRequestAI('architect', [{ role: "user", content: finalPrompt }], ai_config);
        let text = result.content || "[]";
        
        // 1. Regex Extraction (Find outermost brackets)
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (jsonMatch) text = jsonMatch[0];

        // 2. Clean Markdown Wrappers if present
        text = text.replace(/```json/g, "").replace(/```/g, "").trim();

        // 3. Fix Common AI JSON Errors (Trailing commas)
        text = text.replace(/,(\s*[\]}])/g, "$1");

        // 4. Verification
        try {
            JSON.parse(text);
        } catch (e) {
            console.error("AI Generated Invalid JSON:", text);
            // Emergency Fallback: Return empty array to prevent client crash
            return new Response(JSON.stringify({ operations: "[]", error: "AI generated invalid JSON syntax. Please retry." }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        
        return new Response(JSON.stringify({ operations: text }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // --- AUTO FIX BUILD (UPDATED LOGIC) ---
    if (action === "auto_fix_build") {
        if (!run_id) throw new Error("run_id required");

        // Immediate Trace: Signal that analysis is starting
        await supabase.from('conduit_logs').insert({
            repo_name: TARGET_REPO,
            type: 'ai_trace',
            data: { 
                stage: 'INIT_AUTO_FIX', 
                run_id: run_id, 
                message: 'Fetching logs and preparing AI Detective...' 
            }
        });

        // 1. Get Log Text
        const jobsData = await githubFetch(TARGET_REPO, `/actions/runs/${run_id}/jobs`);
        const failedJob = jobsData.jobs.find((j: any) => j.conclusion === "failure");
        if (!failedJob) return new Response(JSON.stringify({ success: false, message: "No failed job found." }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

        // Get the commit SHA that triggered the failed run
        const runData = jobsData.workflow_runs?.find((r:any) => r.id === run_id) || jobsData.workflow_runs?.[0]; // Fallback
        const failedSha = runData?.head_sha || failedJob.head_sha; 
        if (!failedSha) throw new Error("Could not determine commit SHA for failed run.");

        // 1. Find the last known successful SHA from history (The "Good" base)
        const { data: lastGoodHistory } = await supabase.from('conduit_history')
            .select('sha')
            .eq('repo_name', TARGET_REPO)
            .order('conduit_id', { ascending: false })
            .limit(1)
            .maybeSingle();

        const baseSha = lastGoodHistory?.sha || `${DEV_BRANCH}~1`; // Fallback to immediate parent if no history

        const jobLogRes = await fetch(`https://api.github.com/repos/${GITHUB_USER}/${TARGET_REPO}/actions/jobs/${failedJob.id}/logs`, { headers: getHeaders(), redirect: "follow" });
        const logText = await jobLogRes.text();

        // 2. PHASE 1: Detective (Summarize & Identify Files)
        const { summary, files } = await analyzeLogsAndIdentifyFiles(logText, ai_config);
        
        // Log the analysis for user visibility
        await supabase.from('conduit_logs').insert({ 
            repo_name: TARGET_REPO, 
            type: 'job_analysis', 
            data: { job_id: String(failedJob.id), analysis: summary, identified_files: files } 
        });

        if (files.length === 0) {
            return new Response(JSON.stringify({ success: false, message: "AI could not identify source files from logs." }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        // 3. PHASE 2: Fetch FULL content of identified files AND Change Context
        const contextPayload = [];
        let changeContext = "";

        // NEW: Fetch diff (Range Compare -> Fallback to Single Commit)
        try {
            let diffFiles = [];
            
            // Strategy 1: Compare Range (Last good -> Failed)
            try {
                const diffRes = await githubFetch(TARGET_REPO, `/compare/${baseSha}...${failedSha}`);
                if (diffRes.files) diffFiles = diffRes.files;
            } catch (e) { console.warn("[AutoFix] Range compare failed, trying single commit..."); }

            // Strategy 2: Single Commit Fallback (If range empty, fetch the specific breaking commit)
            if (diffFiles.length === 0) {
                console.log(`[AutoFix] Fetching specific commit: ${failedSha}`);
                const commitRes = await githubFetch(TARGET_REPO, `/commits/${failedSha}`);
                if (commitRes.files) diffFiles = commitRes.files;
            }

            // Normalize paths for matching (remove './' or leading '/')
            const norm = (p: string) => p.replace(/^\.?\//, '').trim();
            const targetFiles = files.map(norm);

            console.log("[AutoFix] Victim Files:", targetFiles);
            console.log("[AutoFix] Diff Candidates:", diffFiles.map((f:any) => f.filename));

            // Filter diffs (Use Fuzzy Matching: endsWith instead of strict equality)
            const relevantDiffs = diffFiles.filter((f: any) => {
                const diffPath = norm(f.filename);
                return targetFiles.some(tf => {
                    // Match if 'app/src/main/Manifest.xml' ends with 'Manifest.xml' (AI output)
                    // Or if 'Manifest.xml' ends with 'app/src/main/Manifest.xml' (Unlikely but safe)
                    return diffPath.includes(tf) || tf.includes(diffPath) || diffPath.endsWith(tf) || tf.endsWith(diffPath);
                });
            });
            
            changeContext = relevantDiffs.map((f:any) => 
                `FILE: ${f.filename}\nSTATUS: ${f.status}\nPATCH:\n${f.patch || "No patch content available."}`
            ).join("\n---\n");

            console.log(`[AutoFix] Final Context Size: ${changeContext.length} chars (Matches: ${relevantDiffs.length})`);
        } catch(e) { 
            console.error("Failed to fetch diff context:", e); 
        }

        for (const path of files) {
            try { 
                const { content } = await getFileRaw(TARGET_REPO, path, DEV_BRANCH); 
                contextPayload.push({ path, content }); 
            } catch(e) { console.error(`Failed to fetch ${path}`); }
        }

        // 4. PHASE 3: Surgeon (Generate Fix) - Pass the new change context
        // Immediate Trace: Log the exact prompt context being sent to the Surgeon
        await supabase.from('conduit_logs').insert({
            repo_name: TARGET_REPO,
            type: 'ai_trace',
            data: {
                stage: 'SURGEON_PROMPT_SENT',
                error_summary: summary,
                context_files: files,
                diff_context: changeContext.substring(0, 2000) + "..."
            }
        });

        const opsJson = await generateFixFromFullContext(summary, contextPayload, changeContext, ai_config);
        let ops = [];
        try { ops = JSON.parse(opsJson); } catch(e) { throw new Error("AI generated invalid JSON"); }

        // RECURSION GUARD: Tag the commit so we don't fix our own failures infinitely
        if (ops.length > 0) {
            const tag = "[Auto-Fix]";
            if (ops[0].action === 'comment') {
                if (!ops[0].text.startsWith(tag)) ops[0].text = `${tag} ${ops[0].text}`;
            } else {
                ops.unshift({ action: 'comment', text: `${tag} Automated build repair` });
            }
        }

        if (ops.length === 0) return new Response(JSON.stringify({ success: false, message: "AI could not determine a fix." }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

        // 5. Apply Patch
        const patchResult = await processOperations(TARGET_REPO, ops, "", true, ai_config);

        // 6. Trigger Re-Build (Explicitly required for bot commits)
        let triggerMsg = "No trigger attempted";
        if (patchResult.success) {
             try {
                 // Fetch the run info to get the specific workflow ID
                 const runInfo = await githubFetch(TARGET_REPO, `/actions/runs/${run_id}`);
                 if (runInfo.workflow_id) {
                     await triggerWorkflowFile(TARGET_REPO, String(runInfo.workflow_id), DEV_BRANCH);
                     triggerMsg = `Triggered workflow ${runInfo.workflow_id}`;
                 }
             } catch(e:any) { 
                 console.error("Auto-trigger failed:", e);
                 triggerMsg = `Trigger failed: ${e.message}`; 
             }
        }

        await supabase.from('conduit_logs').insert({ repo_name: TARGET_REPO, type: 'auto_fix_trigger', data: { run_id: run_id, fix_applied: patchResult.success, ops, trigger: triggerMsg } });
        return new Response(JSON.stringify({ success: true, patch_result: patchResult, trigger_status: triggerMsg }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "patch" && operations) {
        const result = await processOperations(TARGET_REPO, operations, project_path, !!auto_sanity, ai_config);
        return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "fetch") {
      const tree = await githubFetch(TARGET_REPO, `/git/trees/${DEV_BRANCH}?recursive=1`);
      const files = tree.tree.filter((f: any) => f.type === "blob");
      return new Response(JSON.stringify({ files }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "fetch_project_bundle") {
      const tree = await githubFetch(TARGET_REPO, `/git/trees/${ref_sha || DEV_BRANCH}?recursive=1`);
      const files = tree.tree.filter((f: any) => f.type === "blob" && f.path.startsWith(payload.project_path || ""));
      const fileData: Record<string, any> = {};
      const batchSize = 5; // Reduced from 10 to avoid GitHub rate limits/timeouts
      for (let i = 0; i < files.length; i += batchSize) {
          await Promise.all(files.slice(i, i + batchSize).map(async (f: any) => {
              try { 
                  const { content } = await getFileRaw(TARGET_REPO, f.path, ref_sha || DEV_BRANCH); 
                  if(content) fileData[f.path] = { content, sha: f.sha };
              } catch (e) { console.error(`Failed to bundle ${f.path}:`, e); }
          }));
      }
      return new Response(JSON.stringify({ files: fileData }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "preview_file") {
        const { content, sha } = await getFileRaw(TARGET_REPO, file_path || 'index.html', ref_sha || DEV_BRANCH);
        return new Response(JSON.stringify({ content, sha }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "fix_syntax") {
        const result = await repairSyntaxWithAI(code_block, error_message, ai_config);
        return new Response(JSON.stringify({ success: !!result.fixed_code, fixed_code: result.fixed_code, explanation: result.explanation }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "propose_syntax_fix") {
        const { code, error, file_path } = payload;

        // STRATEGY: PURE DETERMINISTIC REPAIR (WASM-Guided)
        // We strictly adhere to validator instructions. No AI hallucinations allowed.
        if (error && error.message && error.message.startsWith("MISSING")) {
            const missingCharMatch = error.message.match(/MISSING "(.*?)"/);
            if (missingCharMatch) {
                const charToInsert = missingCharMatch[1];
                const lines = code.split('\n');
                // Tree-Sitter lines are 0-indexed internally, but usually reported 1-indexed.
                const targetLineIdx = error.line - 1;
                
                if (lines[targetLineIdx] !== undefined) {
                    console.log(`[DeterministicFix] Auto-inserting '${charToInsert}' at line ${error.line}`);
                    
                    const lineContent = lines[targetLineIdx];
                    const cleanOps = [
                        { "action": "comment", "text": `Auto-fix: Inserted missing ${charToInsert}` },
                        { 
                            "action": "replace_block", 
                            "file_path": file_path,
                            "find_block": lineContent,
                            "replace_with": lineContent + charToInsert 
                        }
                    ];
                    return new Response(JSON.stringify({ operations: JSON.stringify(cleanOps), success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }
            }
        }

        // Fallback: Return empty to signal manual intervention needed
        return new Response(JSON.stringify({ operations: "[]", success: false }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "validate_syntax_deep") {
        // ERROR FIX: 'code_block' and 'file_path' are already in the top-level scope.
        // We must NOT extract them from 'payload' (the rest object) or they will be undefined.
        
        console.log(`[DeepValidate] Input Received - File: ${file_path}, Code Length: ${code_block ? code_block.length : 'undefined'}`);

        try {
            // 1. Deterministic Check (WASM)
            // We use the top-level variable 'code_block' directly
            const tsResult = await validateWithTreeSitter(code_block || "", file_path || "file.js");
            if (tsResult.supported) {
                 return new Response(JSON.stringify(tsResult), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
            }
            // 2. Fallback: AI Analyst
            const prompt = `Analyze code for FATAL syntax errors only. Ignore warnings. CODE (${file_path}):\n${(code_block || "").substring(0, 5000)}\nOUTPUT JSON: { "valid": boolean, "errors": ["..."] }`;
            const result = await genericRequestAI('analyst', [{ role: "user", content: prompt }], ai_config, undefined, { type: "json_object" });
            const json = JSON.parse(result.content || '{"valid":true}');
            return new Response(JSON.stringify({ ...json, supported: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        } catch (e: any) {
            return new Response(JSON.stringify({ valid: false, errors: [e.message] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
    }

    if (action === "trigger_build") {
        const targetBranch = branch || DEV_BRANCH;
        
        // --- PRE-BUILD SYNTAX GUARD (OPTIMIZED BATCHING) ---
        if (payload.validate_pre_build) {
            console.log("Running Optimized Pre-Build Syntax Scan...");
            const tree = await githubFetch(TARGET_REPO, `/git/trees/${targetBranch}?recursive=1`);
            // Filter for source code files within the project scope
            const codeFiles = tree.tree.filter((f: any) => 
                f.type === "blob" && 
                f.path.startsWith(project_path || "") && 
                f.path.match(/\.(js|ts|tsx|jsx|py|go|rs|java|kt|c|cpp|json|bash|sh)$/)
            );

            const BATCH_SIZE = 5; 
            for (let i = 0; i < codeFiles.length; i += BATCH_SIZE) {
                const batch = codeFiles.slice(i, i + BATCH_SIZE);
                const batchResults = await Promise.all(batch.map(async (f: any) => {
                    const { content } = await getFileRaw(TARGET_REPO, f.path, targetBranch);
                    if (!content) return { path: f.path, valid: true };
                    const text = base64ToText(content);
                    const res = await validateWithTreeSitter(text, f.path);
                    return { path: f.path, ...res };
                }));

                for (const res of batchResults) {
                    if (!res.valid) {
                        const errorMsg = `File: ${res.path}\nErrors: ${res.errors?.slice(0, 3).join(", ")}`;
                        await supabase.from('conduit_logs').insert({ 
                            repo_name: TARGET_REPO, type: 'dispatch_aborted', 
                            data: { reason: "syntax_error", details: errorMsg } 
                        });
                        // Return structured data for Client-Side Auto-Fix
                        return new Response(JSON.stringify({ 
                            success: false, 
                            validation_error: true, 
                            file_path: res.path,
                            errors: res.errors,
                            error: errorMsg 
                        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
                    }
                }
            }
        }

        try {
            if (workflow_id) {
                await triggerWorkflowFile(TARGET_REPO, workflow_id, targetBranch, inputs || {});
            } else {
                await dispatchWorkflow(TARGET_REPO, "conduit_build_trigger", { version: version_name || "latest", source: "conduit-ide" });
            }
            await supabase.from('conduit_logs').insert({ 
                repo_name: TARGET_REPO, type: 'dispatch', 
                data: { success: true, workflow_id, branch: targetBranch } 
            });
            return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        } catch (e: any) {
            await supabase.from('conduit_logs').insert({ 
                repo_name: TARGET_REPO, type: 'dispatch_error', 
                data: { error: e.message, workflow_id } 
            });
            return new Response(JSON.stringify({ success: false, error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
    }

    if (action === "fetch_workflows") {
      const data = await githubFetch(TARGET_REPO, `/actions/runs?per_page=50`);
      return new Response(JSON.stringify({ runs: data.workflow_runs }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "fetch_workflow_jobs") {
      const data = await githubFetch(TARGET_REPO, `/actions/runs/${run_id}/jobs`);
      return new Response(JSON.stringify({ jobs: data.jobs }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "analyze_log") {
      const { job_id } = payload;
      const { data: cached } = await supabase.from('conduit_logs').select('data').eq('type', 'job_analysis').eq('repo_name', TARGET_REPO).filter('data->>job_id', 'eq', String(job_id)).maybeSingle();
      if (cached) return new Response(JSON.stringify({ analysis: cached.data.analysis, cached: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      
      const cleanRepo = TARGET_REPO.includes('/') ? TARGET_REPO : `${GITHUB_USER}/${TARGET_REPO}`;
      const logUrl = `https://api.github.com/repos/${cleanRepo}/actions/jobs/${job_id}/logs`;
      const logRes = await fetch(logUrl, { headers: { ...getHeaders() }, redirect: "follow" });
      if(!logRes.ok) throw new Error("Log fetch failed");
      const logs = await logRes.text();
      
      const prompt = `Analyze Log:\n${logs.slice(-20000)}\nOUTPUT: specific error, file/line, brief summary.`;
      
      const result = await genericRequestAI('analyst', [{ role: "user", content: prompt }], ai_config);
      const analysis = result.content || "Failed to analyze.";
      
      await supabase.from('conduit_logs').insert({ repo_name: TARGET_REPO, type: 'job_analysis', data: { job_id: String(job_id), analysis } });
      return new Response(JSON.stringify({ analysis }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "fetch_job_logs") {
      const cleanRepo = TARGET_REPO.includes('/') ? TARGET_REPO : `${GITHUB_USER}/${TARGET_REPO}`;
      const url = `https://api.github.com/repos/${cleanRepo}/actions/jobs/${payload.job_id}/logs`;
      const res = await fetch(url, { headers: { ...getHeaders() }, redirect: "follow" });
      return new Response(JSON.stringify({ logs: await res.text() }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "commit_prod") {
        const scopePath = project_path || "";
        const tree = await githubFetch(TARGET_REPO, `/git/trees/${DEV_BRANCH}?recursive=1`);
        const files = tree.tree.filter((f: any) => f.type === "blob" && f.path.startsWith(scopePath));
        let copiedCount = 0;
        for (const file of files) {
            const { content } = await getFileRaw(TARGET_REPO, file.path, DEV_BRANCH);
            if (content) {
                const textContent = base64ToText(content);
                const relativePath = scopePath ? file.path.substring(scopePath.length) : file.path;
                const cleanPath = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath;
                await updateFile(TARGET_REPO, `${version_name}/${cleanPath}`, textContent, "", MAIN_BRANCH, `Snapshot ${version_name}`);
                copiedCount++;
            }
        }
        const mainRef = await githubFetch(TARGET_REPO, `/git/ref/heads/${MAIN_BRANCH}`);
        const logData = { success: true, count: copiedCount, message: `Deployed ${version_name}` };
        await supabase.from('conduit_history').insert({ repo_name: TARGET_REPO, title: `Deployed ${version_name}`, type: "Prod", meta: `Snapshot ${copiedCount} files`, sha: mainRef.object.sha });
        await supabase.from('conduit_logs').insert({ repo_name: TARGET_REPO, type: 'commit_prod', data: logData });
        return new Response(JSON.stringify(logData), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    
    if (action === "rollback") {
    if (action === "fetch_models") {
        const provider = resolveProvider(payload.role || 'chat', ai_config);
        if (!provider) throw new Error("Provider not found");
        
        // Get API Key from DB (Reusing the rotation logic logic)
        const serviceMap: Record<string, string> = { 'Deepseek_API': 'deepseek', 'GEMINI_API_KEY': 'gemini', 'GROQ_API_KEY': 'groq' };
        const serviceName = serviceMap[provider.apiKeyEnv];
        let apiKey = "";
        if (serviceName) {
            const { data: keyRow } = await supabase.from('api_keys').select('api_key').eq('service', serviceName).eq('is_active', true).order('last_used_at', { ascending: true }).limit(1).maybeSingle();
            if (keyRow) apiKey = keyRow.api_key;
        }
        if (!apiKey) apiKey = Deno.env.get(provider.apiKeyEnv) || "";

        const res = await fetch("https://api.groq.com/openai/v1/models", {
            headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" }
        });
        const data = await res.json();
        return new Response(JSON.stringify({ models: data.data || [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
        if(!ref_sha) throw new Error("Target SHA required");
        await githubFetch(TARGET_REPO, `/git/refs/heads/${DEV_BRANCH}`, { method: "PATCH", body: JSON.stringify({ sha: ref_sha, force: true }) });
        await supabase.from('conduit_logs').insert({ repo_name: TARGET_REPO, type: 'rollback', data: { message: `Rolled back to ${ref_sha.substring(0,7)}` } });
        return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (action === "update_note") { await supabase.from('conduit_history').update({ note: payload.note }).eq('id', payload.id); return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
    if (action === "delete_history") { await supabase.from('conduit_history').delete().eq('id', payload.id); return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
    if (action === "delete_log") { await supabase.from('conduit_logs').delete().eq('id', payload.id); return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
    if (action === "delete_run") { await githubFetch(TARGET_REPO, `/actions/runs/${run_id}`, { method: "DELETE" }); return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
    if (action === "create_checkpoint") {
        const note = payload.note || "Manual Checkpoint";
        const ref = await githubFetch(TARGET_REPO, `/git/ref/heads/${DEV_BRANCH}`);
        const { error } = await supabase.from('conduit_history').insert({ 
            repo_name: TARGET_REPO, 
            title: note, 
            type: "Checkpoint", 
            meta: "No changes",
            ops: [], 
            sha: ref.object.sha 
        });
        if (error) throw new Error(`Database Error: ${error.message}`);
        return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "fetch_chats") {
        const { data, error } = await supabase.from('conduit_history')
            .select('id, title, created_at')
            .eq('repo_name', TARGET_REPO)
            .eq('type', 'Chat')
            .order('created_at', { ascending: false })
            .limit(20);
            
        if (error) {
            return new Response(JSON.stringify({ chats: [], error: error.message }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        
        return new Response(JSON.stringify({ chats: data || [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "load_chat") {
        const { data } = await supabase.from('conduit_history').select('ops').eq('id', payload.chat_id).single();
        return new Response(JSON.stringify({ messages: data?.ops || [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "save_chat") {
        // Defensively ensure messages is an array
        const chatMsgs = Array.isArray(messages) ? messages : [];
        
        // Robust Title Generation
        let chatTitle = title || "New Chat";
        if (!title && chatMsgs.length > 0) {
            const firstUserMsg = chatMsgs.find((m: any) => m.role === 'user');
            if (firstUserMsg && firstUserMsg.text) {
                chatTitle = firstUserMsg.text.substring(0, 50);
                if (firstUserMsg.text.length > 50) chatTitle += "...";
            }
        }

        let res;
        if (chat_id) {
            // Update existing session
            res = await supabase.from('conduit_history')
                .update({ ops: chatMsgs, title: chatTitle, repo_name: TARGET_REPO }) // Ensure repo stays in sync
                .eq('id', chat_id)
                .select();
        } else {
            // Create new session
            res = await supabase.from('conduit_history')
                .insert({ 
                    repo_name: TARGET_REPO, 
                    type: 'Chat', 
                    title: chatTitle, 
                    ops: chatMsgs 
                })
                .select();
        
        }

        if (res.error) {
            console.error("Save Chat Error:", res.error);
            throw new Error(`DB Error: ${res.error.message}`);
        }
        
        // Handle case where data might be empty (though unlikely with .select())
        const savedId = res.data && res.data.length > 0 ? res.data[0].id : chat_id;
        
        return new Response(JSON.stringify({ success: true, chat_id: savedId }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response("Invalid Action", { status: 400, headers: corsHeaders });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});