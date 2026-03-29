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

        // 3.5 Direct ELF Export Hunt
        console.log('\n🔎 --- JNI EXPORT HUNT ---');
        try {
            const exports = execSync(`rabin2 -E "${soPath}" | grep "Java_"`).toString().trim();
            console.log(exports ? exports : 'No Java_ exports found in standard ELF export table.');
        } catch (e) {
            console.log('No Java_ exports found in standard ELF export table.');
        }

        // 4. Heavy Function Shredding
        console.log('\n⚙️ Running Radare2 analysis (this might take a minute)...');
        const r2Command = `r2 -qc "aa; afl" "${soPath}"`;
        const functionsRaw = execSync(r2Command, EXEC_OPTS).toString();
        
        const lines = functionsRaw.split('\n').filter(l => l.trim());
        
        let stats = { jni:[], main:[], runtime: 0, unnamed: 0, total: lines.length, sample:[] };

        lines.forEach(line => {
            const parts = line.trim().split(/\s+/);
            const rawName = parts[parts.length - 1];
            
            // Strip r2 prefixes to see the real Go name
            const cleanName = rawName.replace(/^(sym\.|exp\.|imp\.|fcn\.)/, '');

            if (cleanName.startsWith('Java_')) {
                stats.jni.push(cleanName);
            } else if (cleanName.match(/^(runtime|go\.|type\.|sync\.|syscall\.|internal\.)/)) {
                stats.runtime++;
            } else if (cleanName.startsWith('main.') || cleanName.includes('/')) {
                stats.main.push(cleanName);
            } else {
                stats.unnamed++;
                if (stats.sample.length < 20 && !cleanName.startsWith('0x')) {
                    stats.sample.push(rawName);
                }
            }
        });

        // 5. Final Report
        console.log('\n📈 --- FUNCTION AUDIT REPORT ---');
        console.log(`Total Functions Found : ${stats.total}`);
        console.log(`Runtime/Noise (Ignored) : ${stats.runtime}`);
        console.log(`Other/Unknown           : ${stats.unnamed}`);
        
        console.log(`\n🔥 JNI EXPORTS (${stats.jni.length}):`);
        stats.jni.length > 0 ? [...new Set(stats.jni)].forEach(f => console.log(`  - ${f}`)) : console.log('  None found via r2 afl.');

        console.log(`\n🧠 USER LOGIC / MAIN (${stats.main.length}):`);
[...new Set(stats.main)].slice(0, 15).forEach(f => console.log(`  - ${f}`));
        if (stats.main.length > 15) console.log(`  ... and ${stats.main.length - 15} more.`);

        console.log(`\n👽 RANDOM UNKNOWN SAMPLE (First 20):`);
        stats.sample.forEach(f => console.log(`  - ${f}`));

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
