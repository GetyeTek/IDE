import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// --- CONFIGURATION ---
const GITHUB_USER = "GetyeTek"; 
const DEFAULT_REPO = "IDE"; 
const MAIN_BRANCH = "main";
const DEV_BRANCH = "conduit-dev";
// Using DeepSeek V3 via OpenRouter
const AI_MODEL = "deepseek/deepseek-chat"; 
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

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
  const url = `https://api.github.com/repos/${GITHUB_USER}/${repo}${path}`;
  const res = await fetch(url, { ...options, headers: { ...getHeaders(), ...options.headers } });
  
  if (!res.ok) {
      if(res.status === 404) throw new Error("Not Found"); 
      throw new Error(`GitHub API Error ${res.status}: ${await res.text()}`);
  }
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
  console.log(`[GitHub Dispatch] Target: ${workflowId}, Ref: ${ref}, Inputs:`, JSON.stringify(inputs));
  const res = await githubFetch(repo, `/actions/workflows/${workflowId}/dispatches`, {
    method: "POST",
    body: JSON.stringify({ ref: ref, inputs: inputs }),
  });
  console.log(`[GitHub Dispatch] Result for ${workflowId}:`, JSON.stringify(res));
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

async function getAIKey(): Promise<string | null> {
  // Directly fetch the user-set secret for OpenRouter/DeepSeek
  return Deno.env.get("Deepseek_API") || null;
}

// 1. Syntax Repair
async function repairSyntaxWithAI(codeBlock: string, errorMessage: string): Promise<{ fixed_code: string | null; explanation: string }> {
    console.log("--- AI REPAIR SYNTAX START ---");
    const apiKey = await getAIKey();
    if (!apiKey) return { fixed_code: null, explanation: "No AI API Key" };
    
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
        const response = await fetch(OPENROUTER_URL, { 
            method: "POST", 
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` }, 
            body: JSON.stringify({ 
                model: AI_MODEL,
                messages: [
                    { role: "system", content: systemInstruction },
                    { role: "user", content: "Code:\n" + codeBlock + "\nError:\n" + errorMessage }
                ],
                tools: tools,
                tool_choice: "auto"
            }) 
        });
        
        const data = await response.json();
        console.log("[SyntaxRepair] Response:", JSON.stringify(data));
        
        const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
        if (toolCall && toolCall.function.name === "provide_fixed_code") {
             const args = JSON.parse(toolCall.function.arguments);
             return { fixed_code: args.fixed_code, explanation: args.explanation };
        }
        return { fixed_code: null, explanation: "AI failed to call tool." };
    } catch (e: any) { console.error("[SyntaxRepair] Error:", e); return { fixed_code: null, explanation: e.message }; }
}

// 2. Self-Healing (Healer)
async function consultAI(fileContent: string, failedOp: any, failReason: string): Promise<{ fixedOp: any | null; reason: string; score: number }> {
  console.log(`--- CONSULT AI (HEALER) START for ${failedOp?.action} ---`);
  const apiKey = await getAIKey();
  if (!apiKey) return { fixedOp: null, reason: "No AI keys.", score: 0 };
  
  const systemInstruction = `You are the Conduit Self-Healing Patch Engine. 
  A patch operation failed to find its target code in the file.
  Your job: Look at the FILE CONTENT and the FAILED OP. Find where the semantic intent of the op belongs.
  
  RULES:
  1. If whitespace differs slightly, match it and update the op.
  2. If the variable names changed but logic is identical, match it.
  3. If you find the match, output 'can_fix: true' and the NEW coordinates/anchor.
  4. If the code is missing or completely rewritten, output 'can_fix: false'.
  5. Use 'suggest_fix' tool only.`;

  const tools = [{ 
    type: "function",
    function: { 
        name: "suggest_fix", 
        description: "Return corrected patch params", 
        parameters: { 
            type: "object", 
            properties: { 
                can_fix: { type: "boolean" }, 
                confidence_score: { type: "integer" }, 
                explanation: { type: "string" }, 
                start_line: { type: "integer" }, 
                end_line: { type: "integer" }, 
                anchor_line: { type: "integer" }, 
                new_anchor_text: { type: "string" } 
            }, 
            required: ["can_fix", "explanation", "confidence_score"] 
        } 
    } 
  }];

  try {
    const userPrompt = "File:\n" + getNumberedContent(fileContent) + "\nOp:\n" + JSON.stringify(failedOp) + "\nError:\n" + failReason;
    console.log("[Healer] Prompt Sent (Excluding File):", systemInstruction + "\nOp: " + JSON.stringify(failedOp) + "\nReason: " + failReason);
    
    const res = await fetch(OPENROUTER_URL, { 
        method: "POST", 
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` }, 
        body: JSON.stringify({ 
            model: AI_MODEL,
            messages: [
                { role: "system", content: systemInstruction },
                { role: "user", content: userPrompt }
            ],
            tools: tools,
            tool_choice: "auto"
        }) 
    });

    const data = await res.json();
    console.log("[Healer] Response:", JSON.stringify(data));
    
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall || toolCall.function.name !== "suggest_fix") return { fixedOp: null, reason: "No match", score: 0 };
    
    const args = JSON.parse(toolCall.function.arguments);
    if (!args || !args.can_fix || args.confidence_score < 60) return { fixedOp: null, reason: args?.explanation || "No match", score: args?.confidence_score || 0 };
    
    const newOp = { ...failedOp, is_ai_fix: true };
    if (args.start_line && args.end_line) { newOp.ai_strategy = "range_replace"; newOp.start_line = args.start_line; newOp.end_line = args.end_line; } 
    else if (args.anchor_line) { newOp.ai_strategy = "line_insert"; newOp.anchor_line = args.anchor_line; }
    else if (args.new_anchor_text) { newOp.anchor = args.new_anchor_text; }
    return { fixedOp: newOp, reason: args.explanation, score: args.confidence_score };
  } catch (e: any) { console.error("[Healer] Error:", e); return { fixedOp: null, reason: e.message, score: 0 }; }
}

// 3. Code Sanity Checker (Context-Aware)
async function checkCodeSanity(code: string, op: any): Promise<{ sane: boolean; issues: string }> {
    console.log("--- SANITY CHECK START ---");
    const apiKey = await getAIKey();
    if (!apiKey) return { sane: true, issues: "" };
    
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
        const res = await fetch(OPENROUTER_URL, { 
            method: "POST", 
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` }, 
            body: JSON.stringify({ 
                model: AI_MODEL,
                messages: [{ role: "user", content: prompt }],
                response_format: { type: "json_object" }
            }) 
        });
        const data = await res.json();
        console.log("[Sanity] Response:", JSON.stringify(data));
        const text = data.choices?.[0]?.message?.content || "{}";
        const json = JSON.parse(text);
        return { sane: !!json.sane, issues: json.issues || "" };
    } catch (e) { console.error("[Sanity] Error:", e); return { sane: true, issues: "" }; }
}

// 4. STEP A: DETECTIVE (Analyze Logs & Identify Files)
async function analyzeLogsAndIdentifyFiles(logText: string): Promise<{ summary: string, files: string[] }> {
    console.log("--- ANALYZE LOGS START (GEMINI FLASH-LITE) ---");
    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiKey) return { summary: "No GEMINI_API_KEY found", files: [] };

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
        console.log(`[Detective] Sending Log Analysis Prompt to Gemini...`);

        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent?key=${geminiKey}`, { 
            method: "POST", 
            headers: { "Content-Type": "application/json" }, 
            body: JSON.stringify({ 
                contents: [{ parts: [{ text: prompt }] }]
            }) 
        });
        
        const data = await res.json();
        console.log("[Detective] Response:", JSON.stringify(data));
        const rawOutput = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

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
async function generateFixFromFullContext(summary: string, contextFiles: any[], changeContext: string): Promise<string> {
    console.log("--- GENERATE FIX (SURGEON) START ---");
    const apiKey = await getAIKey();
    if (!apiKey) return "[]";
    
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

        const res = await fetch(OPENROUTER_URL, { 
            method: "POST", 
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` }, 
            body: JSON.stringify({ 
                model: AI_MODEL,
                messages: [{ role: "user", content: prompt }]
            }) 
        });
        const data = await res.json();
        console.log("[Surgeon] Response:", JSON.stringify(data));
        
        const text = data.choices?.[0]?.message?.content || "[]";
        
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
function applyOperation(content: string, op: any) {
  const lines = content.split("\n");
  let newContent = content;

  try {
    if (op.is_ai_fix) {
        if (op.ai_strategy === "range_replace" && op.start_line && op.end_line) {
            lines.splice(op.start_line - 1, (op.end_line - op.start_line) + 1, op.replace_with || op.content || "");
            return { newContent: lines.join("\n"), success: true, score: 95, message: `✨ AI: ${op.explanation}` };
        }
        if (op.ai_strategy === "line_insert" && op.anchor_line) {
            const idx = op.anchor_line - 1;
            const payload = op.content || "";
            if (op.action === "insert_after") lines.splice(idx + 1, 0, payload);
            else if (op.action === "insert_before") lines.splice(idx, 0, payload);
            return { newContent: lines.join("\n"), success: true, score: 95, message: `✨ AI: ${op.explanation}` };
        }
    }

    switch (op.action) {
      case "replace_block":
        if (!op.find_block) return { newContent, success: false, score: 0, message: "Missing find_block" };
        if (content.includes(op.find_block)) return { newContent: content.replace(op.find_block, op.replace_with || ""), success: true, score: 100, message: "Exact match" };
        const regex = new RegExp(escapeRegExp(op.find_block).replace(/\\s+/g, '\\s+'));
        if (regex.test(content)) return { newContent: content.replace(regex, op.replace_with || ""), success: true, score: 90, message: "Fuzzy regex match" };
        return { newContent, success: false, score: 0, message: "Block not found" };
      case "insert_after":
        if(content.includes(op.anchor)) return { newContent: content.replace(op.anchor, `${op.anchor}\n${op.content}`), success: true, score: 100, message: "Inserted after" };
        return { newContent, success: false, score: 0, message: "Anchor not found" };
      case "insert_before":
        if(content.includes(op.anchor)) return { newContent: content.replace(op.anchor, `${op.content}\n${op.anchor}`), success: true, score: 100, message: "Inserted before" };
        return { newContent, success: false, score: 0, message: "Anchor not found" };
      case "replace_between_anchors":
        const s = content.indexOf(op.start_anchor), e = content.indexOf(op.end_anchor);
        if(s > -1 && e > -1 && e > s) {
             const pre = content.substring(0, s + op.start_anchor.length), post = content.substring(e);
             return { newContent: pre + "\n" + op.content + "\n" + post, success: true, score: 100, message: "Range replaced" };
        }
        return { newContent, success: false, score: 0, message: "Anchors not found" };
      case "create_file": return { newContent: op.content || "", success: true, score: 100, message: "Created" };
      default: return { newContent, success: false, score: 0, message: "Unknown action" };
    }
  } catch(e:any) { return { newContent, success: false, score: 0, message: `Err: ${e.message}` }; }
}

// --- CORE PROCESSING LOGIC ---
async function processOperations(TARGET_REPO: string, operations: any[], projectPath: string, autoSanity: boolean) {
    const scopePath = projectPath || "";
    if (scopePath) {
        const invalidOps = operations.filter((op: any) => op.file_path && !op.file_path.startsWith(scopePath));
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
        const fileOps = opsByFile[filePath];
        let { content, sha } = await getFileRaw(TARGET_REPO, filePath, DEV_BRANCH);
        let currentContent = base64ToText(content);
        const opLogs = [];
        let anyChange = false;

        for (const op of fileOps) {
            if (op.action === "delete_file") {
                if (!sha) { opLogs.push({ type: "delete_file", success: true, score: 100, message: "File not found" }); }
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
                const { fixedOp, reason, score } = await consultAI(currentContent, op, result.message);
                if (fixedOp) {
                    fixedOp.explanation = reason; 
                    let retryResult = applyOperation(currentContent, fixedOp);
                    
                    // --- SANITY CHECK LOOP ---
                    if (retryResult.success && autoSanity) {
                         // Pass fixedOp so AI knows exactly what changed
                         const sanity = await checkCodeSanity(retryResult.newContent, fixedOp);
                         
                         if (!sanity.sane) {
                             opLogs.push({ type: "sanity_check", success: false, message: `Sanity Failed: ${sanity.issues}` });
                             const { fixedOp: sanityOp, reason: sanityReason } = await consultAI(currentContent, fixedOp, `The operation ${JSON.stringify(fixedOp)} caused this syntax error: ${sanity.issues}`);
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
                    anyOpFailed = true;
                    opLogs.push({ type: op.action, success: false, score: score, message: `${result.message} (AI: ${reason})` });
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


// --- MAIN REQUEST HANDLER ---
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { action, operations, file_path, ref_sha, version_name, repo_name, code_block, error_message, messages, context_files, auto_sanity, workflow_id, branch, inputs, ...payload } = await req.json();
    const TARGET_REPO = repo_name || DEFAULT_REPO;
    await ensureBranchExists(TARGET_REPO);

    // 1. INIT
    if (action === "init") {
        const scope = payload.project_path || "";
        const { data: history } = await supabase.from('conduit_history').select('*, conduit_id').eq('repo_name', TARGET_REPO).order('conduit_id', { ascending: false }).limit(50);
        const { data: logs } = await supabase.from('conduit_logs').select('*').eq('repo_name', TARGET_REPO).order('created_at', { ascending: false }).limit(50);
        return new Response(JSON.stringify({ history: (history || []).filter((h:any)=>isRecordInScope(h, scope)), logs: (logs || []).filter((l:any)=>isRecordInScope(l, scope)) }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 2. AI CHAT
    if (action === "ai_chat") {
        const apiKey = await getAIKey();
        if (!apiKey) throw new Error("No AI Key");
        
        const ctx = context_files && context_files.length > 0 ? context_files.map((f: any) => `FILE: ${f.path}\nCONTENT:\n${f.content ? base64ToText(f.content).substring(0, 5000) : "(omitted)"}\n`).join("\n---\n") : "No files selected.";
        const sysPrompt = `You are "Conduit", an AI coding assistant. If user needs code changes, output a JSON Array in \`\`\`json [ ... ] \`\`\`. Rules: "find_block" must be EXACT. "comment" op is allowed first.`;
        
        const openAIMessages = messages.map((m: any) => ({
            role: m.role === 'model' ? 'assistant' : 'user',
            content: m.text
        }));

        // Inject System Prompt and Context into the last message or as a system message
        const lastMsg = openAIMessages[openAIMessages.length - 1];
        if (lastMsg) lastMsg.content = `${sysPrompt}\n\n=== CONTEXT ===\n${ctx}\n\n=== USER ===\n${lastMsg.content}`;

        const res = await fetch(OPENROUTER_URL, { 
            method: "POST", 
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` }, 
            body: JSON.stringify({ 
                model: AI_MODEL,
                messages: openAIMessages 
            }) 
        });
        const data = await res.json();
        return new Response(JSON.stringify({ reply: data.choices?.[0]?.message?.content || "Error" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // --- REFINED GENERATE OPS (PROMPT UPGRADE) ---
    if (action === "generate_ops") {
        const { user_prompt, context_files } = payload;
        if (!user_prompt) throw new Error("Prompt required");
        const apiKey = await getAIKey();
        if (!apiKey) throw new Error("No AI Key");
        
        const fileContext = context_files.map((f: any) => 
            `FILE: ${f.path}\nCONTENT:\n${f.content ? base64ToText(f.content).substring(0, 3000) : "(Content omitted)"}\n`
        ).join("\n---\n");

        const systemPrompt = `You are a Strict JSON Patch Generator.
        Your goal: Convert User Request into a valid JSON Operations Array.
        
        ALLOWED OPERATIONS & SCHEMA:
        1. REPLACE: { "file_path": "string", "action": "replace_block", "find_block": "EXACT_CODE_MATCH", "replace_with": "NEW_CODE" }
        2. INSERT AFTER: { "file_path": "string", "action": "insert_after", "anchor": "EXACT_UNIQUE_LINE", "content": "NEW_CODE" }
        3. CREATE: { "file_path": "string", "action": "create_file", "content": "FULL_CONTENT" }
        4. DELETE: { "file_path": "string", "action": "delete_file" }
        5. COMMENT: { "action": "comment", "text": "CONCISE_SUMMARY" } (Must be first, max 50 words)
        
        CRITICAL RULES:
        - Output ONLY valid JSON.
        - 'find_block' and 'anchor' must exist EXACTLY in the provided context (whitespace/indentation matters).
        - Do not use regex or placeholders like '// ... rest of code'.
        - If the file context is missing, do not hallucinate content.
        `;

        const finalPrompt = `${systemPrompt}\n=== CONTEXT ===\n${fileContext}\n=== REQUEST ===\n${user_prompt}`;
        const res = await fetch(OPENROUTER_URL, { 
            method: "POST", 
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` }, 
            body: JSON.stringify({ 
                model: AI_MODEL,
                messages: [{ role: "user", content: finalPrompt }]
            }) 
        });
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content || "[]";
        
        // Robust extraction
        let rawText = "[]";
        const match = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/```\s*([\s\S]*?)\s*```/);
        if (match) {
            rawText = match[1].trim();
        } else {
            const start = text.indexOf('[');
            const end = text.lastIndexOf(']');
            if (start !== -1 && end !== -1 && end > start) {
                rawText = text.substring(start, end + 1);
            }
        }
        
        return new Response(JSON.stringify({ operations: rawText }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // --- AUTO FIX BUILD (UPDATED LOGIC) ---
    if (action === "auto_fix_build") {
        if (!payload.run_id) throw new Error("run_id required");

        // 1. Get Log Text
        const jobsData = await githubFetch(TARGET_REPO, `/actions/runs/${payload.run_id}/jobs`);
        const failedJob = jobsData.jobs.find((j: any) => j.conclusion === "failure");
        if (!failedJob) return new Response(JSON.stringify({ success: false, message: "No failed job found." }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

        // Get the commit SHA that triggered the failed run
        const runData = jobsData.workflow_runs?.find((r:any) => r.id === payload.run_id) || jobsData.workflow_runs?.[0]; // Fallback
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
        const { summary, files } = await analyzeLogsAndIdentifyFiles(logText);
        
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
        const opsJson = await generateFixFromFullContext(summary, contextPayload, changeContext);
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
        const patchResult = await processOperations(TARGET_REPO, ops, "", true);

        // 6. Trigger Re-Build (Explicitly required for bot commits)
        let triggerMsg = "No trigger attempted";
        if (patchResult.success) {
             try {
                 // Fetch the run info to get the specific workflow ID
                 const runInfo = await githubFetch(TARGET_REPO, `/actions/runs/${payload.run_id}`);
                 if (runInfo.workflow_id) {
                     await triggerWorkflowFile(TARGET_REPO, String(runInfo.workflow_id), DEV_BRANCH);
                     triggerMsg = `Triggered workflow ${runInfo.workflow_id}`;
                 }
             } catch(e:any) { 
                 console.error("Auto-trigger failed:", e);
                 triggerMsg = `Trigger failed: ${e.message}`; 
             }
        }

        await supabase.from('conduit_logs').insert({ repo_name: TARGET_REPO, type: 'auto_fix_trigger', data: { run_id: payload.run_id, fix_applied: patchResult.success, ops, trigger: triggerMsg } });
        return new Response(JSON.stringify({ success: true, patch_result: patchResult, trigger_status: triggerMsg }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "patch" && operations) {
        const result = await processOperations(TARGET_REPO, operations, payload.project_path, !!auto_sanity);
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
      const batchSize = 10;
      for (let i = 0; i < files.length; i += batchSize) {
          await Promise.all(files.slice(i, i + batchSize).map(async (f: any) => {
              try { const { content } = await getFileRaw(TARGET_REPO, f.path, ref_sha || DEV_BRANCH); fileData[f.path] = { content, sha: f.sha }; } catch (e) {}
          }));
      }
      return new Response(JSON.stringify({ files: fileData }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "preview_file") {
        const { content, sha } = await getFileRaw(TARGET_REPO, file_path || 'index.html', ref_sha || DEV_BRANCH);
        return new Response(JSON.stringify({ content, sha }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "fix_syntax") {
        const result = await repairSyntaxWithAI(code_block, error_message);
        return new Response(JSON.stringify({ success: !!result.fixed_code, fixed_code: result.fixed_code, explanation: result.explanation }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "trigger_build") {
        // EXPENSIVE LOGGING: Capture intent before network call
        const safeInputs = inputs || {};
        const targetBranch = branch || DEV_BRANCH;
        const debugInfo = { 
            workflow_id, 
            branch: targetBranch, 
            inputs_received: safeInputs, 
            timestamp: new Date().toISOString() 
        };
        
        // 1. Log INTENT to DB (Debug Trace)
        await supabase.from('conduit_logs').insert({ 
            repo_name: TARGET_REPO, 
            type: 'dispatch_debug', 
            data: { step: 'attempt', ...debugInfo } 
        });

        try {
            if (workflow_id) {
                await triggerWorkflowFile(TARGET_REPO, workflow_id, targetBranch, safeInputs);
            } else {
                await dispatchWorkflow(TARGET_REPO, "conduit_build_trigger", { version: version_name || "latest", source: "conduit-ide" });
            }
            
            // 2. Log SUCCESS
            await supabase.from('conduit_logs').insert({ 
                repo_name: TARGET_REPO, 
                type: 'dispatch', 
                data: { success: true, message: `Triggered ${workflow_id || 'generic build'}`, debug: debugInfo } 
            });
            return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

        } catch (e: any) {
            // 3. Log FAILURE with specific GitHub response
            console.error("[Trigger Fail]", e);
            await supabase.from('conduit_logs').insert({ 
                repo_name: TARGET_REPO, 
                type: 'dispatch_error', 
                data: { 
                    success: false, 
                    workflow_id, 
                    error_msg: e.message, 
                    failed_payload: debugInfo 
                } 
            });
            throw e; // Re-throw so frontend sees 500
        }
    }

    if (action === "fetch_workflows") {
      const data = await githubFetch(TARGET_REPO, `/actions/runs?per_page=50`);
      return new Response(JSON.stringify({ runs: data.workflow_runs }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "fetch_workflow_jobs") {
      const data = await githubFetch(TARGET_REPO, `/actions/runs/${payload.run_id}/jobs`);
      return new Response(JSON.stringify({ jobs: data.jobs }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "analyze_log") {
      const { job_id } = payload;
      const { data: cached } = await supabase.from('conduit_logs').select('data').eq('type', 'job_analysis').eq('repo_name', TARGET_REPO).filter('data->>job_id', 'eq', String(job_id)).maybeSingle();
      if (cached) return new Response(JSON.stringify({ analysis: cached.data.analysis, cached: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      
      const logUrl = `https://api.github.com/repos/${GITHUB_USER}/${TARGET_REPO}/actions/jobs/${job_id}/logs`;
      const logRes = await fetch(logUrl, { headers: { ...getHeaders() }, redirect: "follow" });
      if(!logRes.ok) throw new Error("Log fetch failed");
      const logs = await logRes.text();
      
      const apiKey = await getAIKey();
      const prompt = `Analyze Log:\n${logs.slice(-20000)}\nOUTPUT: specific error, file/line, brief summary.`;
      
      const aiRes = await fetch(OPENROUTER_URL, { 
          method: "POST", 
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` }, 
          body: JSON.stringify({ 
              model: AI_MODEL,
              messages: [{ role: "user", content: prompt }]
          }) 
      });
      const aiData = await aiRes.json();
      const analysis = aiData.choices?.[0]?.message?.content || "Failed.";
      await supabase.from('conduit_logs').insert({ repo_name: TARGET_REPO, type: 'job_analysis', data: { job_id: String(job_id), analysis } });
      return new Response(JSON.stringify({ analysis }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "fetch_job_logs") {
      const url = `https://api.github.com/repos/${GITHUB_USER}/${TARGET_REPO}/actions/jobs/${payload.job_id}/logs`;
      const res = await fetch(url, { headers: { ...getHeaders() }, redirect: "follow" });
      return new Response(JSON.stringify({ logs: await res.text() }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "commit_prod") {
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
        const logData = { success: true, count: copiedCount, message: `Deployed ${version_name}` };
        await supabase.from('conduit_history').insert({ repo_name: TARGET_REPO, title: `Deployed ${version_name}`, type: "Prod", meta: `Snapshot ${copiedCount} files`, sha: mainRef.object.sha });
        await supabase.from('conduit_logs').insert({ repo_name: TARGET_REPO, type: 'commit_prod', data: logData });
        return new Response(JSON.stringify(logData), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    
    if (action === "rollback") {
        if(!ref_sha) throw new Error("Target SHA required");
        await githubFetch(TARGET_REPO, `/git/refs/heads/${DEV_BRANCH}`, { method: "PATCH", body: JSON.stringify({ sha: ref_sha, force: true }) });
        await supabase.from('conduit_logs').insert({ repo_name: TARGET_REPO, type: 'rollback', data: { message: `Rolled back to ${ref_sha.substring(0,7)}` } });
        return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (action === "update_note") { await supabase.from('conduit_history').update({ note: payload.note }).eq('id', payload.id); return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
    if (action === "delete_history") { await supabase.from('conduit_history').delete().eq('id', payload.id); return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
    if (action === "delete_log") { await supabase.from('conduit_logs').delete().eq('id', payload.id); return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
    if (action === "delete_run") { await githubFetch(TARGET_REPO, `/actions/runs/${payload.run_id}`, { method: "DELETE" }); return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } }); }

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
        const { chat_id, title } = payload; 
        // FIX: Defensively get messages from top-scope OR payload, ensure it's an array
        const chatMsgs = Array.isArray(messages) ? messages : (Array.isArray(payload.messages) ? payload.messages : []);
        
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