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

async function runFullHeist() {
    try {
        let allCriticalFiles = [];
        let page = 0;
        const pageSize = 1000;
        let keepFetching = true;

        console.log('🕵️ Starting Full Heist... Fetching all records in batches.');

        while (keepFetching) {
            const { data, error } = await supabase
                .from('tele_analysis')
                .select('file_path, source_index, analysis_text')
                .range(page * pageSize, (page + 1) * pageSize - 1);

            if (error) throw error;
            if (!data || data.length === 0) {
                keepFetching = false;
            } else {
                const batchCritical = data.filter(r => extractScore(r.analysis_text) >= 7);
                allCriticalFiles = allCriticalFiles.concat(batchCritical);
                console.log(`📑 Processed batch ${++page} (${allCriticalFiles.length} critical files found so far)...`);
            }
        }

        console.log(`📊 Total high-value targets identified: ${allCriticalFiles.length}`);

        const groups = allCriticalFiles.reduce((acc, curr) => {
            if (!acc[curr.source_index]) acc[curr.source_index] = [];
            acc[curr.source_index].push(curr.file_path);
            return acc;
        }, {});

        for (const [sourceIndex, paths] of Object.entries(groups)) {
            const zipPath = path.join(CLASSES_DIR, `${sourceIndex}tele_class.dex.zip`);
            if (!fs.existsSync(zipPath)) {
                console.error(`❌ Source zip missing: ${zipPath}`);
                continue;
            }

            const sourceZip = new AdmZip(zipPath);
            const outZip = new AdmZip();
            let foundCount = 0;

            console.log(`📦 Distilling Source ${sourceIndex} (${paths.length} targets)...`);

            paths.forEach(p => {
                const entry = locateEntry(sourceZip, p);
                if (entry) {
                    outZip.addFile(entry.entryName, entry.getData());
                    foundCount++;
                } else {
                    console.warn(`  ⚠️ Path mismatch in Zip ${sourceIndex}: ${p}`);
                }
            });

            if (foundCount > 0) {
                const outPath = path.join(RESULT_DIR, `distilled_source_${sourceIndex}.zip`);
                outZip.writeZip(outPath);
                console.log(`✅ Created: ${outPath} (${foundCount} files)`);
            }
        }

        console.log('🌕 The heist is complete. The loot is in "the_void".');
    } catch (err) {
        console.error('💥 Heist failed:', err.message);
        process.exit(1);
    }
}

runFullHeist();