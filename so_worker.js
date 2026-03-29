const { createClient } = require('@supabase/supabase-js');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
    // 1. Check if we have functions to decompile first
    const { data: funcTask } = await supabase
        .from('so_functions')
        .select('*, so_analysis(file_path)')
        .eq('status', 'pending')
        .limit(1)
        .single();

        if (soTask) {
        await auditSO(soTask);
    } else {
        console.log('No binaries to audit. Peace out.');
    }
}

async function auditSO(task) {
    const zipPath = path.join(process.cwd(), 'So', task.file_path);
    const extractDir = path.join(process.cwd(), 'tmp_audit');
    
    if (!fs.existsSync(extractDir)) fs.mkdirSync(extractDir);

    console.log(`🚀 AUDITOR MODE STARTING: ${task.file_path}`);

    try {
        // 1. Unzip on the fly
        console.log('📦 Unzipping binary...');
        execSync(`unzip -o "${zipPath}" -d "${extractDir}"`);
        
        // Find the actual .so file in the extracted mess
        const files = fs.readdirSync(extractDir);
        const soFileName = files.find(f => f.endsWith('.so'));
        if (!soFileName) throw new Error('No .so file found in zip');
        const binPath = path.join(extractDir, soFileName);

        // 2. Binary Info Gathering
        const binInfo = execSync(`rabin2 -I "${binPath}"`).toString();
        const goVersion = execSync(`strings "${binPath}" | grep -m 1 "go1." || echo "Unknown"`).toString().trim();
        const sections = execSync(`r2 -qc "iS" "${binPath}"`).toString();
        const exports = execSync(`r2 -qc "iE" "${binPath}" | grep Java_ || echo "None"`).toString();

        // 3. Deep Function Analysis (Recovering Go symbols with 'ann')
        console.log('🔍 Performing deep Go-symbol recovery...');
        const functionsRaw = execSync(`r2 -qc "aa; ann; afl" "${binPath}"`).toString();
        const functionLines = functionsRaw.split('\n').filter(line => line.trim());

        const categories = {
            jni: [],
            logic: [],
            runtime: 0
        };

        functionLines.forEach(line => {
            const parts = line.trim().split(/\s+/);
            const name = parts[parts.length - 1];
            if (!name || name.startsWith('0x')) return;

            if (name.startsWith('Java_')) categories.jni.push(name);
            else if (['runtime.', 'go.', 'type.', 'sync.', 'reflect.'].some(p => name.startsWith(p))) categories.runtime++;
            else categories.logic.push(name);
        });

        // 4. THE AUDIT LOG REPORT
        console.log('\n' + '='.repeat(50));
        console.log(`AUDIT REPORT FOR: ${soFileName}`);
        console.log('='.repeat(50));
        console.log(`GO VERSION: ${goVersion}`);
        console.log(`PCLNTAB: ${sections.includes('gopclntab') ? '✅ PRESENT (Symbols Recoverable)' : '❌ MISSING (Stripped Binary)')}`);
        console.log(`TOTAL FUNCTIONS: ${functionLines.length}`);
        console.log(`RUNTIME BLOAT: ${categories.runtime} functions`);
        console.log(`USER LOGIC: ${categories.logic.length} functions`);
        console.log('\n--- JNI EXPORT POINTS ---');
        console.log(categories.jni.join('\n') || 'None found.');
        console.log('\n--- TOP USER FUNCTIONS (Sample) ---');
        console.log(categories.logic.slice(0, 15).join('\n'));
        console.log('='.repeat(50) + '\n');

        // Update Supabase so we don't repeat this task
        await supabase.from('so_analysis').update({ 
            status: 'audited', 
            strings_output: `Audit completed. Found ${categories.logic.length} logic functions.`
        }).eq('id', task.id);

        // Cleanup
        fs.rmSync(extractDir, { recursive: true, force: true });

    } catch (err) {
        console.error('❌ AUDIT FAILED:', err.message);
        await supabase.from('so_analysis').update({ status: 'failed' }).eq('id', task.id);
    }
}

async function decompileFunction(task) {
    const soPath = path.join(process.cwd(), 'So', task.so_analysis.file_path);
    console.log(`🧪 Decompiling [${task.so_analysis.file_path}]: ${task.function_name}`);

    try {
        // 's [func_offset]' = seek, 'pdg' = print decompile ghidra
        const code = execSync(`r2 -qc "aaa; s ${task.func_offset}; pdg" "${soPath}"`).toString();
        
        await supabase.from('so_functions').update({
            ghidra_code: code,
            status: 'completed'
        }).eq('id', task.id);
        
        console.log('✅ Function complete.');
    } catch (err) {
        console.error('Decompile failed:', err.message);
        await supabase.from('so_functions').update({ status: 'failed' }).eq('id', task.id);
    }
}

main();