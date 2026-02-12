import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { action, question_id, exam_id, limit = 10 } = await req.json();

    // Action: Get a single question with all its parents and book links
    if (action === 'get_reconstructed_question') {
      const { data, error } = await supabaseClient
        .from('questions')
        .select(`
          *,
          section:sections (
            title,
            instructions,
            exam:exams (
              course_name,
              course_code,
              exam_type,
              university:universities (name, short_name)
            )
          ),
          source_links:book_question_links (
            similarity_score,
            chunk:chunks (
              page_number,
              document_id,
              document:documents (file_name)
            )
          )
        `)
        .eq('id', question_id)
        .single();

      if (error) throw error;
      return new Response(JSON.stringify(data), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    // Action: List all questions for an exam (Full reconstruction for Quiz mode)
    if (action === 'get_exam_paper') {
      const { data, error } = await supabaseClient
        .from('questions')
        .select(`
          id,
          question_number,
          question_type,
          text,
          options,
          points,
          question_order,
          section:sections (
            title,
            instructions
          )
        `)
        .eq('sections.exam_id', exam_id)
        .order('question_order', { ascending: true });

      if (error) throw error;
      // Filter out questions where the join failed (not in this exam)
      const filtered = data.filter(q => q.section !== null);

      return new Response(JSON.stringify(filtered), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    throw new Error('Invalid Action');

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { 
      status: 400, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }
});