import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

serve(async (req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  const { count: pending } = await supabase
    .from('chunk_queue')
    .select('*', { count: 'exact', head: true })
    .in('status', ['pending', 'failed'])
    .lt('retry_count', 3);

  return new Response(JSON.stringify({
    message: "Status Check",
    pending_chunks: pending,
    should_continue: (pending || 0) > 0
  }), { status: 200 });
});