const { createClient } = require('@supabase/supabase-js');
const AdmZip = require('adm-zip');
const path = require('path');
const fs = require('fs');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const CLASSES_DIR = path.join(process.cwd(), 'Classes');
const RESULT_DIR = path.join(process.cwd(), 'the_void');

if (!fs.existsSync(RESULT_DIR)) fs.mkdirSync(RESULT_DIR);

async function fetchAllCriticalFiles() {
    let allRecords = [];
    let page = 0;
    const pageSize = 1000;
    let keepFetching = true;

    console.log('👻 Summoning records from the abyss...');

    while (keepFetching) {
        const { data, error } = await supabase
            .from('tele_analysis')
            .select('file_path, source_index, analysis_text')
            .range(page * pageSize, (page + 1) * pageSize - 1);

        if (error) throw error;
        if (data.length === 0) {
            keepFetching = false;
        } else {
            allRecords = allRecords.concat(data);
            page++;
            console.log(`📡 Fetched batch ${page}...`);
        }
    }
    return allRecords;
}

function extractScore(text) {
    // Matches [RE_CRITICALITY][7 or <RE_CRITICALITY> 7 etc.
    const regex = /(?:\[RE_CRITICALITY\]|<RE_CRITICALITY>)\s*\[?\s*(\d+)/i;
    const match = text.match(regex);
    return match ? parseInt(match[1], 10) : 0;
}

async function runRitual() {
    try {
        const records = await fetchAllCriticalFiles();
        const filtered = records.filter(r => {
            const score = extractScore(r.analysis_text);
            return score >= 7;
        });

        console.log(`💀 Found ${filtered.length} files that are actually dangerous.`);

        // Group by source_index
        const groups = filtered.reduce((acc, curr) => {
            if (!acc[curr.source_index]) acc[curr.source_index] = [];
            acc[curr.source_index].push(curr.file_path);
            return acc;
        }, {});

        for (const [sourceIndex, filePaths] of Object.entries(groups)) {
            const sourceZipPath = path.join(CLASSES_DIR, `${sourceIndex}tele_class.dex.zip`);
            const outputZipPath = path.join(RESULT_DIR, `distilled_${sourceIndex}.zip`);

            if (!fs.existsSync(sourceZipPath)) {
                console.error(`❌ Source zip missing: ${sourceZipPath}`);
                continue;
            }

            console.log(`📦 Processing Source ${sourceIndex}...`);
            const sourceZip = new AdmZip(sourceZipPath);
            const resultZip = new AdmZip();
            let addedCount = 0;

            filePaths.forEach(filePath => {
                // Remove leading slash if exists for adm-zip matching
                const cleanPath = filePath.startsWith('/') ? filePath.substring(1) : filePath;
                const entry = sourceZip.getEntry(cleanPath);
                if (entry) {
                    resultZip.addFile(cleanPath, entry.getData());
                    addedCount++;
                } else {
                    console.warn(`  ⚠️ Could not find ${cleanPath} in source zip.`);
                }
            });

            if (addedCount > 0) {
                resultZip.writeZip(outputZipPath);
                console.log(`✅ Created ${outputZipPath} with ${addedCount} files.`);
            }
        }

        console.log('🕯️ The ritual is complete. Check "the_void" folder.');
    } catch (err) {
        console.error('🔥 The ritual failed horribly:', err);
        process.exit(1);
    }
}

runRitual();