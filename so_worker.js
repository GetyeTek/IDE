const { createClient } = require('@supabase/supabase-js');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// 50MB buffer to prevent crash on massive Go binaries
const EXEC_OPTS = { maxBuffer: 1024 * 1024 * 50 };

async function main() {
    console.log('🕵️‍♂️ Starting SO Auditor Mode...');

    const { data: soTask } = await supabase
        .from('so_analysis')
        .select('*')
        .eq('status', 'pending')
        .limit(1)
        .single();

    if (!soTask) {
        console.log('✅ No pending files to audit. System clean.');
        return;
    }

    await auditSO(soTask);
}

async function auditSO(task) {
    const zipPath = path.join(process.cwd(), 'So', task.file_path);
    const extractDir = path.join(process.cwd(), 'So', `extracted_${task.id}`);
    
    console.log(`\n📦 Target: ${task.file_path}`);

    try {
        // 0. The Ultimate Sanity Check
        const soDir = path.join(process.cwd(), 'So');
        if (!fs.existsSync(soDir)) {
            console.error(`❌ BRO! The 'So' folder doesn't even exist! ROOT FILES:`, fs.readdirSync(process.cwd()));
        } else {
            console.log(`📂 ACTUAL contents of the 'So' folder:`, fs.readdirSync(soDir));
        }

        if (!fs.existsSync(zipPath)) {
            throw new Error(`The file [${task.file_path}] is physically MISSING from the runner! Check your .gitignore or capitalization!`);
        }

        // 1. Unzip on the fly
        console.log('🗜️ Unzipping archive...');
        fs.mkdirSync(extractDir, { recursive: true });
        execSync(`unzip -q -o "${zipPath}" -d "${extractDir}"`);
        
        // Find the actual .so file
        const findOut = execSync(`find "${extractDir}" -name "*.so"`).toString().trim();
        const soPath = findOut.split('\n')[0];
        
        if (!soPath) throw new Error('No .so file found inside the zip!');
        console.log(`🎯 Found SO: ${path.basename(soPath)}`);

        // 2. Binary Metadata Analysis
        console.log('\n📊 --- BINARY METADATA ---');
        const info = execSync(`rabin2 -I "${soPath}"`).toString();
        const isStripped = info.includes('stripped\s+true') || info.includes('stripped   true');
        const archMatch = info.match(/arch\s+(.+)/);
        const bitsMatch = info.match(/bits\s+(.+)/);
        
        console.log(`Architecture : ${archMatch ? archMatch[1].trim() : 'Unknown'} (${bitsMatch ? bitsMatch[1].trim() : '?'} bit)`);
        console.log(`Stripped     : ${isStripped ? '⚠️ YES (Debugging symbols removed)' : '✅ NO (Symbols intact)'}`);

        // 3. Go-Specific Checks
        console.log('\n🐹 --- GO LANG ANALYSIS ---');
        const sections = execSync(`rabin2 -S "${soPath}"`).toString();
        const hasPclntab = sections.includes('.gopclntab');
        console.log(`Go Pclntab   : ${hasPclntab ? '✅ FOUND (Can recover function names)' : '❌ MISSING (Hard mode enabled)'}`);

        const goVersion = execSync(`strings "${soPath}" | grep -oP "go1\\.[0-9]+(\\.[0-9]+)?" | head -n 1 || echo "Unknown"`).toString().trim();
        console.log(`Go Version   : ${goVersion}`);

        // 4. Heavy Function Shredding
        console.log('\n⚙️ Running Radare2 analysis (this might take a minute)...');
        const r2Command = `r2 -qc "aa; afl" "${soPath}"`;
        const functionsRaw = execSync(r2Command, EXEC_OPTS).toString();
        
        const lines = functionsRaw.split('\n').filter(l => l.trim());
        
        let stats = { jni: [], main:[], runtime: 0, unnamed: 0, total: lines.length };

        lines.forEach(line => {
            const parts = line.trim().split(/\s+/);
            const funcName = parts[parts.length - 1];

            if (funcName.startsWith('Java_')) {
                stats.jni.push(funcName);
            } else if (funcName.match(/^(runtime|go\.|type\.|sync\.|syscall\.|internal\.)/)) {
                stats.runtime++;
            } else if (funcName.startsWith('sym.func.') || funcName.startsWith('fcn.') || funcName.startsWith('0x')) {
                stats.unnamed++;
            } else if (funcName.startsWith('main.') || funcName.includes('/')) {
                // Go custom modules often use slashes like github.com/user/repo/module
                stats.main.push(funcName);
            }
        });

        // 5. Final Report
        console.log('\n📈 --- FUNCTION AUDIT REPORT ---');
        console.log(`Total Functions Found : ${stats.total}`);
        console.log(`Runtime/Noise (Ignored) : ${stats.runtime}`);
        console.log(`Unnamed/Stripped        : ${stats.unnamed}`);
        console.log(`\n🔥 JNI EXPORTS (${stats.jni.length}):`);
        stats.jni.length > 0 ? stats.jni.forEach(f => console.log(`  - ${f}`)) : console.log('  None found.');

        console.log(`\n🧠 USER LOGIC / MAIN (${stats.main.length}):`);
        stats.main.slice(0, 15).forEach(f => console.log(`  - ${f}`));
        if (stats.main.length > 15) console.log(`  ... and ${stats.main.length - 15} more.`);

        // Update Supabase just to mark it as audited so we don't loop it again.
        // Notice we are NOT inserting into so_functions.
        await supabase.from('so_analysis').update({ 
            status: 'audited', 
            strings_output: `Go Version: ${goVersion}\nArch: ${archMatch?.[1]}` 
        }).eq('id', task.id);

        console.log('\n✅ Audit Complete. Database marked as "audited".');

    } catch (err) {
        console.error('\n❌ Audit failed:', err.message);
        await supabase.from('so_analysis').update({ status: 'failed' }).eq('id', task.id);
    } finally {
        // Cleanup extracted files
        console.log('🧹 Cleaning up workspace...');
        execSync(`rm -rf "${extractDir}"`);
    }
}

main();
