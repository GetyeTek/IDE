const { createClient } = require('@supabase/supabase-js');
const AdmZip = require('adm-zip');
const path = require('path');
const fs = require('fs');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const CLASSES_DIR = path.join(process.cwd(), 'Classes');
const RESULT_DIR = path.join(process.cwd(), 'the_void');

if (!fs.existsSync(RESULT_DIR)) fs.mkdirSync(RESULT_DIR);

function extractScore(text) {
    const regex = /(?:\[RE_CRITICALITY\]|<RE_CRITICALITY>)\s*\[?\s*(\d+)/i;
    const match = text.match(regex);
    return match ? parseInt(match[1], 10) : 0;
}

function locateEntry(zip, targetPath) {
    // Try 1: Exact match
    let entry = zip.getEntry(targetPath);
    if (entry) return entry;

    // Try 2: Remove leading slash
    const noSlash = targetPath.startsWith('/') ? targetPath.substring(1) : targetPath;
    entry = zip.getEntry(noSlash);
    if (entry) return entry;

    // Try 3: Add leading slash
    const withSlash = targetPath.startsWith('/') ? targetPath : '/' + targetPath;
    entry = zip.getEntry(withSlash);
    if (entry) return entry;

    return null;
}

async function runScoutRitual() {
    try {
        console.log('🕵️ Entering Scout Mode... Fetching limit: 20');
        
        const { data: records, error } = await supabase
            .from('tele_analysis')
            .select('file_path, source_index, analysis_text')
            .limit(20); // TEST LIMIT

        if (error) throw error;

        const highCriticality = records.filter(r => extractScore(r.analysis_text) >= 7);
        console.log(`📊 Found ${highCriticality.length} potential high-value targets in the test batch.`);

        const groups = highCriticality.reduce((acc, curr) => {
            if (!acc[curr.source_index]) acc[curr.source_index] = [];
            acc[curr.source_index].push(curr.file_path);
            return acc;
        }, {});

        for (const [sourceIndex, paths] of Object.entries(groups)) {
            const zipPath = path.join(CLASSES_DIR, `${sourceIndex}tele_class.dex.zip`);
            if (!fs.existsSync(zipPath)) {
                console.error(`❌ Zip not found for source ${sourceIndex}: ${zipPath}`);
                continue;
            }

            const sourceZip = new AdmZip(zipPath);
            const outZip = new AdmZip();
            let foundCount = 0;

            console.log(`📦 Inspecting Zip ${sourceIndex}...`);

            paths.forEach(p => {
                const entry = locateEntry(sourceZip, p);
                if (entry) {
                    outZip.addFile(entry.entryName, entry.getData());
                    foundCount++;
                    console.log(`  ✅ Match: ${p}`);
                } else {
                    console.warn(`  ⚠️ Missing: ${p}`);
                    console.log('  🔍 DEBUG: First 5 entries in this zip:');
                    sourceZip.getEntries().slice(0, 5).forEach(e => console.log(`    - ${e.entryName}`));
                }
            });

            if (foundCount > 0) {
                const outPath = path.join(RESULT_DIR, `scout_result_${sourceIndex}.zip`);
                outZip.writeZip(outPath);
                console.log(`🧪 Test zip created: ${outPath}`);
            }
        }

        console.log('🌕 Scout mission complete.');
    } catch (err) {
        console.error('💥 Ritual interrupted:', err.message);
        process.exit(1);
    }
}

runScoutRitual();