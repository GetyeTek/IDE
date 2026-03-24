const AdmZip = require('adm-zip');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const fs = require('fs');

async function populate() {
    try {
        // Resolve path relative to the root of the repository
        const zipPath = path.join(process.cwd(), 'Classes', 'classes.dex.zip');
        
        console.log(`Checking for file at: ${zipPath}`);

        if (!fs.existsSync(zipPath)) {
            console.error(`ERROR: File not found at ${zipPath}`);
            // List files in the 'classes' directory to see what's actually there
            const classesDir = path.join(process.cwd(), 'Classes');
            if (fs.existsSync(classesDir)) {
                console.log(`Contents of 'classes' folder:`, fs.readdirSync(classesDir));
            } else {
                console.log(`'classes' folder does not exist at: ${classesDir}`);
            }
            process.exit(1);
        }

        const zip = new AdmZip(zipPath);
        const zipEntries = zip.getEntries();

        const filePaths = zipEntries
            .filter(entry => !entry.isDirectory)
            .map(entry => ({
                file_path: entry.entryName,
                status: 'pending'
            }));

        if (filePaths.length === 0) {
            console.log("Zip file is empty or contains no files.");
            return;
        }

        console.log(`Found ${filePaths.length} files. Connecting to Supabase...`);

        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

        const chunkSize = 500;
        for (let i = 0; i < filePaths.length; i += chunkSize) {
            const chunk = filePaths.slice(i, i + chunkSize);
            const { error } = await supabase
                .from('re_log')
                .upsert(chunk, { onConflict: 'file_path' });

            if (error) {
                console.error(`Error inserting chunk:`, error.message);
            } else {
                console.log(`Inserted ${i + chunk.length} / ${filePaths.length} files...`);
            }
        }

        console.log("Database population complete.");
    } catch (err) {
        console.error("Critical Failure:", err);
        process.exit(1);
    }
}

populate();