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
    const { action, book_path } = await req.json();
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    if (action === "get_book_compressed") {
      // 1. Fetch Book HTML from GitHub
      const rawUrl = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BRANCH}/${book_path}`;
      const resp = await fetch(rawUrl, { headers: { "Authorization": `token ${GITHUB_PAT}` } });
      let html = await resp.text();

      // 2. Fetch Questions linked to this book
      // We match by filename to find the document_id first
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
          // 3. Sophisticated Injection Logic
          // We group questions by page and inject them into the HTML string
          const pagesWithQuestions = questions.reduce((acc: any, curr: any) => {
            const pg = curr.chunk.page_number;
            if (!acc[pg]) acc[pg] = [];
            acc[pg].push(curr.question);
            return acc;
          }, {});

          for (const [pageNum, qList] of Object.entries(pagesWithQuestions)) {
            const searchPattern = `aria-label="Page ${pageNum}">`;
            const injectionPoint = html.indexOf(searchPattern);
            
            if (injectionPoint !== -1) {
              const questionsHtml = (qList as any[]).map(q => `
                <div class="miron-question-card">
                  <div class="q-header">
                    <span class="miron-orb-mini"></span>
                    <span class="q-label">MIRON CHALLENGE</span>
                    <span class="q-points">${q.points || 5} pts</span>
                  </div>
                  <p class="q-text">${q.text}</p>
                  <div class="q-options">
                    ${q.options ? q.options.map((opt: string) => `<button class="q-opt-btn">${opt}</button>`).join('') : '<textarea placeholder="Type your reflection..." class="q-input"></textarea>'}
                  </div>
                  <div class="q-footer">
                    <button class="q-submit">Check Understanding</button>
                  </div>
                </div>
              `).join('');

              // Find the closing div of the text-container or the section
              const sectionEnd = html.indexOf('</section>', injectionPoint);
              html = html.slice(0, sectionEnd) + `<div class="miron-portal-container">${questionsHtml}</div>` + html.slice(sectionEnd);
            }
          }
        }
      }

      // 4. Inject UI Styles into the HTML Head
      const styles = `
        <style>
          .miron-portal-container { padding: 40px 20px; background: linear-gradient(to bottom, transparent, #0c0c0c); border-top: 1px solid rgba(66, 215, 184, 0.2); margin-top: 20px; pointer-events: auto !important; }
          .miron-question-card { background: rgba(30, 30, 30, 0.6); backdrop-filter: blur(15px); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 24px; padding: 24px; margin-bottom: 30px; box-shadow: 0 20px 40px rgba(0,0,0,0.4); border-left: 4px solid #42d7b8; transition: transform 0.3s ease; }
          .q-header { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
          .miron-orb-mini { width: 12px; height: 12px; background: #42d7b8; border-radius: 50%; box-shadow: 0 0 10px #42d7b8; }
          .q-label { font-size: 0.7rem; font-weight: 800; color: #42d7b8; letter-spacing: 2px; }
          .q-points { margin-left: auto; font-size: 0.7rem; color: rgba(255,255,255,0.4); }
          .q-text { font-size: 1.1rem; color: white; line-height: 1.6; margin-bottom: 20px; font-family: 'Poppins', sans-serif; }
          .q-opt-btn { width: 100%; padding: 14px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; color: white; text-align: left; margin-bottom: 8px; cursor: pointer; transition: all 0.2s; font-family: 'Poppins'; }
          .q-opt-btn:hover { background: rgba(66, 215, 184, 0.1); border-color: #42d7b8; }
          .q-input { width: 100%; padding: 14px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; color: white; min-height: 100px; font-family: 'Poppins'; }
          .q-submit { margin-top: 15px; width: 100%; padding: 12px; background: #42d7b8; color: #0c0c0c; border: none; border-radius: 12px; font-weight: 700; cursor: pointer; }
        </style>
      `;
      html = html.replace('</head>', styles + '</head>');

      return new Response(html, { headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" } });
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});