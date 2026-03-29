const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const EXEC_OPTS = { maxBuffer: 1024 * 1024 * 50 };

async function main() {
    console.log('🕵️‍♂️ Starting STANDALONE SO Auditor Mode (Brute Force Edition)...');

    const soDir = path.join(process.cwd(), 'So');
    
    if (!fs.existsSync(soDir)) {
        console.error(`❌ The 'So' folder doesn't exist.`);
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

        // 1. Aggressive String Harvesting (Network & APIs)
        console.log('\n🌐 --- AGGRESSIVE STRING HARVESTING ---');
        console.log('Hunting for hardcoded URLs, IPs, and API endpoints...');
        try {
            // grep for http/https URLs and common api paths
            const stringsOut = execSync(`strings "${soPath}" | grep -E -i "https?://|api\\.|\.huawei\.com|/v1/|/v2/" | sort | uniq | head -n 30`).toString().trim();
            console.log(stringsOut ? stringsOut : 'No obvious URLs found.');
        } catch (e) {
            console.log('String harvesting failed or found nothing.');
        }

        console.log('\n🔑 --- HUNTING FOR SECRETS / KEYS ---');
        try {
            // grep for words like secret, token, key, password
            const secretsOut = execSync(`strings "${soPath}" | grep -E -i "secret_?key|api_?key|access_?token|client_?id" | sort | uniq | head -n 15`).toString().trim();
            console.log(secretsOut ? secretsOut : 'No obvious keys found in plaintext.');
        } catch (e) {
            console.log('Secret harvesting found nothing.');
        }

        // 2. Targeted Decompilation of JNI Exports
        console.log('\n🧪 --- TARGETED GHIDRA DECOMPILATION ---');
        const targets =[
            'sym.Java_com_huawei_cubeim_client_sdk_Sdk__1init',
            'sym.Java_com_huawei_cubeim_client_api_LoginReq_getLocale'
        ];

        for (const target of targets) {
            console.log(`\n🔪 Dissecting: ${target}`);
            try {
                // Try Ghidra decompiler (pdg) first
                let code = execSync(`r2 -qc "aaa; s ${target}; pdg" "${soPath}"`, EXEC_OPTS).toString().trim();
                
                if (!code || code.includes('Invalid command') || code.includes('Cannot find')) {
                    console.log(`⚠️ Ghidra plugin (pdg) failed or symbol missing. Falling back to built-in pseudo-C (pdc)...`);
                    // Fallback to r2's built in pseudo-C decompiler
                    code = execSync(`r2 -qc "aaa; s ${target}; pdc" "${soPath}"`, EXEC_OPTS).toString().trim();
                }

                if (code) {
                    // Just print the first 40 lines of the decompilation so we don't blow up the CI logs
                    console.log(code.split('\n').slice(0, 40).join('\n'));
                    if (code.split('\n').length > 40) console.log('... [TRUNCATED]');
                } else {
                    console.log('❌ Could not decompile. Symbol might be stripped or named differently.');
                }
            } catch (err) {
                console.log(`❌ Decompilation crashed: ${err.message}`);
            }
        }

        console.log('\n✅ Brute Force Audit Complete.');

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
