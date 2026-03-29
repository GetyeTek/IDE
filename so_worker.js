const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const EXEC_OPTS = { maxBuffer: 1024 * 1024 * 50 };

async function main() {
    console.log('🕵️‍♂️ Starting STANDALONE SO Auditor Mode (The Heist Edition)...');

    const soDir = path.join(process.cwd(), 'So');
    const outDir = path.join(process.cwd(), 'Extracted_Logic');
    
    if (!fs.existsSync(soDir)) {
        console.error(`❌ The 'So' folder doesn't exist.`);
        return;
    }

    // Setup the loot bag
    if (fs.existsSync(outDir)) {
        execSync(`rm -rf "${outDir}"`);
    }
    fs.mkdirSync(outDir, { recursive: true });

    const files = fs.readdirSync(soDir);
    const targetFile = files.find(f => f.endsWith('.zip') || f.endsWith('.so'));
    
    if (!targetFile) {
        console.error('❌ No .zip or .so file found in the So directory.');
        return;
    }

    await extractLogic(targetFile, outDir);
}

async function extractLogic(fileName, outDir) {
    const filePath = path.join(process.cwd(), 'So', fileName);
    const extractDir = path.join(process.cwd(), 'So', 'extracted_temp');
    let soPath = filePath;
    
    try {
        if (fileName.endsWith('.zip')) {
            console.log('🗜️ Unzipping archive...');
            fs.mkdirSync(extractDir, { recursive: true });
            execSync(`unzip -q -o "${filePath}" -d "${extractDir}"`);
            
            const findOut = execSync(`find "${extractDir}" -name "*.so"`).toString().trim();
            soPath = findOut.split('\n')[0];
            if (!soPath) throw new Error('No .so file found inside the zip!');
        }
        
        console.log(`🎯 Target Locked: ${path.basename(soPath)}`);

        // 1. Get ALL functions
        console.log('\n⚙️ Mapping all functions (aaa; afl)...');
        const aflOut = execSync(`r2 -qc "aaa; afl" "${soPath}"`, EXEC_OPTS).toString();
        const lines = aflOut.split('\n').filter(l => l.trim());
        
        let targets =[];
        
        // 2. Filter for only the critical stuff
        console.log('🧹 Filtering out the garbage...');
        lines.forEach(line => {
            const parts = line.trim().split(/\s+/);
            const funcName = parts[parts.length - 1];
            
            // Lowercase for easier matching
            const lower = funcName.toLowerCase();
            
            if (lower.includes('java_com_huawei') || lower.includes('huawei') || lower.includes('sarama')) {
                targets.push(funcName);
            }
        });

        console.log(`🔥 Found ${targets.length} critical Huawei/Kafka functions out of ${lines.length} total.`);

        if (targets.length === 0) {
            console.log('❌ No targets matched the filter. Exiting.');
            return;
        }

        // Cap it at 500 so we don't blow up the CI runner time limit
        if (targets.length > 500) {
            console.log('⚠️ Truncating to top 500 functions to prevent CI timeout.');
            targets = targets.slice(0, 500);
        }

        // 3. Generate Radare2 Batch Script
        console.log('\n📝 Generating massive extraction script...');
        let r2Script = 'aaa\ne scr.color=0\n';
        
        targets.forEach(target => {
            // Make the filename safe for Linux
            const safeName = target.replace(/[^a-zA-Z0-9_]/g, '_');
            r2Script += `pdc @ ${target} > ${path.join(outDir, safeName + '.c')}\n`;
            r2Script += `pdf @ ${target} > ${path.join(outDir, safeName + '.asm')}\n`;
        });

        const scriptPath = path.join(process.cwd(), 'extract.r2');
        fs.writeFileSync(scriptPath, r2Script);

        // 4. Execute the Heist
        console.log(`\n⏳ Dumping C-code and Assembly for ${targets.length} functions to disk... (This will take a few minutes)`);
        execSync(`r2 -q -i "${scriptPath}" "${soPath}"`, EXEC_OPTS);

        console.log(`\n✅ HEIST COMPLETE. Extracted files are waiting in /Extracted_Logic`);
        console.log(`📦 GitHub Actions will now zip them up for you.`);

    } catch (err) {
        console.error('\n❌ Extraction failed:', err.message);
    } finally {
        if (fileName.endsWith('.zip')) {
            console.log('🧹 Cleaning up temp unzipped files...');
            execSync(`rm -rf "${extractDir}"`);
        }
    }
}

main();
