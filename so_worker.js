const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// 100MB buffer because GoReSym JSON output on a 26k function binary is THICK
const EXEC_OPTS = { maxBuffer: 1024 * 1024 * 100 };

async function main() {
    console.log('🕵️‍♂️ Starting STANDALONE SO Auditor Mode (X-Ray Edition)...');

    const soDir = path.join(process.cwd(), 'So');
    
    if (!fs.existsSync(soDir)) {
        console.error(`❌ BRO! The 'So' folder doesn't even exist!`);
        return;
    }

    const files = fs.readdirSync(soDir);
    const targetFile = files.find(f => f.endsWith('.zip') || f.endsWith('.so'));
    
    if (!targetFile) {
        console.error('❌ No .zip or .so file found in the So directory.');
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
        if (fileName.endsWith('.zip')) {
            console.log('🗜️ Unzipping archive...');
            fs.mkdirSync(extractDir, { recursive: true });
            execSync(`unzip -q -o "${filePath}" -d "${extractDir}"`);
            
            const findOut = execSync(`find "${extractDir}" -name "*.so"`).toString().trim();
            soPath = findOut.split('\n')[0];
            if (!soPath) throw new Error('No .so file found inside the zip!');
        }
        
        console.log(`🎯 Analyzing SO: ${path.basename(soPath)}`);

        // 1. JNI Export Hunt
        console.log('\n🔎 --- JNI EXPORT HUNT ---');
        try {
            const exports = execSync(`rabin2 -E "${soPath}" | grep "Java_"`).toString().trim();
            console.log(exports ? exports : 'No Java_ exports found.');
        } catch (e) {
            console.log('No Java_ exports found.');
        }

        // 2. Get GoReSym by Compiling from Source
        console.log('\n🪓 --- COMPILING GORESYM (MANDIANT) ---');
        // Get global Go path to completely bypass the local project directory
        const goPath = execSync('go env GOPATH').toString().trim() || path.join(process.env.HOME || '/root', 'go');
        const goReSymPath = path.join(goPath, 'bin', 'GoReSym');
        
        if (!fs.existsSync(goReSymPath)) {
            console.log('Building from source to bypass dirty workspace... (Guarantees fresh binary)');
            execSync(`go install github.com/mandiant/GoReSym@latest`);
            console.log(`✅ GoReSym armed at: ${goReSymPath}`);
        } else {
            console.log(`✅ GoReSym already exists at: ${goReSymPath}`);
        }

        // 3. Extract Hidden Symbols
        console.log('\n🧬 --- EXTRACTING HIDDEN GO SYMBOLS ---');
        console.log('Brute-forcing .rodata for gopclntab magic bytes...');
        
        // -p prints JSON output
        const resymOut = execSync(`"${goReSymPath}" -t -d -p "${soPath}"`, EXEC_OPTS).toString();
        const symData = JSON.parse(resymOut);
        
        const funcs = symData.Functions ||[];
        console.log(`\n✅ GoReSym successfully mapped ${funcs.length} total functions!`);
        
        let stats = { runtime: 0, custom:[] };
        let packageMap = {};

        funcs.forEach(f => {
            const name = f.FullName || '';
            // Filter out Go standard library noise
            if (name.match(/^(runtime|go\.|type\.|sync\.|syscall\.|internal\.|math|fmt|reflect|strings|strconv|time|os|io|crypto)\b/)) {
                stats.runtime++;
            } else if (name) {
                stats.custom.push(name);
                
                // Extract the Go package name
                const lastSlash = name.lastIndexOf('/');
                if (lastSlash !== -1) {
                    const pkgPart = name.substring(0, name.indexOf('.', lastSlash));
                    packageMap[pkgPart] = (packageMap[pkgPart] || 0) + 1;
                } else {
                    const pkgPart = name.split('.')[0];
                    packageMap[pkgPart] = (packageMap[pkgPart] || 0) + 1;
                }
            }
        });

        console.log(`\n📈 --- GORESYM AUDIT REPORT ---`);
        console.log(`Runtime/Standard Lib : ${stats.runtime}`);
        console.log(`Custom/Developer     : ${stats.custom.length}`);

        console.log(`\n📦 --- TOP CUSTOM PACKAGES ---`);
        const sortedPkgs = Object.entries(packageMap).sort((a,b) => b[1] - a[1]).slice(0, 20);
        sortedPkgs.forEach(([pkg, count]) => {
            console.log(`  - ${pkg} (${count} funcs)`);
        });

        console.log(`\n🧠 --- SAMPLE OF PURE GO LOGIC ---`);
        stats.custom.slice(0, 30).forEach(f => console.log(`  - ${f}`));

        console.log('\n✅ X-Ray Audit Complete.');

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
