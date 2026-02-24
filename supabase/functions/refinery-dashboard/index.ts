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
      
      // We fetch all records that belong to the logical group
      // (e.g. if you pass chunk_1, it finds chunk_1, chunk_2, etc via the prefix)
      const { data: wordsData, error: wordsErr } = await supabase
        .from('processed_words')
        .select('words, source_file')
        .ilike('source_file', `${logicalTarget}%`);

      if (wordsErr) throw wordsErr;

      const allWords = (wordsData || []).flatMap(row => row.words || []);
      const totalWords = allWords.length;
      
      const rootFreq = new Map();
      const posDist = new Map();
      const wordSet = new Set();

      allWords.forEach(w => {
        const wordText = w.word?.trim();
        if (wordText) wordSet.add(wordText);
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
        : supabase.from('refinery_batches').select('status').ilike('target_file', `${logicalTarget}%`);
      
      const { data: bData } = await batchQuery;
      const batchStats = (bData || []).reduce((acc: any, curr: any) => {
        acc[curr.status] = (acc[curr.status] || 0) + 1;
        return acc;
      }, { completed: 0, failed: 0, processing: 0, pending: 0 });

      const totalBatches = (bData || []).length;
      const successRate = totalBatches > 0 ? Math.round((batchStats.completed / totalBatches) * 100) : 0;

      return new Response(JSON.stringify({
        logical_group: logicalTarget,
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
    // We fetch the word arrays to calculate uniques/duplicates per logical file
    const [
      s1Progress, 
      s2Queue, 
      keys, 
      errors,
      allProcessed
    ] = await Promise.all([
      supabase.from('refinery_progress').select('file_path, is_finished, updated_at').order('id', { ascending: true }),
      supabase.from('chunk_queue').select('status, retry_count'),
      supabase.from('api_keys').select('service, is_active, last_used_at, cooldown_until').eq('service', 'gemini'),
      supabase.from('refinery_stats').select('worker_id, source_file, error_type, error_message, created_at').eq('status', 'failed').order('created_at', { ascending: false }).limit(30),
      supabase.from('processed_words').select('source_file, words')
    ]);

    // Aggregate logical stats (The JS version of your SQL query)
    const fileGroups = new Map();
    let grandTotalWords = 0;
    const grandWordSet = new Set();

    (allProcessed.data || []).forEach(row => {
      const groupName = getLogicalName(row.source_file);
      if (!fileGroups.has(groupName)) {
        fileGroups.set(groupName, { total: 0, uniqueSet: new Set() });
      }

      const group = fileGroups.get(groupName);
      const words = row.words || [];
      
      words.forEach((w: any) => {
        const txt = w.word?.trim();
        if (txt) {
          group.total++;
          group.uniqueSet.add(txt);
          grandTotalWords++;
          grandWordSet.add(txt);
        }
      });
    });

    const fileStatsReport = [...fileGroups.entries()].map(([name, stats]) => ({
      source: name,
      total_entries: stats.total,
      unique_words: stats.uniqueSet.size,
      duplicate_count: stats.total - stats.uniqueSet.size
    })).sort((a, b) => b.total_entries - a.total_entries);

    const s2Stats = (s2Queue.data || []).reduce((acc: any, curr: any) => {
      acc[curr.status] = (acc[curr.status] || 0) + 1;
      return acc;
    }, { pending: 0, processing: 0, completed: 0, failed: 0 });

    const dashboardData = {
      global: {
        total_words_found: grandTotalWords,
        total_unique_words: grandWordSet.size,
        total_duplicates: grandTotalWords - grandWordSet.size,
        api_keys_active: keys.data?.filter(k => k.is_active).length || 0,
        api_keys_in_cooldown: keys.data?.filter(k => k.cooldown_until && new Date(k.cooldown_until) > new Date()).length || 0,
      },
      file_breakdown: fileStatsReport, // This replaces the simple list with grouped stats
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