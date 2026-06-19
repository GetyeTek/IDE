import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, accept-encoding",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const body = req.method === "POST" ? await req.json() : {};
    const action = body.action || url.searchParams.get("action");
    
    console.log(`[START] Action: ${action}`);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!, 
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // 1. LIST BOOKS (Database Driven)
    if (action === "list_books") {
      const { data: books, error } = await supabase
        .from('books')
        .select('*')
        .order('title', { ascending: true });
        
      if (error) throw error;
      return new Response(JSON.stringify({ books }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 2. GET STRUCTURED JSON PAGES
    if (action === "get_book_pages") {
      const { book_id } = body;
      console.log(`[FETCH] Loading native pages for book ID: ${book_id}`);

      const { data: pages, error } = await supabase
        .from('book_pages')
        .select('*')
        .eq('book_id', book_id)
        .order('page_number', { ascending: true });

      if (error) throw error;
      return new Response(JSON.stringify({ pages }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 3. LEGACY LIST UNIVERSITIES
    if (action === "list_universities") {
      const { data: universities, error } = await supabase
        .from('universities')
        .select('*')
        .order('name', { ascending: true });
      if (error) throw error;

      const universityBooks = universities.map(uni => ({
        id: uni.id, name: uni.name, title: uni.name, cover_url: null 
      }));
      return new Response(JSON.stringify({ universities: universityBooks }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 4. LEGACY EXAMS LISTING
    if (action === "list_exams") {
      const { university_id } = body;
      const { data, error } = await supabase
        .from('exams')
        .select(`id, exam_type, date, time_allowed_minutes, total_marks, courses(code, name)`)
        .eq('university_id', university_id)
        .order('created_at', { ascending: false });
      if (error) throw error;

      const mappedExams = data.map(exam => ({
        ...exam,
        course_name: exam.courses?.name || 'General Assessment',
        course_code: exam.courses?.code || 'EXAM'
      }));
      return new Response(JSON.stringify({ exams: mappedExams }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 6. QUESTION HINT (RAG / MAPPING LOOKUP)
    if (action === "get_question_hint") {
      const { question_id } = body;
      
      const { data: mapping, error: mapErr } = await supabase
        .from('question_book_mappings')
        .select(`book_id, page_key, content_index, snippet, books(title)`)
        .eq('question_id', question_id)
        .eq('is_valid', true)
        .single();
        
      if (mapErr) {
        if (mapErr.code === 'PGRST116') {
          return new Response(JSON.stringify({ found: false }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        throw mapErr;
      }

      const { data: pageData, error: pageErr } = await supabase
        .from('book_pages')
        .select('content_json, page_number')
        .eq('book_id', mapping.book_id)
        .eq('page_key', mapping.page_key)
        .single();

      if (pageErr) throw pageErr;

      let block = null;
      if (pageData.content_json && Array.isArray(pageData.content_json)) {
        block = pageData.content_json[mapping.content_index];
      }

      return new Response(JSON.stringify({
        found: true,
        book_title: mapping.books?.title || "Course Material",
        book_id: mapping.book_id,
        content_index: mapping.content_index,
        page_key: mapping.page_key,
        page_number: pageData.page_number,
        block: block,
        snippet: mapping.snippet
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 5. LEGACY EXAM QUESTIONS
    if (action === "get_exam_questions") {
      const { exam_id } = body;
      const [sectionsResp, metaResp] = await Promise.all([
        supabase.from('sections')
          .select('*, questions (*)')
          .eq('exam_id', exam_id)
          .order('section_order', { ascending: true })
          .order('question_order', { foreignTable: 'questions', ascending: true }),
        supabase.from('exams').select('courses(name, code)').eq('id', exam_id).single()
      ]);
      
      if (sectionsResp.error) throw sectionsResp.error;
      if (metaResp.error && metaResp.error.code !== 'PGRST116') throw metaResp.error;
      
      return new Response(JSON.stringify({
        sections: sectionsResp.data,
        course_name: metaResp.data?.courses?.name || 'General Assessment',
        course_code: metaResp.data?.courses?.code || 'EXAM'
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (error) {
    console.error(`[FATAL] ${error.message}`);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});