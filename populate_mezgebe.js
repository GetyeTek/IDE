const { createClient } = require('@supabase/supabase-js');
const AdmZip = require('adm-zip');
const path = require('path');
const fs = require('fs');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const zipPath = path.join(process.cwd(), 'Classes', 'Mezgebe.zip');
const BATCH_SIZE = 1000;

async function main() {
    console.log('🚀 Starting Mezgebe Queue Population...');

    if (!fs.existsSync(zipPath)) {
        console.error(`❌ Zip file not found at: ${zipPath}`);
        process.exit(1);
    }

    // 1. Fetch existing paths to prevent duplicates
    console.log('🔍 Checking existing entries in database...');
    const { data: existing, error: fetchError } = await supabase
        .from('mezgebe_logs')
        .select('file_path');

    if (fetchError) throw fetchError;
    const existingPaths = new Set(existing.map(row => row.file_path));
    console.log(`✅ Found ${existingPaths.size} existing files in queue.`);

    // 2. Read Zip Content
    console.log(`📦 Opening ${zipPath}...`);
    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries();
    
    const newEntries = [];
    for (const entry of entries) {
        // Skip directories and system files
        if (entry.isDirectory || entry.entryName.includes('__MACOSX')) continue;
        
        if (!existingPaths.has(entry.entryName)) {
            newEntries.push({
                file_path: entry.entryName,
                source_index: 0,
                status: 'pending'
            });
        }
    }

    if (newEntries.length === 0) {
        console.log('✨ No new files found to add. Database is up to date.');
        return;
    }

    console.log(`📈 Found ${newEntries.length} new files. Starting batched upload...`);

    // 3. Batched Insertion
    for (let i = 0; i < newEntries.length; i += BATCH_SIZE) {
        const chunk = newEntries.slice(i, i + BATCH_SIZE);
        const { error: insertError } = await supabase
            .from('mezgebe_logs')
            .insert(chunk);

        if (insertError) {
            console.error(`❌ Error inserting batch ${Math.floor(i/BATCH_SIZE) + 1}:`, insertError.message);
        } else {
            console.log(`✅ Progress: ${Math.min(i + BATCH_SIZE, newEntries.length)} / ${newEntries.length} added.`);
        }
    }

    console.log('🏁 Population complete.');
}

main().catch(err => {
    console.error('💥 Critical failure:', err.message);
    process.exit(1);
});