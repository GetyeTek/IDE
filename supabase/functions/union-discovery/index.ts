import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

async function discoverUnionFiles() {
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  
  // Get next batch of 10 pending folders
  const { data: pendingFolders, error: fetchErr } = await supabase
    .from('union_discovery_tracker')
    .select('folder_name')
    .eq('status', 'pending')
    .limit(10);

  if (fetchErr || !pendingFolders || pendingFolders.length === 0) {
    console.log('--- NO PENDING FOLDERS OR DISCOVERY COMPLETE ---');
    return;
  }

  console.log(`--- DISCOVERING BATCH: ${pendingFolders.length} FOLDERS ---`);

  for (const record of pendingFolders) {
    const folder = record.folder_name;
    const path = `union/${folder}`;
    const { data: files, error } = await supabase.storage.from('V2').list(path);

    if (error) {
      console.error(`Error listing ${path}:`, error?.message || 'Unknown storage error');
      continue;
    }

    if (!files || !Array.isArray(files) || files.length === 0) {
      console.log(`[SKIP] No files found in ${path}`);
      continue;
    }

    const insertData = files
      .filter(f => f && f.name && f.name.endsWith('.txt'))
      .map(f => ({
        folder_name: folder,
        file_path: `${path}/${f.name}`,
        status: 'pending'
      }));

    if (insertData.length > 0) {
      const { error: insertErr } = await supabase
        .from('union_refinery_queue')
        .upsert(insertData, { onConflict: 'file_path' });

      if (insertErr) {
         console.error(`Error inserting ${folder}:`, insertErr?.message);
         continue;
      }
      console.log(`✅ Discovered ${insertData.length} files in ${folder}`);
      
      // Mark as discovered
      await supabase.from('union_discovery_tracker').update({ status: 'discovered' }).eq('folder_name', folder);
    }

    await new Promise(r => setTimeout(r, 200));
  }
}

discoverUnionFiles();