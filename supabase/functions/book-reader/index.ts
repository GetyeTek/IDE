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
    console.log(`[START] Action: ${action} | Path: ${book_path}`);

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    if (action === "list_books") {
       // ... (Keeping list_books logic the same to avoid breaking covers) ...
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
      console.log(`[LOG] Fetched HTML: ${html.length} chars`);

      const baseName = book_path.split('/').pop().replace(/\.[^/.]+$/, ""); 
      console.log(`[LOG] DB Searching for document like: %${baseName}%`);

      const { data: doc } = await supabase.from('documents').select('id, file_name').ilike('file_name', `%${baseName}%`).limit(1).single();

      if (doc) {
        console.log(`[LOG] Found Document: ${doc.file_name} (ID: ${doc.id})`);
        
        const { data: questions } = await supabase
          .from('book_question_links')
          .select(`question:questions (*), chunk:chunks!inner (page_number, document_id)`)
          .eq('chunks.document_id', doc.id);

        if (questions && questions.length > 0) {
          console.log(`[LOG] Found ${questions.length} total questions linked.`);
          
          const pagesWithQuestions = questions.reduce((acc: any, curr: any) => {
            if (curr.chunk && curr.chunk.page_number) {
              const pg = curr.chunk.page_number;
              if (!acc[pg]) acc[pg] = [];
              acc[pg].push(curr.question);
            }
            return acc;
          }, {});

          for (const [pageNum, qList] of Object.entries(pagesWithQuestions)) {
            // Robust Regex: Finds aria-label="Page 128" or aria-label='Page 128' with any spacing
            const regex = new RegExp(`aria-label\\s*=\\s*["']Page\\s+${pageNum}["']`, "i");
            const match = html.match(regex);
            
            if (match && match.index) {
              console.log(`[LOG] INJECTING: Found Page ${pageNum} marker at index ${match.index}`);
              const questionsHtml = (qList as any[]).map(q => `
                <div class="miron-question-card">
                  <div class="q-header"><span class="miron-orb-mini"></span><span class="q-label">MIRON CHALLENGE</span></div>
                  <p class="q-text">${q.text}</p>
                  <div class="q-options">
                    ${q.options ? q.options.map((opt: string) => `<button class="q-opt-btn">${opt}</button>`).join('') : ''}
                  </div>
                  <button class="q-submit">Check Understanding</button>
                </div>`).join('');
              
              // Find the end of the section containing this marker
              const sectionEnd = html.indexOf('</section>', match.index);
              if (sectionEnd !== -1) {
                html = html.slice(0, sectionEnd) + `<div class="miron-portal-container">${questionsHtml}</div>` + html.slice(sectionEnd);
                console.log(`[LOG] SUCCESS: Injected ${qList.length} questions into Page ${pageNum}`);
              } else {
                 console.log(`[WARN] Could not find closing </section> for page ${pageNum}`);
              }
            } else {
               console.log(`[WARN] FAILED to find HTML marker for Page ${pageNum} using regex ${regex}`);
            }
          }
        } else {
           console.log("[LOG] No questions found in book_question_links for this ID.");
        }
      } else {
         console.log(`[LOG] No document ID found for query: ${baseName}`);
      }

      const styles = `<style>
        .miron-portal-container { padding: 60px 40px !important; background: #0c0c0c !important; border-top: 1px solid #42d7b833 !important; position: relative !important; z-index: 9999 !important; display: block !important; }
        .miron-question-card { background: rgba(30, 30, 30, 0.95) !important; border: 1px solid rgba(255, 255, 255, 0.1) !important; border-radius: 28px !important; padding: 30px !important; margin-bottom: 40px !important; border-left: 6px solid #42d7b8 !important; color: white !important; font-family: sans-serif !important; }
        .miron-orb-mini { display: inline-block; width: 12px; height: 12px; background: #42d7b8; border-radius: 50%; margin-right: 12px; }
        .q-label { font-size: 0.8rem; font-weight: 900; color: #42d7b8; letter-spacing: 2px; }
        .q-text { font-size: 1.3rem; margin: 20px 0; line-height: 1.5; }
        .q-opt-btn { width: 100%; padding: 18px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; color: white; text-align: left; margin-bottom: 10px; cursor: pointer; }
        .q-submit { margin-top: 20px; width: 100%; padding: 16px; background: #42d7b8; color: #0c0c0c; border: none; border-radius: 16px; font-weight: 800; cursor: pointer; }
      </style>`;
      html = html.replace('</head>', styles + '</head>');

      return new Response(html, { headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" } });
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (error) {
    console.error(`[FATAL] ${error.message}`);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});