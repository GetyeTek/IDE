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

    if (action === "list_universities") {
      const { data: universities, error } = await supabase
        .from('universities')
        .select('*')
        .order('name', { ascending: true });
        
      if (error) throw error;

      const universityBooks = universities.map(uni => ({
        id: uni.id,
        title: uni.name,
        name: uni.name,
        short_name: uni.short_name,
        cover_url: null 
      }));

      return new Response(JSON.stringify({ universities: universityBooks }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (action === "list_exams") {
      const { university_id } = await req.json();
      const { data: exams, error } = await supabase
        .from('exams')
        .select('*')
        .eq('university_id', university_id)
        .order('created_at', { ascending: false });
        
      if (error) throw error;

      return new Response(JSON.stringify({ exams }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
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

          // Process pages in reverse order (high to low) to prevent index shifting when modifying string
          const sortedPages = Object.entries(pagesWithQuestions).sort((a, b) => Number(b[0]) - Number(a[0]));

          for (const [pageNum, qList] of sortedPages) {
            // Robust Regex: Finds aria-label="Page 128"
            const regex = new RegExp(`aria-label\\s*=\\s*["']Page\\s+${pageNum}["']`, "i");
            const match = html.match(regex);
            
            if (match && match.index !== undefined) {
              console.log(`[LOG] INJECTING: Found Page ${pageNum} marker at index ${match.index}`);
              
              const questionsHtml = (qList as any[]).map(q => {
                let optionsHtml = '';

                // Handle Matching Type (Columns)
                if (q.question_type === 'matching' && q.matching_data) {
                  const leftCol = q.matching_data.left_column || [];
                  const rightCol = q.matching_data.right_column || [];
                  optionsHtml = `
                    <div class="q-matching-container" style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 20px;">
                      <div class="q-match-list">
                        ${leftCol.map((item: any) => `<div class="q-match-item" style="padding: 10px; border: 1px dashed rgba(255,255,255,0.2); margin-bottom: 8px; border-radius: 8px; font-size: 0.9em;">${item.text || item}</div>`).join('')}
                      </div>
                      <div class="q-match-list">
                        ${rightCol.map((item: any) => `<div class="q-match-item" style="padding: 10px; border: 1px solid rgba(66, 215, 184, 0.3); margin-bottom: 8px; border-radius: 8px; font-size: 0.9em;">${item.text || item}</div>`).join('')}
                      </div>
                    </div>`;
                } 
                // Handle Standard MCQ/Choice Type
                else if (q.options && Array.isArray(q.options)) {
                  optionsHtml = `
                    <div class="q-options" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px;">
                      ${q.options.map((opt: any) => `<button class="q-opt-btn" style="width: 100%; text-align: left;">${opt.text || opt}</button>`).join('')}
                    </div>`;
                }

                const mediaHtml = q.media && q.media.url ? `<img src="${q.media.url}" style="max-width: 100%; border-radius: 12px; margin-bottom: 15px; border: 1px solid rgba(255,255,255,0.1);" />` : '';
                const pointsLabel = q.points ? `<span class="q-points" style="margin-left: auto; font-size: 0.7em; opacity: 0.5;">[${q.points} pts]</span>` : '';

                return `
                  <div class="miron-question-card" data-qtype="${q.question_type || 'mcq'}" style="margin-bottom: 40px; border-left: 4px solid var(--accent-teal);">
                    <div class="q-header" style="display: flex; align-items: center; width: 100%;">
                      <span class="miron-orb-mini"></span>
                      <span class="q-label">MIRON CHALLENGE</span>
                      ${pointsLabel}
                    </div>
                    <p class="q-text" style="font-size: 1.2em; margin: 15px 0;"><strong>${q.question_number ? q.question_number + '.' : ''}</strong> ${q.text}</p>
                    ${mediaHtml}
                    ${optionsHtml}
                    <button class="q-submit" style="margin-top: 20px;">Check Understanding</button>
                  </div>`;
              }).join('');
              
              // STRATEGY: Find the START of the NEXT page container to insert BEFORE it.
              // This avoids relying on closing tags (</section>) which are often missing/mismatched in PDF-to-HTML.
              const nextContainerRegex = /<div[^>]*class=["'][^"']*page-container[^"']*["']/gi;
              nextContainerRegex.lastIndex = match.index; // Start searching AFTER the current page title
              
              const nextMatch = nextContainerRegex.exec(html);
              let insertIdx = -1;

              if (nextMatch) {
                // Insert before the next page starts
                insertIdx = nextMatch.index;
              } else {
                // If no next page, we are at the end. Insert before body close or at end.
                const bodyEnd = html.lastIndexOf("</body>");
                insertIdx = bodyEnd !== -1 ? bodyEnd : html.length;
              }

              // Inject wrapped in a relative container to ensure z-index works
              const injection = `<div class="miron-portal-container" style="position:relative; z-index:100; margin: 20px auto; max-width: 900px;">${questionsHtml}</div>`;
              html = html.slice(0, insertIdx) + injection + html.slice(insertIdx);
              
              console.log(`[LOG] SUCCESS: Injected ${qList.length} questions into Page ${pageNum} at index ${insertIdx}`);
            } else {
               console.log(`[WARN] FAILED to find HTML marker for Page ${pageNum}`);
            }
          }
        } else {
           console.log("[LOG] No questions found in book_question_links for this ID.");
        }
      } else {
         console.log(`[LOG] No document ID found for query: ${baseName}`);
      }

      // CSS is now handled by the frontend to ensure proper mobile scaling

      return new Response(html, { headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" } });
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (error) {
    console.error(`[FATAL] ${error.message}`);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});