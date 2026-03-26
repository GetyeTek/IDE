const { createClient } = require('@supabase/supabase-js');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function chew() {
    const { data: task, error } = await supabase
        .from('so_analysis')
        .select('*')
        .eq('status', 'pending')
        .limit(1)
        .single();

    if (!task || error) {
        console.log('No pending .so files found.');
        return;
    }

    const filePath = path.join(process.cwd(), 'So', task.file_path);
    console.log(`🚀 Chewing on: ${task.file_path}`);

    try {
        // Mark as processing
        await supabase.from('so_analysis').update({ status: 'processing' }).eq('id', task.id);

        // 1. Extract Strings (The most valuable part for payment keys)
        console.log('Extracting strings...');
        const strings = execSync(`rabin2 -z "${filePath}" | head -n 1000`).toString();

        // 2. Hex Dump (First 1KB for header analysis)
        console.log('Generating hex dump...');
        const hex = execSync(`r2 -qc "px 1024" "${filePath}"`).toString();

        // 3. Ghidra Decompiler Output
        // 'aaa' = analyze all, 'afl' = list functions, 'pdg' = print decompile ghidra
        console.log('Running Ghidra decompiler (this might take a while)...');
        let ghidra = "";
        try {
            ghidra = execSync(`r2 -qc "aaa; pdg" "${filePath}" | head -n 2000`).toString();
        } catch (e) {
            ghidra = "Decompiler failed or timed out.";
        }

        // Save to DB
        await supabase.from('so_analysis').update({
            status: 'completed',
            strings_output: strings,
            hex_dump: hex,
            ghidra_output: ghidra,
            updated_at: new Date().toISOString()
        }).eq('id', task.id);

        console.log(`✅ Finished: ${task.file_path}`);
    } catch (err) {
        console.error(`❌ Critical Failure on ${task.file_path}:`, err.message);
        await supabase.from('so_analysis').update({ status: 'failed' }).eq('id', task.id);
    }
}

chew();