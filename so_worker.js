const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// 50MB buffer to prevent crash on massive Go binaries
const EXEC_OPTS = { maxBuffer: 1024 * 1024 * 50 };

async function main() {
    console.log('🕵️‍♂️ Starting STANDALONE SO Auditor Mode (No Database)...');

    const soDir = path.join(process.cwd(), 'So');
    
    // 0. Reality Check
    if (!fs.existsSync(soDir)) {
        console.error(`❌ BRO! The 'So' folder doesn't even exist! ROOT FILES:`, fs.readdirSync(process.cwd()));
        return;
    }

    const files = fs.readdirSync(soDir);
    console.log(`📂 ACTUAL contents of the 'So' folder:`, files);

    const targetFile = files.find(f => f.endsWith('.zip') || f.endsWith('.so'));
    
    if (!targetFile) {
        console.error('❌ No .zip or .so file found in the So directory. I have nothing to do.');
        return;
    }

    await auditSO(targetFile);
}

async function auditSO(fileName) {
    const filePath = path.join(process.cwd(), 'So', fileName);
    const extractDir = path.join(process.cwd(), 'So', 'extracted_temp');
    let soPath = filePath;
    
    console.log(`\n📦 Target locked: ${fileName}`);

    try {
        // 1. Handle Zip vs Raw SO
        if (fileName.endsWith('.zip')) {
            console.log('🗜️ Unzipping archive...');
            fs.mkdirSync(extractDir, { recursive: true });
            execSync(`unzip -q -o "${filePath}" -d "${extractDir}"`);
            
            const findOut = execSync(`find "${extractDir}" -name "*.so"`).toString().trim();
            soPath = findOut.split('\n')[0];
            
            if (!soPath) throw new Error('No .so file found inside the zip!');
        }
        
        console.log(`🎯 Analyzing SO: ${path.basename(soPath)}`);

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
        
        let stats = { jni:[], main:[], runtime: 0, unnamed: 0, total: lines.length };

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

        console.log('\n✅ Standalone Audit Complete.');

    } catch (err) {
        console.error('\n❌ Audit failed:', err.message);
    } finally {
        if (fileName.endsWith('.zip')) {
            console.log('🧹 Cleaning up extracted files...');
            execSync(`rm -rf "${extractDir}"`);
        }
    }
}

main();
