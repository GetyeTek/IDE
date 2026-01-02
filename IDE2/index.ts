import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// --- CONFIGURATION ---
const GITHUB_USER = "GetyeTek"; 
const DEFAULT_REPO = "IDE"; 
const MAIN_BRANCH = "main";
const DEV_BRANCH = "conduit-dev";
// STRICTLY using the model you requested
const GEMINI_MODEL = "gemini-flash-lite-latest"; 

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
    if (record.ops && Array.isArray(record.ops)) {
        return record.ops.some((op: any) => op.file_path && op.file_path.startsWith(scopePath));
    }
    if (record.data && record.data.results && Array.isArray(record.data.results)) {
        return record.data.results.some((res: any) => res.file && res.file.startsWith(scopePath));
    }
    return true;
}

// Adds " 1 | " padding for AI context
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
  "User-Agent": "Conduit-IDE-Agent",
});

async function githubFetch(repo: string, path: string, options: RequestInit = {}) {
  const url = `https://api.github.com/repos/${GITHUB_USER}/${repo}${path}`;
  const res = await fetch(url, { ...options, headers: { ...getHeaders(), ...options.headers } });
  
  if (!res.ok) {
      if(res.status === 404) throw new Error("Not Found"); 
      throw new Error(`GitHub API Error ${res.status}: ${await res.text()}`);
  }
  
  // [FIX] If status is 204 (No Content), return empty object instead of trying to parse JSON
  if (res.status === 204) return {}; 
  
  return res.json();
}

async function getFileRaw(repo: string, filePath: string, ref: string) {
  try {
    const data = await githubFetch(repo, `/contents/${filePath}?ref=${ref}`);
    return { content: data.content, sha: data.sha }; 
  } catch (e) { return { content: "", sha: "" }; }
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

// [NEW] Delete Helper
async function deleteFile(repo: string, filePath: string, sha: string, branch: string, message: string) {
  const payload = { message, sha, branch };
  const res = await githubFetch(repo, `/contents/${filePath}`, {
    method: "DELETE",
    body: JSON.stringify(payload),
  });
  return res.commit?.sha; 
}

// [NEW] Dispatch Workflow Helper
async function dispatchWorkflow(repo: string, eventType: string, payload: any = {}) {
  await githubFetch(repo, `/dispatches`, {
    method: "POST",
    body: JSON.stringify({
      event_type: eventType,
      client_payload: payload
    }),
  });
  return true;
}

async function ensureBranchExists(repo: string) {
  try { await githubFetch(repo, `/branches/${DEV_BRANCH}`); } 
  catch {
    try {
        const main = await githubFetch(repo, `/git/ref/heads/${MAIN_BRANCH}`);
        await githubFetch(repo, `/git/refs`, { method: "POST", body: JSON.stringify({ ref: `refs/heads/${DEV_BRANCH}`, sha: main.object.sha }) });
    } catch(e) { console.error("Error creating branch:", e); }
  }
}

// --- AI CORE SERVICES ---

async function getGeminiKey(): Promise<string | null> {
  const { data, error } = await supabase
    .from("api_keys")
    .select("id, api_key")
    .eq("service", "gemini")
    .eq("is_active", true)
    .order("last_used_at", { ascending: true, nullsFirst: true })
    .limit(1)
    .single();

  if (error || !data) return null;
  supabase.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", data.id).then(() => {});
  return data.api_key;
}

// ------------------------------------------------------------------
// 1. AI REPAIR AGENT (For Syntax Errors)
// ------------------------------------------------------------------
async function repairSyntaxWithAI(codeBlock: string, errorMessage: string): Promise<{ fixed_code: string | null; explanation: string }> {
    const apiKey = await getGeminiKey();
    if (!apiKey) return { fixed_code: null, explanation: "No AI API Key" };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

    const systemInstruction = `
You are a World-Class JavaScript/HTML/CSS Syntax Repair Agent.
Your SOLE responsibility is to fix the immediate syntax error described by the parser without altering the logic, variable names, or structure of the surrounding code.

**PROTOCOL:**
1. **Analyze the Error:** Look at the 'ERROR MESSAGE' and the provided 'CODE BLOCK'. Identify exactly which character, bracket, or token is missing or misplaced.
2. **Minimal Intervention:** Touch ONLY the line(s) necessary to fix the syntax. Do not "prettify" or "refactor" unrelated code.
3. **Context Awareness:** The code provided is a *fragment* (a window of lines). Do not attempt to close functions or tags that were opened *outside* this window unless the error specifically demands it (e.g., "Unexpected end of input").
4. **Strict Output:** You MUST use the 'provide_fixed_code' tool to return the result.

**ANTI-PATTERNS (DO NOT DO THIS):**
- Do not add comments like "// Fixed here".
- Do not invent new logic.
- Do not hallucinate imports.
- Do not change indentation styles unless it was part of the error.

**OUTPUT FORMAT:**
Call the function 'provide_fixed_code' with:
- 'fixed_code': The complete, corrected block (replacing the input block).
- 'explanation': A very short sentence (max 10 words) describing the fix (e.g., "Added missing closing brace on line 5").
`;

    const userPrompt = `
=== BROKEN CODE BLOCK ===
${codeBlock}

=== PARSER ERROR ===
${errorMessage}

=== INSTRUCTION ===
Fix the syntax error. Return the corrected block via tool.
`;

    const tools = [{
        function_declarations: [{
            name: "provide_fixed_code",
            description: "Returns the syntax-corrected code block.",
            parameters: {
                type: "OBJECT",
                properties: {
                    fixed_code: { type: "STRING", description: "The complete corrected code block." },
                    explanation: { type: "STRING", description: "Concise summary of the fix." }
                },
                required: ["fixed_code", "explanation"]
            }
        }]
    }];

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ role: "user", parts: [{ text: systemInstruction + "\n" + userPrompt }] }],
                tools: tools,
                tool_config: { function_calling_config: { mode: "ANY" } }, // Force tool use
            }),
        });

        const data = await response.json();
        const call = data.candidates?.[0]?.content?.parts?.find((p: any) => p.functionCall);
        if (!call) return { fixed_code: null, explanation: "AI failed to respond with tool." };

        return { 
            fixed_code: call.functionCall.args.fixed_code, 
            explanation: call.functionCall.args.explanation 
        };

    } catch (e) {
        return { fixed_code: null, explanation: `Network Error: ${e.message}` };
    }
}


// ------------------------------------------------------------------
// 2. AI HEALER AGENT (For Failed Patch Operations)
// ------------------------------------------------------------------
async function consultAI(
  fileContent: string,
  failedOp: any,
  failReason: string
): Promise<{ fixedOp: any | null; reason: string; score: number }> {
  
  const apiKey = await getGeminiKey();
  if (!apiKey) return { fixedOp: null, reason: "No AI keys available.", score: 0 };

  const numberedFile = getNumberedContent(fileContent);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const systemInstruction = `
You are the "Conduit" Self-Healing Patch Engine.
Your goal is to locate the correct target for a JSON patch operation that failed due to a mismatch (e.g., whitespace changes, variable renames, or shifted line numbers).

**YOUR OPERATIONAL DIRECTIVES:**

1. **FORENSIC SEARCH:**
   - The "Failed Operation" contains code (anchor, find_block) that *should* exist in the file.
   - The "Rendered File" is the current state of reality.
   - You must find the *semantic equivalent* of the target in the Rendered File.

2. **HONEST CONFIDENCE SCORING (0-100):**
   - You MUST calculate a 'confidence_score' for your match.
   - **100:** Exact match or trivial whitespace difference.
   - **90-99:** Variable renaming (e.g., 'const x' -> 'let x') but identical structure.
   - **70-89:** Logic structure is same, but significant formatting/content changes.
   - **0-69:** NO MATCH FOUND. The code is missing or too different.
   - **CRITICAL:** If confidence is < 60, SET 'can_fix' to FALSE. Do not hallucinate a match.

3. **STRATEGY SELECTION:**
   - **Strategy A (Range Replace):** Use this for 'replace_block' or 'replace_between_anchors'. You identify the start and end lines (1-based) of the obsolete code to be overwritten.
   - **Strategy B (Anchor Insert):** Use this for 'insert_after' or 'insert_before'. You identify the SINGLE line number (1-based) that serves as the anchor.
   - **Strategy C (Text Fallback):** Only use if line numbers are ambiguous. Provide the corrected string text of the anchor.

4. **ANTI-HALLUCINATION PROTOCOL:**
   - If the file is empty and the op expects content, return can_fix: false.
   - If the target function/class is completely deleted, return can_fix: false.
   - Do not invent lines that do not exist in the "Rendered File".

**OUTPUT REQUIREMENT:**
You MUST strictly use the 'suggest_fix' function tool. No conversational text allowed.
`;

  const userPrompt = `
=== CURRENT FILE CONTEXT (Rendered with Line Numbers) ===
${numberedFile}

=== FAILED OPERATION DETAILS ===
${JSON.stringify(failedOp, null, 2)}

=== SYSTEM ERROR LOG ===
${failReason}

=== MISSION ===
Locate the intended target coordinates. Evaluate confidence strictly. Call 'suggest_fix'.
`;

  const tools = [{
    function_declarations: [{
      name: "suggest_fix",
      description: "Returns the corrected execution parameters for the patcher.",
      parameters: {
        type: "OBJECT",
        properties: {
          can_fix: { type: "BOOLEAN", description: "TRUE if a confident match is found. FALSE if missing/ambiguous." },
          confidence_score: { type: "INTEGER", description: "0 to 100 integer representing similarity." },
          explanation: { type: "STRING", description: "Brief justification (e.g. 'Found on line 55 with varied indentation')." },
          
          // Strategy A parameters
          start_line: { type: "INTEGER", description: "The 1-based START line number of the block to replace." },
          end_line: { type: "INTEGER", description: "The 1-based END line number of the block to replace." },
          
          // Strategy B parameters
          anchor_line: { type: "INTEGER", description: "The 1-based line number of the found anchor." },
          
          // Strategy C parameters
          new_anchor_text: { type: "STRING", description: "The corrected text string of the anchor." }
        },
        required: ["can_fix", "explanation", "confidence_score"],
      },
    }],
  }];

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: systemInstruction + "\n" + userPrompt }] }],
        tools: tools,
        tool_config: { function_calling_config: { mode: "ANY" } }, 
      }),
    });

    const data = await response.json();
    const call = data.candidates?.[0]?.content?.parts?.find((p: any) => p.functionCall);
    
    if (!call) return { fixedOp: null, reason: "AI format error", score: 0 };

    const args = call.functionCall.args;
    
    // Strict Filtering Logic
    if (!args.can_fix) return { fixedOp: null, reason: args.explanation || "No match found.", score: 0 };
    
    // Enforce the Confidence Threshold
    if (args.confidence_score < 60) return { fixedOp: null, reason: `Low confidence match (${args.confidence_score}%) - Rejected.`, score: args.confidence_score };

    // Construct the "Fixed" Operation
    const newOp = { ...failedOp, is_ai_fix: true };

    if (args.start_line && args.end_line) {
        newOp.ai_strategy = "range_replace";
        newOp.start_line = args.start_line;
        newOp.end_line = args.end_line;
    } 
    else if (args.anchor_line) {
        newOp.ai_strategy = "line_insert";
        newOp.anchor_line = args.anchor_line;
    }
    else if (args.new_anchor_text) {
        newOp.anchor = args.new_anchor_text;
    }

    return { fixedOp: newOp, reason: args.explanation, score: args.confidence_score };

  } catch (e) {
    return { fixedOp: null, reason: `AI Error: ${e.message}`, score: 0 };
  }
}

// ------------------------------------------------------------------
// 3. PATCHER EXECUTION ENGINE
// ------------------------------------------------------------------

function applyOperation(content: string, op: any) {
  const lines = content.split("\n");
  let newContent = content;

  try {
    // --- STRATEGY A: AI-DRIVEN (High Priority) ---
    if (op.is_ai_fix) {
        // AI Strategy: Range Replacement
        if (op.ai_strategy === "range_replace" && op.start_line && op.end_line) {
            const s = op.start_line - 1;
            const deleteCount = (op.end_line - op.start_line) + 1;
            
            // Safety Check
            if (s < 0 || s >= lines.length) throw new Error(`AI suggested Out of Bounds start: ${op.start_line}`);
            
            lines.splice(s, deleteCount, op.replace_with || op.content || "");
            return { newContent: lines.join("\n"), success: true, score: 95, message: `✨ AI: ${op.explanation || "Fixed range"}` };
        }

        // AI Strategy: Anchor Insertion
        if (op.ai_strategy === "line_insert" && op.anchor_line) {
            const idx = op.anchor_line - 1;
            
            // Safety Check
            if (idx < 0 || idx >= lines.length) throw new Error(`AI suggested Out of Bounds anchor: ${op.anchor_line}`);
            
            const payload = op.content || "";
            if (op.action === "insert_after") lines.splice(idx + 1, 0, payload);
            else if (op.action === "insert_before") lines.splice(idx, 0, payload);
            
            return { newContent: lines.join("\n"), success: true, score: 95, message: `✨ AI: ${op.explanation || "Fixed anchor"}` };
        }
    }

    // --- STRATEGY B: STANDARD OPERATIONS (Exact & Regex) ---
    switch (op.action) {
      case "replace_block":
        if (!op.find_block) return { newContent, success: false, score: 0, message: "Missing find_block" };
        if (content.includes(op.find_block)) {
            return { newContent: content.replace(op.find_block, op.replace_with || ""), success: true, score: 100, message: "Exact match" };
        }
        const cleanBlock = escapeRegExp(op.find_block).replace(/\\s+/g, '\\s+');
        const regex = new RegExp(cleanBlock);
        if (regex.test(content)) {
            return { newContent: content.replace(regex, op.replace_with || ""), success: true, score: 90, message: "Fuzzy regex match" };
        }
        return { newContent, success: false, score: 0, message: "Block not found" };

      case "insert_after":
        if(content.includes(op.anchor)) {
            return { newContent: content.replace(op.anchor, `${op.anchor}\n${op.content}`), success: true, score: 100, message: "Inserted after" };
        }
        return { newContent, success: false, score: 0, message: "Anchor not found" };

      case "insert_before":
        if(content.includes(op.anchor)) {
            return { newContent: content.replace(op.anchor, `${op.content}\n${op.anchor}`), success: true, score: 100, message: "Inserted before" };
        }
        return { newContent, success: false, score: 0, message: "Anchor not found" };

      case "replace_between_anchors":
        const s = content.indexOf(op.start_anchor); 
        const e = content.indexOf(op.end_anchor);
        if(s > -1 && e > -1 && e > s) {
             const pre = content.substring(0, s + op.start_anchor.length);
             const post = content.substring(e);
             return { newContent: pre + "\n" + op.content + "\n" + post, success: true, score: 100, message: "Range replaced" };
        }
        return { newContent, success: false, score: 0, message: "Anchors not found" };

      case "create_file": 
        return { newContent: op.content || "", success: true, score: 100, message: "Created" };

      default: 
        return { newContent, success: false, score: 0, message: "Unknown action" };
    }
  } catch(e:any) { 
      return { newContent, success: false, score: 0, message: `Err: ${e.message}` }; 
  }
}

// --- MAIN REQUEST HANDLER ---
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { action, operations, file_path, ref_sha, version_name, repo_name, code_block, error_message, ...payload } = await req.json();
    const TARGET_REPO = repo_name || DEFAULT_REPO;

    // --- 1. UTILS & INIT ---
    if (action === "init") {
        const { data: history } = await supabase.from('conduit_history').select('*').eq('repo_name', TARGET_REPO).order('created_at', { ascending: false }).limit(50);
        const { data: logs } = await supabase.from('conduit_logs').select('*').eq('repo_name', TARGET_REPO).order('created_at', { ascending: false }).limit(20);
        
        const requestedScope = payload.project_path || "";
        const filteredHistory = (history || []).filter((h: any) => isRecordInScope(h, requestedScope));
        const filteredLogs = (logs || []).filter((l: any) => isRecordInScope(l, requestedScope));

        return new Response(JSON.stringify({ history: filteredHistory, logs: filteredLogs }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // --- 2. AUTO-FIX SYNTAX ENDPOINT ---
    if (action === "fix_syntax") {
        if (!code_block || !error_message) throw new Error("Missing code_block or error_message");
        
        const result = await repairSyntaxWithAI(code_block, error_message);
        return new Response(JSON.stringify({ 
            success: !!result.fixed_code, 
            fixed_code: result.fixed_code, 
            explanation: result.explanation 
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // --- 3. REPO OPERATIONS ---
    await ensureBranchExists(TARGET_REPO);

    if (action === "fetch_project_bundle") {
      const tree = await githubFetch(TARGET_REPO, `/git/trees/${ref_sha || DEV_BRANCH}?recursive=1`);
      const scopePath = payload.project_path || "";
      const files = tree.tree.filter((f: any) => f.type === "blob" && f.path.startsWith(scopePath));

      const batchSize = 10;
      const fileData: Record<string, any> = {};

      for (let i = 0; i < files.length; i += batchSize) {
          const batch = files.slice(i, i + batchSize);
          await Promise.all(batch.map(async (f: any) => {
              try {
                  const { content } = await getFileRaw(TARGET_REPO, f.path, ref_sha || DEV_BRANCH);
                  fileData[f.path] = { content, sha: f.sha };
              } catch (e) { console.error(`Failed to bundle ${f.path}`); }
          }));
      }

      return new Response(JSON.stringify({ files: fileData }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "fetch") {
      const tree = await githubFetch(TARGET_REPO, `/git/trees/${DEV_BRANCH}?recursive=1`);
      const files = tree.tree.filter((f: any) => f.type === "blob");
      return new Response(JSON.stringify({ files }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "preview_file") {
        const { content, sha } = await getFileRaw(TARGET_REPO, file_path || 'index.html', ref_sha || DEV_BRANCH);
        return new Response(JSON.stringify({ content, sha }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "rollback") {
        if(!ref_sha) throw new Error("Target SHA required");
        await githubFetch(TARGET_REPO, `/git/refs/heads/${DEV_BRANCH}`, { method: "PATCH", body: JSON.stringify({ sha: ref_sha, force: true }) });
        await supabase.from('conduit_logs').insert({ repo_name: TARGET_REPO, type: 'rollback', data: { message: `Rolled back to ${ref_sha.substring(0,7)}` } });
        return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // --- 4. CI/CD & WORKFLOWS ---
    if (action === "trigger_build") {
        await dispatchWorkflow(TARGET_REPO, "conduit_build_trigger", { 
            version: version_name || "latest",
            source: "conduit-ide"
        });
        
        await supabase.from('conduit_logs').insert({ 
            repo_name: TARGET_REPO, type: 'dispatch', data: { message: "Workflow triggered manually" } 
        });
        
        return new Response(JSON.stringify({ success: true, message: "Build triggered" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "fetch_workflows") {
      const data = await githubFetch(TARGET_REPO, `/actions/runs?per_page=20`);
      return new Response(JSON.stringify({ runs: data.workflow_runs }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "fetch_workflow_jobs") {
      if(!payload.run_id) throw new Error("Missing run_id");
      const data = await githubFetch(TARGET_REPO, `/actions/runs/${payload.run_id}/jobs`);
      return new Response(JSON.stringify({ jobs: data.jobs }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "fetch_job_logs") {
      if(!payload.job_id) throw new Error("Missing job_id");
      const url = `https://api.github.com/repos/${GITHUB_USER}/${TARGET_REPO}/actions/jobs/${payload.job_id}/logs`;
      const res = await fetch(url, { headers: { ...getHeaders() }, redirect: "follow" });
      if(!res.ok) throw new Error(`Log fetch failed: ${res.status} ${res.statusText}`);
      const text = await res.text();
      return new Response(JSON.stringify({ logs: text }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }


        // --- AI OPERATION GENERATOR ---
    if (action === "generate_ops") {
        const { user_prompt, context_files } = payload;
        if (!user_prompt) throw new Error("Prompt required");

        const apiKey = await getGeminiKey();
        if (!apiKey) throw new Error("No AI Key");

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

        const fileContext = context_files.map((f: any) => 
            `FILE: ${f.path}\nCONTENT:\n${f.content ? base64ToText(f.content).substring(0, 3000) : "(Content omitted)"}\n`
        ).join("\n---\n");

        const systemPrompt = `
You are a JSON Patch Generator for a specific IDE engine.
Your goal: Convert the user's Natural Language Request into a JSON Array of Operations.

**AVAILABLE OPERATIONS:**
1. { "file_path": "path/to/file.ext", "action": "replace_block", "find_block": "exact code to replace", "replace_with": "new code" }
2. { "file_path": "...", "action": "insert_after", "anchor": "exact line to insert after", "content": "new code" }
3. { "file_path": "...", "action": "create_file", "content": "full content" }
4. { "file_path": "...", "action": "delete_file" }

**RULES:**
- Return ONLY the raw JSON array. No markdown, no explanations.
- "find_block" and "anchor" must be UNIQUE strings found in the file context.
- Do not use regex. Use exact string matching.
- If the user asks to edit a file not provided in context, guess the path but warn in a comment field.
`;

        const finalPrompt = `
${systemPrompt}

=== CONTEXT FILES ===
${fileContext}

=== USER REQUEST ===
${user_prompt}
`;

        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ role: "user", parts: [{ text: finalPrompt }] }]
            })
        });

        const data = await res.json();
        let rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
        rawText = rawText.replace(/```json/g, "").replace(/```/g, "").trim();

        return new Response(JSON.stringify({ operations: rawText }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // --- CI/CD LOG ANALYZER ---
    if (action === "analyze_log") {
      const { job_id } = payload;
      if (!job_id) throw new Error("Missing job_id");
      
      // 1. Fetch Logs
      const logUrl = `https://api.github.com/repos/${GITHUB_USER}/${TARGET_REPO}/actions/jobs/${job_id}/logs`;
      const logRes = await fetch(logUrl, { headers: { ...getHeaders() }, redirect: "follow" });
      if(!logRes.ok) throw new Error("Log fetch failed");
      const logs = await logRes.text();

      // 2. Prep AI (Truncate to last 20k chars to capture error context)
      const apiKey = await getGeminiKey();
      if (!apiKey) throw new Error("No AI Key");
      
      const snippet = logs.length > 20000 ? logs.slice(-20000) : logs;

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
      const prompt = `
Analyze this GitHub Action Failure Log.

LOG SNIPPET:
${snippet}

TASK:
Extract ONLY the specific error message and the exact file/line number causing it.
Do not explain "why" or "how to fix".
Do not add markdown headers like "## Analysis".

OUTPUT FORMAT:
**Error:** <The specific error message>
**Location:** <File path>:<Line number>
`;

      const aiRes = await fetch(url, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }] })
      });
      const aiData = await aiRes.json();
      const analysis = aiData.candidates?.[0]?.content?.parts?.[0]?.text || "Could not analyze logs.";

      return new Response(JSON.stringify({ analysis }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

// --- 5. THE INTELLIGENT PATCHER ---
    if (action === "patch" && operations) {
      const scopePath = payload.project_path || "";
      if (scopePath) {
          const invalidOps = operations.filter((op: any) => !op.file_path.startsWith(scopePath));
          if (invalidOps.length > 0) throw new Error(`Security: Operation on ${invalidOps[0].file_path} is outside project scope '${scopePath}'`);
      }

      const fileResults: any[] = [];
      const opsByFile: Record<string, any[]> = {};
      
      operations.forEach((op: any) => {
        if (!opsByFile[op.file_path]) opsByFile[op.file_path] = [];
        opsByFile[op.file_path].push(op);
      });

      let lastCommitSha = "";
      
      for (const filePath of Object.keys(opsByFile)) {
        const fileOps = opsByFile[filePath];
        let { content, sha } = await getFileRaw(TARGET_REPO, filePath, DEV_BRANCH);
        let currentContent = base64ToText(content);
        
        const opLogs = [];
        let anyChange = false;

        for (const op of fileOps) {
             // [NEW] Handle File Deletion
            if (op.action === "delete_file") {
                if (!sha) {
                     opLogs.push({ type: "delete_file", success: true, score: 100, message: "File not found (already deleted)" });
                } else {
                     try {
                        const delSha = await deleteFile(TARGET_REPO, filePath, sha, DEV_BRANCH, `Conduit: Delete ${filePath}`);
                        lastCommitSha = delSha;
                        opLogs.push({ type: "delete_file", success: true, score: 100, message: "Deleted successfully" });
                     } catch(e: any) {
                        opLogs.push({ type: "delete_file", success: false, score: 0, message: `Delete failed: ${e.message}` });
                     }
                }
                anyChange = false; 
                currentContent = ""; 
                sha = ""; 
                break; // Stop processing other ops for this file as it is deleted
            }

            let result;
            if (op.action === "create_file") { 
                result = applyOperation("", op); 
                sha = ""; 
            } else { 
                result = applyOperation(currentContent, op); 
            }

            // AI SELF-HEALING FALLBACK
            if (!result.success && op.action !== "create_file") {
                const { fixedOp, reason, score } = await consultAI(currentContent, op, result.message);
                
                if (fixedOp) {
                    fixedOp.explanation = reason; 
                    const retryResult = applyOperation(currentContent, fixedOp);
                    
                    if (retryResult.success) {
                        currentContent = retryResult.newContent;
                        anyChange = true;
                        opLogs.push({ 
                            type: op.action, 
                            success: true, 
                            score: score, 
                            message: retryResult.message,
                            ...fixedOp 
                        });
                        continue; 
                    } else {
                        opLogs.push({ type: op.action, success: false, score: 0, message: `AI Fix Failed: ${retryResult.message}` });
                    }
                } else {
                    opLogs.push({ type: op.action, success: false, score: score, message: `${result.message} (AI: ${reason})` });
                }
            } else {
                if (result.success) {
                    currentContent = result.newContent;
                    anyChange = true;
                }
                opLogs.push({ type: op.action, success: result.success, score: result.score, message: result.message, ...op });
            }
        }

        if (anyChange) {
            lastCommitSha = await updateFile(TARGET_REPO, filePath, currentContent, sha, DEV_BRANCH, `Conduit: ${fileOps.length} ops`);
        }
        
        fileResults.push({ file: filePath, status: anyChange ? "updated" : (fileOps.some(o => o.action === 'delete_file') ? "deleted" : "failed"), operations: opLogs });
      }

      const logData = { success: true, commit_sha: lastCommitSha, results: fileResults };

      if (lastCommitSha) {
          await supabase.from('conduit_history').insert({ 
              repo_name: TARGET_REPO, title: "Patch Applied", type: "Dev", 
              meta: `${operations.length} ops`, ops: operations, sha: lastCommitSha 
          });
      }
      await supabase.from('conduit_logs').insert({ repo_name: TARGET_REPO, type: 'patch', data: logData });

      return new Response(JSON.stringify(logData), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "commit_prod") {
        if (!version_name) throw new Error("Version name required");
        
        const scopePath = payload.project_path || "";
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
        await supabase.from('conduit_history').insert({ 
            repo_name: TARGET_REPO, title: `Deployed ${version_name}`, type: "Prod", 
            meta: `Snapshot of ${copiedCount} files`, sha: mainRef.object.sha 
        });
        const logData = { success: true, count: copiedCount, message: `Deployed ${version_name}` };
        await supabase.from('conduit_logs').insert({ repo_name: TARGET_REPO, type: 'commit_prod', data: logData });
        
        return new Response(JSON.stringify(logData), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "update_note") {
        await supabase.from('conduit_history').update({ note: payload.note }).eq('id', payload.id);
        return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "delete_history") {
         await supabase.from('conduit_history').delete().eq('id', payload.id);
         return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response("Invalid Action", { status: 400, headers: corsHeaders });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
