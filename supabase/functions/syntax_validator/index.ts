import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// --- 1. POLYFILLS & SETUP ---
if (typeof document === "undefined") {
  (globalThis as any).document = { currentScript: null };
}

// Dynamic Import of Tree Sitter (WASM based parser)
const Parser = (await import("https://esm.sh/web-tree-sitter@0.20.8?target=deno")).default;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

// --- 2. CONFIGURATION ---
const TREE_SITTER_WASM_URL = "https://cdn.jsdelivr.net/npm/web-tree-sitter@0.20.8/tree-sitter.wasm";
const BASE_GRAMMAR_URL = "https://cdn.jsdelivr.net/npm/tree-sitter-wasms@0.1.11/out";

// Extended Language Support Map
const GRAMMARS: Record<string, string> = {
  // JavaScript / TypeScript Ecosystem
  js: `${BASE_GRAMMAR_URL}/tree-sitter-javascript.wasm`,
  jsx: `${BASE_GRAMMAR_URL}/tree-sitter-javascript.wasm`, // JSX is usually handled by JS grammar or TSX
  javascript: `${BASE_GRAMMAR_URL}/tree-sitter-javascript.wasm`,
  ts: `${BASE_GRAMMAR_URL}/tree-sitter-typescript.wasm`,
  typescript: `${BASE_GRAMMAR_URL}/tree-sitter-typescript.wasm`,
  tsx: `${BASE_GRAMMAR_URL}/tree-sitter-tsx.wasm`,

  // Web Standard
  html: `${BASE_GRAMMAR_URL}/tree-sitter-html.wasm`,
  css: `${BASE_GRAMMAR_URL}/tree-sitter-css.wasm`,
  json: `${BASE_GRAMMAR_URL}/tree-sitter-json.wasm`,

  // Backend / Systems
  py: `${BASE_GRAMMAR_URL}/tree-sitter-python.wasm`,
  python: `${BASE_GRAMMAR_URL}/tree-sitter-python.wasm`,
  go: `${BASE_GRAMMAR_URL}/tree-sitter-go.wasm`,
  rs: `${BASE_GRAMMAR_URL}/tree-sitter-rust.wasm`,
  rust: `${BASE_GRAMMAR_URL}/tree-sitter-rust.wasm`,
  java: `${BASE_GRAMMAR_URL}/tree-sitter-java.wasm`,
  kt: `${BASE_GRAMMAR_URL}/tree-sitter-kotlin.wasm`,
  kotlin: `${BASE_GRAMMAR_URL}/tree-sitter-kotlin.wasm`,
  c: `${BASE_GRAMMAR_URL}/tree-sitter-c.wasm`,
  cpp: `${BASE_GRAMMAR_URL}/tree-sitter-cpp.wasm`,
  cc: `${BASE_GRAMMAR_URL}/tree-sitter-cpp.wasm`,
  bash: `${BASE_GRAMMAR_URL}/tree-sitter-bash.wasm`,
  sh: `${BASE_GRAMMAR_URL}/tree-sitter-bash.wasm`,
};

// --- 3. GLOBAL CACHE (Hot-Start Optimization) ---
// This persists in memory between invocations if the container stays warm.
const CACHE = {
    parserInitialized: false,
    grammars: new Map<string, Uint8Array>()
};

// --- 4. SERVER LOGIC ---
serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  // Initialize Logs
  const logs: string[] = [];
  const log = (msg: string) => { console.log(msg); logs.push(msg); };

  try {
    log(`[Start] Syntax Validator Request: ${req.method}`);

    // A. Parse Body safely
    let body;
    try {
        const text = await req.text();
        if (!text) throw new Error("Body is empty");
        body = JSON.parse(text);
    } catch (e: any) {
        log(`[Error] Body Parse: ${e.message}`);
        throw new Error("Invalid JSON body");
    }

    // B. Input Normalization
    // Support 'code' (standard) or 'code_block' (Conduit internal)
    const code = body.code !== undefined ? body.code : body.code_block;
    const filePath = body.file_path || "unknown.js";

    // C. Validation Guards
    if (typeof code !== 'string') {
        log("[Error] Code input is not a string.");
        return new Response(JSON.stringify({ 
            success: false, logs, error: "Input 'code' must be a string." 
        }), { headers: { ...CORS_HEADERS, "Content-Type": "application/json" }, status: 400 });
    }

    if (!code || code.trim().length === 0) {
        log("[Warning] Empty code received. Marking as invalid (prevent false pass).");
        return new Response(JSON.stringify({ 
            success: true, logs, 
            result: { valid: false, errors: [{ line: 1, column: 0, message: "Code is empty" }] } 
        }), { headers: { ...CORS_HEADERS, "Content-Type": "application/json" }, status: 200 });
    }

    // D. Extension Resolution
    const rawExt = filePath.toLowerCase().split('.').pop() || "";
    const ext = rawExt === 'jsx' ? 'js' : rawExt; // Map JSX to JS if specific JSX grammar not needed, but we have strict maps above.
    
    log(`[Processing] File: ${filePath} | Ext: .${ext} | Size: ${code.length} chars`);

    // E. Initialize Parser (Once per container lifecycle)
    if (!CACHE.parserInitialized) {
        log("[WASM] Initializing Global Parser...");
        await Parser.init({ locateFile: () => TREE_SITTER_WASM_URL });
        CACHE.parserInitialized = true;
    }

    const parser = new Parser();
    
    // F. Grammar Loading (With Cache)
    const grammarUrl = GRAMMARS[ext];

    if (!grammarUrl) {
        log(`[Skipped] No grammar support for .${ext}`);
        // Return valid=true for unsupported languages so we don't block the build
        return new Response(JSON.stringify({ 
            success: true, logs, 
            result: { valid: true, errors: [], warning: `Language .${ext} not supported for syntax check` } 
        }), { headers: { ...CORS_HEADERS, "Content-Type": "application/json" }, status: 200 });
    }

    let langBytes = CACHE.grammars.get(ext);
    if (langBytes) {
        log(`[Cache] HIT: Grammar for .${ext}`);
    } else {
        log(`[Cache] MISS: Fetching grammar from ${grammarUrl}`);
        const res = await fetch(grammarUrl);
        if (!res.ok) throw new Error(`Failed to fetch grammar: ${res.statusText}`);
        langBytes = new Uint8Array(await res.arrayBuffer());
        CACHE.grammars.set(ext, langBytes);
    }

    const lang = await Parser.Language.load(langBytes);
    parser.setLanguage(lang);

    // G. Parse & Analysis
    log("[Parser] analyzing...");
    const tree = parser.parse(code);
    const errors: any[] = [];
    
    // Recursive Error Finder
    const collectErrors = (node: any) => {
        if (!node) return;
        
        // Check for Error nodes or Missing nodes
        if (node.type === 'ERROR' || node.isMissing()) {
            const { row, column } = node.startPosition;
            
            // Extract snippet safely
            const start = node.startIndex;
            const end = Math.min(node.endIndex, start + 40); // 40 char preview
            const snippet = code.substring(start, end).replace(/\n/g, "\\n");
            
            let msg = "";
            if (node.isMissing()) {
                msg = `Missing syntax expected at line ${row + 1}`;
            } else {
                msg = `Unexpected token "${snippet}..." at line ${row + 1}`;
            }
                
            errors.push({
                line: row + 1,
                column: column,
                message: msg
            });
        }
        
        // Traverse children
        for (let i = 0; i < node.childCount; i++) {
            collectErrors(node.child(i));
        }
    };

    if (tree.rootNode.hasError()) {
        collectErrors(tree.rootNode);
    }

    // Cleanup
    tree.delete();
    parser.delete(); // Important to free WASM memory

    // Deduplicate errors (Tree-sitter can report same error at multiple tree levels)
    const uniqueErrors = errors.filter((v,i,a) => 
        a.findIndex(t => (t.line === v.line && t.message === v.message)) === i
    );

    log(`[Done] Found ${uniqueErrors.length} errors.`);

    return new Response(
      JSON.stringify({
        success: true,
        logs: logs,
        result: { 
            valid: uniqueErrors.length === 0, 
            errors: uniqueErrors // Array of detailed error objects
        }
      }),
      { headers: { ...CORS_HEADERS, "Content-Type": "application/json" }, status: 200 }
    );

  } catch (error: any) {
    console.error("Critical Error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        logs: [...logs, `[CRASH] ${error.message}`],
        error: error.message
      }),
      { headers: { ...CORS_HEADERS, "Content-Type": "application/json" }, status: 200 }
    );
  }
});
