const { createClient } = require('@supabase/supabase-js');
const { execSync } = require('child_process');
const path = require('path');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
    // 1. Check if we have functions to decompile first
    const { data: funcTask } = await supabase
        .from('so_functions')
        .select('*, so_analysis(file_path)')
        .eq('status', 'pending')
        .limit(1)
        .single();

    if (funcTask) {
        await decompileFunction(funcTask);
        return;
    }

    // 2. If no functions pending, find a new .so to shred
    const { data: soTask } = await supabase
        .from('so_analysis')
        .select('*')
        .eq('status', 'pending')
        .limit(1)
        .single();

    if (soTask) {
        await shredSO(soTask);
    } else {
        console.log('No work left. System clean.');
    }
}

async function shredSO(task) {
    const filePath = path.join(process.cwd(), 'So', task.file_path);
    console.log(`🔪 Shredding: ${task.file_path}`);

    try {
        // Extract strings and hex once
        const strings = execSync(`rabin2 -z "${filePath}" | head -n 2000`).toString();
        const hex = execSync(`r2 -qc "px 1024" "${filePath}"`).toString();

        // Get function list: 'afl' (Analyze Functions List)
        console.log('Analyzing functions (aaa)...');
        const functionsRaw = execSync(`r2 -qc "aaa; afl" "${filePath}"`).toString();
        
        const functionLines = functionsRaw.split('\n').filter(line => line.trim());
        const functionData = functionLines.map(line => {
            const parts = line.trim().split(/\s+/);
            return {
                so_id: task.id,
                func_offset: parts[0],
                function_name: parts[parts.length - 1],
                status: 'pending'
            };
        }).filter(f => f.function_name && f.function_name.startsWith('0x') === false);

        console.log(`Found ${functionData.length} functions. Populating queue...`);

        // Batch insert functions
        const { error: insErr } = await supabase.from('so_functions').upsert(functionData, { onConflict: 'so_id, function_name' });
        if (insErr) throw insErr;

        await supabase.from('so_analysis').update({ 
            status: 'shredded', 
            strings_output: strings, 
            hex_dump: hex 
        }).eq('id', task.id);

    } catch (err) {
        console.error('Shred failed:', err.message);
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