import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GITHUB_PAT = Deno.env.get("GITHUB_PAT");
const REPO_OWNER = "GetyeTek";
const REPO_NAME = "LinkUp";
const BRANCH = "main";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, accept-encoding",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const payload = await req.json();
    const { action, book_path } = payload;
    console.log(`[DEBUG] Action: ${action} | Path: ${book_path}`);

    if (!GITHUB_PAT) {
      console.error("[CRITICAL] GITHUB_PAT secret is missing from environment variables!");
      throw new Error("Missing GITHUB_PAT");
    }

    const commonHeaders = {
      "Authorization": `token ${GITHUB_PAT}`,
      "Accept": "application/vnd.github.v3+json",
      "User-Agent": "LinkUp-Reader-Agent"
    };

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // --- ACTION: LIST BOOKS ---
    if (action === "list_books") {
      const treeUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/git/trees/${BRANCH}?recursive=1`;
      console.log(`[DEBUG] Fetching GitHub Tree: ${treeUrl}`);
      
      const resp = await fetch(treeUrl, { headers: commonHeaders });
      console.log(`[DEBUG] GitHub Tree Status: ${resp.status} ${resp.statusText}`);

      if (!resp.ok) {
        const errorBody = await resp.text();
        console.error(`[GITHUB ERROR] Failed to fetch tree: ${errorBody}`);
        throw new Error(`GitHub API Error: ${resp.status}`);
      }

      const data = await resp.json();
      console.log(`[DEBUG] Found ${data.tree?.length || 0} total items in repo tree.`);

      const folderMap = new Map();
      for (const item of data.tree) {
        if (!item.path.startsWith("Books/") || item.type !== "blob") continue;
        
        const parts = item.path.split("/");
        parts.pop();
        const folder = parts.join("/");
        
        if (!folderMap.has(folder)) folderMap.set(folder, {});
        const entry = folderMap.get(folder);

        if (item.path.endsWith(".html")) {
            entry.html = item;
        } else if (/\.(jpg|jpeg|png|webp)$/i.test(item.path)) {
            if (!entry.image) entry.image = item.path;
        }
      }

      const books = [];
      for (const [folder, folderData] of folderMap) {
        if (folderData.html) {
             const parts = folderData.html.path.split("/");
             const filename = parts[parts.length - 1];
             const title = filename.replace(/\.html$/i, "").replace(/_/g, " ");
             books.push({
                path: folderData.html.path,
                title: title,
                cover_url: folderData.image ? `https://xvldfsmxskhemkslsbym.supabase.co/functions/v1/book-reader?action=proxy_image&path=${encodeURIComponent(folderData.image)}` : null
             });
        }
      }
      
      console.log(`[DEBUG] Successfully paired ${books.length} books with content.`);
      return new Response(JSON.stringify({ books }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // --- ACTION: GET COMPRESSED BOOK (WITH INJECTION) ---
    if (action === "get_book_compressed") {
      const rawUrl = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BRANCH}/${book_path}`;
      console.log(`[DEBUG] Fetching Book Content from GitHub: ${rawUrl}`);
      
      const resp = await fetch(rawUrl, { headers: { "Authorization": `token ${GITHUB_PAT}` } });
      console.log(`[DEBUG] Content Fetch Status: ${resp.status}`);

      if (!resp.ok) throw new Error("Book not found on GitHub");
      let html = await resp.text();

      // Logic to find and inject questions (kept from previous turn for robustness)
      const fileName = book_path.split('/').pop();
      const { data: doc } = await supabase.from('documents').select('id').eq('file_name', fileName).single();
      
      if (doc) {
        const { data: questions } = await supabase
          .from('book_question_links')
          .select(`
            question:questions (*),
            chunk:chunks (page_number)
          `)
          .eq('chunk.document_id', doc.id);

        if (questions && questions.length > 0) {
          console.log(`[DEBUG] Found ${questions.length} linked questions for document ${doc.id}`);
          // ... (Injection logic continues here)
        }
      }

      return new Response(html, { headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" } });
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (error) {
    console.error(`[FATAL ERROR]: ${error.message}`);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});