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

    // 1. GLOBAL LINGUISTIC STATS
    // We use a single query to get counts from the JSONB word arrays
    const linguisticStatsPromise = supabase.rpc('get_refinery_linguistic_metrics');

    // 2. SCRIPT 1: RARE WORDS PROGRESS (1-12)
    const script1ProgressPromise = supabase
      .from('refinery_progress')
      .select('file_path, is_finished, updated_at')
      .order('id', { ascending: true });

    const script1BatchStatsPromise = supabase
      .from('refinery_batches')
      .select('status, count')
      .csv(); // Using a trick to get counts group by status if RPC isn't available

    // 3. SCRIPT 2: CHUNK QUEUE STATS
    const script2QueuePromise = supabase
      .from('chunk_queue')
      .select('status, retry_count')

    // 4. API KEY HEALTH
    const keyHealthPromise = supabase
      .from('api_keys')
      .select('service, is_active, last_used_at, cooldown_until')
      .eq('service', 'gemini');

    // 5. RECENT ERRORS (Last 50)
    const errorLogPromise = supabase
      .from('refinery_stats')
      .select('worker_id, source_file, error_type, error_message, created_at')
      .eq('status', 'failed')
      .order('created_at', { ascending: false })
      .limit(50);

    const [
      linguistic,
      s1Progress,
      s2Queue,
      keys,
      errors
    ] = await Promise.all([
      linguisticStatsPromise,
      script1ProgressPromise,
      script2QueuePromise,
      keyHealthPromise,
      errorLogPromise
    ]);

    // Processing S2 Queue stats locally to avoid multiple queries
    const s2Stats = (s2Queue.data || []).reduce((acc: any, curr: any) => {
      acc[curr.status] = (acc[curr.status] || 0) + 1;
      if (curr.retry_count > 0) acc.retried += 1;
      return acc;
    }, { pending: 0, processing: 0, completed: 0, failed: 0, retried: 0 });

    // Calculate Index Gaps for Script 1 (Theoretical vs Actual)
    // This is a simplified check: comparing refinery_batches vs processed_words counts
    const { count: s1Expected } = await supabase.from('refinery_batches').select('*', { count: 'exact', head: true });
    const { count: s1Actual } = await supabase.from('processed_words').select('*', { count: 'exact', head: true }).ilike('source_file', 'rare_words_%');

    const dashboardData = {
      global: {
        total_processed_batches: (s1Actual || 0) + (s2Stats.completed || 0),
        api_keys_active: keys.data?.filter(k => k.is_active).length || 0,
        api_keys_in_cooldown: keys.data?.filter(k => k.cooldown_until && new Date(k.cooldown_until) > new Date()).length || 0,
      },
      script1: {
        files: s1Progress.data || [],
        batch_gap_count: Math.max(0, (s1Expected || 0) - (s1Actual || 0)),
        completion_rate: s1Expected ? Math.min(100, Math.round(((s1Actual || 0) / s1Expected) * 100)) : 0
      },
      script2: {
        queue: s2Stats,
        total_chunks: (s2Queue.data || []).length
      },
      errors: {
        recent_logs: errors.data,
        top_error_types: Array.from(new Set(errors.data?.map(e => e.error_type)))
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