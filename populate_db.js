const AdmZip = require('adm-zip');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

// Initialize Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function populate() {
    try {
        const zipPath = path.join(__dirname, 'classes', 'classes.dex.zip');
        console.log(`Reading zip from: ${zipPath}`);
        
        const zip = new AdmZip(zipPath);
        const zipEntries = zip.getEntries();

        // Map entries to an array of objects for Supabase, filtering out directories
        const filePaths = zipEntries
            .filter(entry => !entry.isDirectory)
            .map(entry => ({
                file_path: entry.entryName,
                status: 'pending'
            }));

        console.log(`Found ${filePaths.length} files. Starting upload...`);

        // Supabase allows bulk insert. We'll do it in chunks of 500 to be safe.
        const chunkSize = 500;
        for (let i = 0; i < filePaths.length; i += chunkSize) {
            const chunk = filePaths.slice(i, i + chunkSize);
            const { error } = await supabase
                .from('RE_log')
                .upsert(chunk, { onConflict: 'file_path' }); // Use upsert to avoid errors on retry

            if (error) {
                console.error(`Error inserting chunk ${i}:`, error.message);
            } else {
                console.log(`Inserted chunk starting at ${i}...`);
            }
        }

        console.log("Database population complete.");
    } catch (err) {
        console.error("Initialization failed:", err.message);
        process.exit(1);
    }
}

populate();