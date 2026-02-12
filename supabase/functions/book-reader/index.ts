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
    console.log(`[DEBUG] Action: ${action}, Path: ${book_path}`);

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    if (action === "get_book_compressed") {
      // 1. Fetch Book HTML
      const rawUrl = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BRANCH}/${book_path}`;
      const resp = await fetch(rawUrl, { headers: { "Authorization": `token ${GITHUB_PAT}` } });
      let html = await resp.text();
      console.log(`[DEBUG] HTML Fetched. Length: ${html.length} chars`);

      // 2. Identify Document
      const fileName = book_path.split('/').pop();
      console.log(`[DEBUG] Looking for document with file_name matching: "${fileName}"`);
      
      const { data: doc, error: docErr } = await supabase.from('documents').select('id').eq('file_name', fileName).single();
      
      if (docErr || !doc) {
        console.error(`[ERROR] Document not found in DB for filename: ${fileName}. Error: ${docErr?.message}`);
      } else {
        console.log(`[DEBUG] Found Document ID: ${doc.id}`);

        // 3. Fetch Linked Questions
        const { data: questions, error: qErr } = await supabase
          .from('book_question_links')
          .select(`
            question:questions (*),
            chunk:chunks (page_number, document_id)
          `)
          .eq('chunk.document_id', doc.id);

        if (qErr) console.error(`[ERROR] Question fetch error: ${qErr.message}`);
        
        if (questions && questions.length > 0) {
          console.log(`[DEBUG] Found ${questions.length} linked questions for this book.`);
          
          const pagesWithQuestions = questions.reduce((acc: any, curr: any) => {
            const pg = curr.chunk.page_number;
            if (!acc[pg]) acc[pg] = [];
            acc[pg].push(curr.question);
            return acc;
          }, {});

          console.log(`[DEBUG] Pages targeted for injection: ${Object.keys(pagesWithQuestions).join(', ')}`);

          for (const [pageNum, qList] of Object.entries(pagesWithQuestions)) {
            // Try multiple pattern variations for robustness
            const patterns = [
                `aria-label="Page ${pageNum}">`,
                `aria-label='Page ${pageNum}'>`,
                `Page ${pageNum}`
            ];
            
            let injectionPoint = -1;
            let usedPattern = "";

            for(const p of patterns) {
                injectionPoint = html.indexOf(p);
                if(injectionPoint !== -1) {
                    usedPattern = p;
                    break;
                }
            }
            
            if (injectionPoint !== -1) {
              console.log(`[DEBUG] Page ${pageNum} found using pattern "${usedPattern}" at index ${injectionPoint}`);
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

              const sectionEnd = html.indexOf('</section>', injectionPoint);
              if (sectionEnd !== -1) {
                html = html.slice(0, sectionEnd) + `<div class="miron-portal-container">${questionsHtml}</div>` + html.slice(sectionEnd);
                console.log(`[DEBUG] Successfully injected ${qList.length} questions into Page ${pageNum}`);
              } else {
                console.warn(`[WARN] Could not find </section> after Page ${pageNum} marker`);
              }
            } else {
              console.warn(`[WARN] Page marker "Page ${pageNum}" not found in HTML source code!`);
            }
          }
        } else {
          console.log("[DEBUG] No questions found linked to this document ID.");
        }
      }

      // Inject Styles
      const styles = `
        <style>
          .miron-portal-container { padding: 60px 40px; background: linear-gradient(to bottom, transparent, #0c0c0c); border-top: 1px solid rgba(66, 215, 184, 0.2); margin-top: 40px; clear: both; }
          .miron-question-card { background: rgba(30, 30, 30, 0.8); backdrop-filter: blur(20px); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 28px; padding: 30px; margin-bottom: 40px; box-shadow: 0 30px 60px rgba(0,0,0,0.5); border-left: 6px solid #42d7b8; }
          .q-label { font-family: 'Poppins'; font-size: 0.8rem; font-weight: 800; color: #42d7b8; letter-spacing: 3px; }
          .q-text { font-size: 1.3rem; color: white; line-height: 1.6; margin: 20px 0; font-family: 'Poppins'; }
          .q-opt-btn { width: 100%; padding: 18px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; color: white; text-align: left; margin-bottom: 12px; cursor: pointer; font-size: 1rem; }
          .q-submit { margin-top: 20px; width: 100%; padding: 16px; background: #42d7b8; color: #0c0c0c; border: none; border-radius: 16px; font-weight: 800; cursor: pointer; font-size: 1rem; }
        </style>
      `;
      html = html.replace('</head>', styles + '</head>');

      return new Response(html, { headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" } });
    }

    return new Response("Not Found", { status: 404 });
  } catch (error) {
    console.error(`[FATAL ERROR]: ${error.message}`);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});