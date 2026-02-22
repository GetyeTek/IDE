import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const url = new URL(req.url);
    const targetFile = url.searchParams.get('file');
    const isScript2 = url.searchParams.get('is_script2') === 'true';

    // --- MODE: DEEP FILE INSPECTION ---
    if (targetFile) {
      let query = supabase.from('processed_words').select('words, batch_index');
      
      if (isScript2) {
        // Aggregate stats for the entire 13-26 range
        query = query.or('source_file.ilike.rare_words_1[3-9]%,source_file.ilike.rare_words_2[0-6]%');
      } else {
        query = query.eq('source_file', targetFile);
      }

      const { data: wordsData, error: wordsErr } = await query;
      if (wordsErr) throw wordsErr;

      const allWords = (wordsData || []).flatMap(row => row.words || []);
      const totalWords = allWords.length;
      
      // Linguistic Frequencies
      const rootFreq = new Map();
      const posDist = new Map();
      const wordSet = new Set();

      allWords.forEach(w => {
        if (w.word) wordSet.add(w.word.trim());
        if (w.root) rootFreq.set(w.root, (rootFreq.get(w.root) || 0) + 1);
        if (w.pos) posDist.set(w.pos, (posDist.get(w.pos) || 0) + 1);
      });

      const topRoots = [...rootFreq.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([root, count]) => ({ root, count }));

      // Batch Success Metrics
      let batchQuery = isScript2 
        ? supabase.from('chunk_queue').select('status')
        : supabase.from('refinery_batches').select('status').eq('target_file', targetFile);
      
      const { data: bData } = await batchQuery;
      const batchStats = (bData || []).reduce((acc: any, curr: any) => {
        acc[curr.status] = (acc[curr.status] || 0) + 1;
        return acc;
      }, { completed: 0, failed: 0, processing: 0, pending: 0 });

      const totalBatches = (bData || []).length;
      const successRate = totalBatches > 0 ? Math.round((batchStats.completed / totalBatches) * 100) : 0;

      return new Response(JSON.stringify({
        file_path: targetFile,
        total_words: totalWords,
        unique_words: wordSet.size,
        unique_roots: rootFreq.size,
        duplicates: totalWords - wordSet.size,
        batch_stats: batchStats,
        health: successRate > 90 ? 'Healthy' : successRate > 60 ? 'Warning' : 'Critical',
        success_rate: successRate,
        pos_distribution: Object.fromEntries(posDist),
        top_roots: topRoots
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    // --- MODE: GLOBAL DASHBOARD OVERVIEW ---
    const [
      s1Progress, 
      s2Queue, 
      keys, 
      errors,
      s1TotalBatches,
      s1ProcessedCount
    ] = await Promise.all([
      supabase.from('refinery_progress').select('file_path, is_finished, updated_at').order('id', { ascending: true }),
      supabase.from('chunk_queue').select('status, retry_count'),
      supabase.from('api_keys').select('service, is_active, last_used_at, cooldown_until').eq('service', 'gemini'),
      supabase.from('refinery_stats').select('worker_id, source_file, error_type, error_message, created_at').eq('status', 'failed').order('created_at', { ascending: false }).limit(30),
      supabase.from('refinery_batches').select('id', { count: 'exact', head: true }),
      supabase.from('processed_words').select('id', { count: 'exact', head: true }).ilike('source_file', 'rare_words_%')
    ]);

    const s2Stats = (s2Queue.data || []).reduce((acc: any, curr: any) => {
      acc[curr.status] = (acc[curr.status] || 0) + 1;
      return acc;
    }, { pending: 0, processing: 0, completed: 0, failed: 0 });

    const dashboardData = {
      global: {
        total_processed_batches: (s1ProcessedCount.count || 0) + (s2Stats.completed || 0),
        api_keys_active: keys.data?.filter(k => k.is_active).length || 0,
        api_keys_in_cooldown: keys.data?.filter(k => k.cooldown_until && new Date(k.cooldown_until) > new Date()).length || 0,
      },
      script1: {
        files: s1Progress.data || [],
        batch_gap_count: Math.max(0, (s1TotalBatches.count || 0) - (s1ProcessedCount.count || 0)),
        completion_rate: s1TotalBatches.count ? Math.min(100, Math.round(((s1ProcessedCount.count || 0) / s1TotalBatches.count) * 100)) : 0
      },
      script2: {
        queue: s2Stats,
        total_chunks: (s2Queue.data || []).length
      },
      errors: {
        recent_logs: errors.data || []
      }
    };

    return new Response(JSON.stringify(dashboardData), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});