import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GITHUB_PAT = Deno.env.get("GITHUB_PAT");
const REPO_OWNER = "GetyeTek";
const REPO_NAME = "LinkUp";
const BRANCH = "main";
const PUBLIC_ENDPOINT = "https://xvldfsmxskhemkslsbym.supabase.co/functions/v1/book-reader";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, accept-encoding",
  "Access-Control-Expose-Headers": "Content-Length"
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);

  // --- IMAGE PROXY ---
  if (req.method === "GET") {
    const action = url.searchParams.get("action");
    const path = url.searchParams.get("path");
    if (action === "proxy_image" && path) {
      try {
        const rawUrl = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BRANCH}/${path}`;
        const imgResp = await fetch(rawUrl, { headers: { "Authorization": `token ${GITHUB_PAT}` } });
        const blob = await imgResp.blob();
        return new Response(blob, { headers: { ...corsHeaders, "Content-Type": imgResp.headers.get("Content-Type") || "image/jpeg" } });
      } catch (e) { return new Response("Proxy Error", { status: 500 }); }
    }
  }

  // --- MAIN API ---
  try {
    const { action, book_path } = await req.json();
    console.log(`[EXEC] Action: ${action} | Path: ${book_path}`);

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    if (action === "list_books") {
      const treeUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/git/trees/${BRANCH}?recursive=1`;
      const resp = await fetch(treeUrl, { headers: { "Authorization": `token ${GITHUB_PAT}` } });
      const data = await resp.json();
      const folderMap = new Map();
      for (const item of data.tree || []) {
        if (!item.path.startsWith("Books/") || item.type !== "blob") continue;
        const parts = item.path.split("/");
        const folder = parts.slice(0, -1).join("/");
        if (!folderMap.has(folder)) folderMap.set(folder, {});
        const entry = folderMap.get(folder);
        if (item.path.endsWith(".html")) entry.html = item;
        else if (/\.(jpg|jpeg|png|webp)$/i.test(item.path)) entry.image = item.path;
      }
      const books = [];
      for (const [_, fData] of folderMap) {
        if (fData.html) {
          const filename = fData.html.path.split("/").pop();
          books.push({
            path: fData.html.path,
            title: filename.replace(/\.html$/i, "").replace(/_/g, " "),
            cover_url: fData.image ? `${PUBLIC_ENDPOINT}?action=proxy_image&path=${encodeURIComponent(fData.image)}` : null
          });
        }
      }
      return new Response(JSON.stringify({ books }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "get_book_compressed") {
      console.log(`[PROCESS] Fetching HTML for ${book_path}`);
      const rawUrl = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BRANCH}/${book_path}`;
      const resp = await fetch(rawUrl, { headers: { "Authorization": `token ${GITHUB_PAT}` } });
      let html = await resp.text();

      // 1. FUZZY FILENAME SEARCH
      const baseName = book_path.split('/').pop().replace(/\.[^/.]+$/, ""); // Psychology
      console.log(`[DB_SEARCH] Looking for filename like: ${baseName}`);
      
      const { data: doc } = await supabase
        .from('documents')
        .select('id, file_name')
        .ilike('file_name', `%${baseName}%`)
        .limit(1)
        .single();

      if (doc) {
        console.log(`[DB_FOUND] Document ID: ${doc.id} (${doc.file_name})`);
        
        const { data: questions } = await supabase
          .from('book_question_links')
          .select(`question:questions (*), chunk:chunks (page_number)`)
          .eq('chunk.document_id', doc.id);

        if (questions && questions.length > 0) {
          console.log(`[INJECT] Found ${questions.length} linked questions.`);
          
          const pagesWithQuestions = questions.reduce((acc: any, curr: any) => {
            const pg = curr.chunk.page_number;
            if (!acc[pg]) acc[pg] = [];
            acc[pg].push(curr.question);
            return acc;
          }, {});

          for (const [pageNum, qList] of Object.entries(pagesWithQuestions)) {
            // Robust Marker Search
            const searchPattern = `aria-label="Page ${pageNum}"`;
            const index = html.indexOf(searchPattern);
            
            if (index !== -1) {
              console.log(`[SUCCESS] Injected into Page ${pageNum}`);
              const questionsHtml = (qList as any[]).map(q => `
                <div class="miron-question-card">
                  <div class="q-header"><span class="miron-orb-mini"></span><span class="q-label">MIRON CHALLENGE</span></div>
                  <p class="q-text">${q.text}</p>
                  <div class="q-options">
                    ${q.options ? q.options.map((opt: string) => `<button class="q-opt-btn">${opt}</button>`).join('') : ''}
                  </div>
                  <button class="q-submit">Verify Logic</button>
                </div>`).join('');
              
              const sectionEnd = html.indexOf('</section>', index);
              if (sectionEnd !== -1) {
                html = html.slice(0, sectionEnd) + `<div class="miron-portal-container">${questionsHtml}</div>` + html.slice(sectionEnd);
              }
            } else {
              console.warn(`[FAIL] Marker Page ${pageNum} not found in HTML source.`);
            }
          }
        } else {
            console.log("[INFO] No questions linked in database.");
        }
      } else {
          console.log(`[INFO] No document match found for ${baseName}`);
      }

      const styles = `<style>
        .miron-portal-container { padding: 50px 30px !important; background: linear-gradient(to bottom, transparent, #0c0c0c) !important; clear: both !important; display: block !important; position: relative !important; z-index: 100 !important; }
        .miron-question-card { background: rgba(30, 30, 30, 0.9) !important; backdrop-filter: blur(20px) !important; border: 1px solid rgba(255, 255, 255, 0.1) !important; border-radius: 24px !important; padding: 25px !important; margin-bottom: 30px !important; border-left: 5px solid #42d7b8 !important; color: white !important; }
        .miron-orb-mini { display: inline-block; width: 10px; height: 10px; background: #42d7b8; border-radius: 50%; box-shadow: 0 0 10px #42d7b8; margin-right: 10px; }
        .q-label { font-size: 0.7rem; font-weight: 800; color: #42d7b8; letter-spacing: 2px; }
        .q-text { font-size: 1.2rem; margin: 15px 0; line-height: 1.5; }
        .q-opt-btn { width: 100%; padding: 15px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; color: white; text-align: left; margin-bottom: 8px; cursor: pointer; }
        .q-submit { margin-top: 15px; width: 100%; padding: 14px; background: #42d7b8; color: #0c0c0c; border: none; border-radius: 12px; font-weight: 700; cursor: pointer; }
      </style>`;
      html = html.replace('</head>', styles + '</head>');

      return new Response(html, { headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" } });
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (error) {
    console.error(`[FATAL ERROR]: ${error.message}`);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});