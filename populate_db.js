const AdmZip = require('adm-zip');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const fs = require('fs');

async function populate() {
    try {
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
        const classesDir = path.join(process.cwd(), 'Classes');
        
        if (!fs.existsSync(classesDir)) {
            console.error(`ERROR: 'Classes' folder does not exist at: ${classesDir}`);
            process.exit(1);
        }

        for (let fileIndex = 1; fileIndex <= 8; fileIndex++) {
            const fileName = `${fileIndex}tele_class.dex.zip`;
            const zipPath = path.join(classesDir, fileName);

            if (!fs.existsSync(zipPath)) {
                console.log(`Skipping: ${fileName} (File not found)`);
                continue;
            }

            console.log(`Processing ${fileName}...`);
            const zip = new AdmZip(zipPath);
            const zipEntries = zip.getEntries();

            const dataToInsert = zipEntries
                .filter(entry => !entry.isDirectory)
                .map(entry => ({
                    file_path: entry.entryName,
                    source_index: fileIndex
                }));

            if (dataToInsert.length === 0) {
                console.log(`Zip ${fileName} is empty.`);
                continue;
            }

            const chunkSize = 500;
            for (let i = 0; i < dataToInsert.length; i += chunkSize) {
                const chunk = dataToInsert.slice(i, i + chunkSize);
                const { error } = await supabase
                    .from('tele_logs')
                    .upsert(chunk, { onConflict: 'file_path, source_index' });

                if (error) {
                    console.error(`Error inserting chunk from ${fileName}:`, error.message);
                } else {
                    console.log(`[${fileName}] Inserted ${i + chunk.length} / ${dataToInsert.length} entries...`);
                }
            }
        }

        console.log("Database population complete.");
    } catch (err) {
        console.error("Critical Failure:", err);
        process.exit(1);
    }
}

populate();