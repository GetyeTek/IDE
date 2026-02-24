import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// HELPER: Implements the SQL grouping logic
// "rare_words_13/chunk_5.txt" -> "rare_words_13/chunk"
// "rare_words_1.txt" -> "rare_words_1"
const getLogicalName = (path: string) => {
  if (!path) return "unknown";
  if (path.includes('/')) {
    return path.replace(/_[0-9]+\.[^.]+$/, '');
  }
  return path.replace(/\.[^.]+$/, '');
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
      const logicalTarget = getLogicalName(targetFile);
      
      // 1. Fetch Deep Aggregated Metrics from Postgres
      const { data: deepStats, error: deepErr } = await supabase.rpc('get_refinery_deep_stats', { 
        p_source_prefix: logicalTarget 
      });
      if (deepErr) throw deepErr;

      // 2. Fetch Batch Health from Metadata tables
      let batchQuery = isScript2 
        ? supabase.from('chunk_queue').select('status')
        : supabase.from('refinery_batches').select('status').ilike('target_file', `${logicalTarget}%`);
      
      const { data: bData } = await batchQuery;
      const batchStats = (bData || []).reduce((acc: any, curr: any) => {
        acc[curr.status] = (acc[curr.status] || 0) + 1;
        return acc;
      }, { completed: 0, failed: 0, processing: 0, pending: 0 });

      const totalBatches = (bData || []).length;
      const successRate = totalBatches > 0 ? Math.round((batchStats.completed / totalBatches) * 100) : 0;

      return new Response(JSON.stringify({
        ...deepStats,
        logical_group: logicalTarget,
        batch_stats: batchStats,
        health: successRate > 90 ? 'Healthy' : successRate > 60 ? 'Warning' : 'Critical',
        success_rate: successRate
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
      yieldReport
    ] = await Promise.all([
      supabase.from('refinery_progress').select('file_path, is_finished, updated_at').order('id', { ascending: true }),
      supabase.from('chunk_queue').select('status, retry_count'),
      supabase.from('api_keys').select('service, is_active, last_used_at, cooldown_until').eq('service', 'gemini'),
      supabase.from('refinery_stats').select('worker_id, source_file, error_type, error_message, created_at').eq('status', 'failed').order('created_at', { ascending: false }).limit(30),
      supabase.rpc('get_refinery_stats')
    ]);

    const s2Stats = (s2Queue.data || []).reduce((acc: any, curr: any) => {
      acc[curr.status] = (acc[curr.status] || 0) + 1;
      return acc;
    }, { pending: 0, processing: 0, completed: 0, failed: 0 });

    // Calculate grand totals from the yieldReport
    const grandTotalWords = (yieldReport.data || []).reduce((sum: number, f: any) => sum + Number(f.total_entries), 0);
    const grandUniqueWords = (yieldReport.data || []).reduce((sum: number, f: any) => sum + Number(f.unique_words), 0);

    const dashboardData = {
      global: {
        total_words_found: grandTotalWords,
        total_unique_words: grandUniqueWords,
        total_duplicates: grandTotalWords - grandUniqueWords,
        api_keys_active: keys.data?.filter(k => k.is_active).length || 0,
        api_keys_in_cooldown: keys.data?.filter(k => k.cooldown_until && new Date(k.cooldown_until) > new Date()).length || 0,
      },
      file_breakdown: yieldReport.data || [],
      script2_queue: {
        stats: s2Stats,
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