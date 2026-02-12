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

  try {
    const { action, book_path } = await req.json();
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
          books.push({ path: fData.html.path, title: filename.replace(/\.html$/i, "").replace(/_/g, " "), cover_url: fData.image ? `${PUBLIC_ENDPOINT}?action=proxy_image&path=${encodeURIComponent(fData.image)}` : null });
        }
      }
      return new Response(JSON.stringify({ books }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "get_book_compressed") {
      const rawUrl = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BRANCH}/${book_path}`;
      const resp = await fetch(rawUrl, { headers: { "Authorization": `token ${GITHUB_PAT}` } });
      let html = await resp.text();

      const baseName = book_path.split('/').pop().replace(/\.[^/.]+$/, ""); 
      const { data: doc } = await supabase.from('documents').select('id').ilike('file_name', `%${baseName}%`).limit(1).single();

      if (doc) {
        // Use !inner to filter top-level results by joined table columns and prevent NULL chunks
        const { data: questions, error: qErr } = await supabase
          .from('book_question_links')
          .select(`
            question:questions (*),
            chunk:chunks!inner (page_number, document_id)
          `)
          .eq('chunks.document_id', doc.id);

        if (qErr) console.error(`[QUERY ERROR] ${qErr.message}`);

        if (questions && questions.length > 0) {
          const pagesWithQuestions = questions.reduce((acc: any, curr: any) => {
            // Defensive Check: Ensure chunk and page_number exist
            if (curr.chunk && curr.chunk.page_number !== undefined) {
              const pg = curr.chunk.page_number;
              if (!acc[pg]) acc[pg] = [];
              acc[pg].push(curr.question);
            }
            return acc;
          }, {});

          for (const [pageNum, qList] of Object.entries(pagesWithQuestions)) {
            const searchPattern = `aria-label="Page ${pageNum}"`;
            const index = html.indexOf(searchPattern);
            if (index !== -1) {
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
            }
          }
        }
      }

      const styles = `<style>
        .miron-portal-container { padding: 50px 30px !important; background: linear-gradient(to bottom, transparent, #0c0c0c) !important; clear: both !important; display: block !important; position: relative !important; z-index: 100 !important; }
        .miron-question-card { background: rgba(30, 30, 30, 0.95) !important; backdrop-filter: blur(20px) !important; border: 1px solid rgba(255, 255, 255, 0.1) !important; border-radius: 28px !important; padding: 30px !important; margin-bottom: 40px !important; border-left: 6px solid #42d7b8 !important; color: white !important; box-shadow: 0 20px 50px rgba(0,0,0,0.5) !important; }
        .miron-orb-mini { display: inline-block; width: 12px; height: 12px; background: #42d7b8; border-radius: 50%; box-shadow: 0 0 15px #42d7b8; margin-right: 12px; }
        .q-label { font-size: 0.75rem; font-weight: 900; color: #42d7b8; letter-spacing: 3px; font-family: sans-serif; }
        .q-text { font-size: 1.3rem; margin: 20px 0; line-height: 1.6; font-family: serif; }
        .q-opt-btn { width: 100%; padding: 18px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; color: white; text-align: left; margin-bottom: 10px; cursor: pointer; font-size: 1rem; transition: background 0.2s; }
        .q-opt-btn:hover { background: rgba(66, 215, 184, 0.1); }
        .q-submit { margin-top: 20px; width: 100%; padding: 16px; background: #42d7b8; color: #0c0c0c; border: none; border-radius: 16px; font-weight: 800; cursor: pointer; font-size: 1.1rem; }
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