import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

const CHUNK_SIZE = 30;
const SOURCE_BUCKET = 'Chunks';
const DEST_BUCKET = 'refined-chunks';

serve(async (req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  try {
    // 1. Find next file to chop
    const { data: target, error: fetchErr } = await supabase
      .from('chopping_ledger')
      .select('*')
      .eq('status', 'pending')
      .limit(1)
      .single();

    if (fetchErr || !target) {
      return new Response(JSON.stringify({ message: 'No pending files to chop' }), { status: 200 });
    }

    console.log(`[START] Chopping ${target.source_file}...`);
    await supabase.from('chopping_ledger').update({ status: 'processing' }).eq('id', target.id);

    // 2. Download source file
    const { data: fileData, error: dlErr } = await supabase.storage
      .from(SOURCE_BUCKET)
      .download(target.source_file);

    if (dlErr) throw dlErr;

    const text = await fileData.text();
    const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
    
    // 3. Process in batches to avoid memory spikes
    let chunkCount = 0;
    for (let i = 0; i < lines.length; i += CHUNK_SIZE) {
      const chunk = lines.slice(i, i + CHUNK_SIZE);
      const chunkName = `${target.source_file.replace('.txt', '')}/chunk_${String(chunkCount).padStart(4, '0')}.txt`;
      
      const { error: upErr } = await supabase.storage
        .from(DEST_BUCKET)
        .upload(chunkName, chunk.join('\n'), {
          contentType: 'text/plain',
          upsert: true
        });

      if (upErr) console.error(`Failed to upload ${chunkName}:`, upErr.message);
      chunkCount++;
    }

    // 4. Mark as completed
    await supabase.from('chopping_ledger').update({
      status: 'completed',
      total_chunks: chunkCount
    }).eq('id', target.id);

    return new Response(JSON.stringify({
      source: target.source_file,
      chunks_created: chunkCount
    }), { status: 200 });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});