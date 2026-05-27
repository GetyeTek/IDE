const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const AdmZip = require('adm-zip');
const path = require('path');
const axios = require('axios');
const fs = require('fs');

const supabase = createClient('https://vlzgfaqrnyiqfxxxvtas.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZsemdmYXFybnlpcWZ4eHh2dGFzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTU1OTk0MCwiZXhwIjoyMDgxMTM1OTQwfQ.UHSO5jjQOrBT5e06-uFoMW7nirOZbeR8OvsJNQ91c8M');
const classesDir = path.join(process.cwd(), 'Classes');
const zipCache = new Map();

async function getLeastUsedKeys() {
    const { data, error } = await supabase
        .from('api_keys')
        .select('*')
        .eq('is_active', true)
        .eq('service', 'gemini')
        .order('last_used_at', { ascending: true });
    if (error) throw error;
    
    if (!data || data.length === 0) {
        console.error('❌ CRITICAL: No active Gemini API keys found.');
        process.exit(1);
    }
    return data;
}

async function processFile(task, apiKeyRecord, currentCount, totalCount) {
    try {
        const { file_path: filePath, source_index } = task;
        const maskedKey = `***${String(apiKeyRecord.id).slice(-4)}`;
        
        if (!zipCache.has(source_index)) {
            const zipPath = path.join(classesDir, `${source_index}tele_class.dex.zip`);
            if (!fs.existsSync(zipPath)) throw new Error(`Zip not found: ${zipPath}`);
            const zipInstance = new AdmZip(zipPath);
            zipCache.set(source_index, zipInstance);
        }
        
        const zip = zipCache.get(source_index);
        const entry = zip.getEntry(filePath);
        if (!entry) throw new Error(`Entry ${filePath} not in zip ${source_index}`);
        
        const content = entry.getData().toString('utf8');
        console.log(`[${currentCount}/${totalCount}] 🛠️ Analyzing Mezgebe: ${filePath} using Key: ${maskedKey}`);

        const cleanKey = apiKeyRecord.api_key.trim().replace(/^"|"$/g, '');
        const genAI = new GoogleGenerativeAI(cleanKey);
        const model = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite' });

        const prompt = `You are an Elite Forensics Researcher and Reverse Engineer. You are analyzing 'Mezgebe', an Ethiopian scripture application. Your focus is on how the app protects religious assets, fetches scriptures from remote servers, and manages data integrity.\n\nSCOPE OF ANALYSIS:\n1. ASSET FETCHING & PROTECTION: Identify logic related to downloading content, asset decryption keys, or verification of scripture integrity.\n2. ROSETTA STONES: Look for mapping files, translation tables, or ID-to-content logic that acts as a key for reverse engineering the database structure.\n3. NETWORK INTEGRITY: Identify API endpoints for asset fetching, custom headers, or signing logic used to prevent scraping.\n4. SENSITIVE LEAKAGE: Hardcoded keys, server paths, or internal dev notes.\n5. ANTI-REVERSING: Identify XOR loops, string masking, or reflection used to hide the asset-handling logic.\n\nOUTPUT REQUIREMENT:\nYou MUST output valid JSON only with two keys: 'analysis' (a condensed, high-intensity technical breakdown) and 'score' (1-10).\n\nSCORING RULE: Assign a higher score (8-10) to files containing 'Rosetta Stones', asset decryption logic, or core server-communication protocols essential for reverse engineering. Assign lower for UI or generic helpers.\n\nFILE CONTENT:\n${content}`;

        const result = await model.generateContent(prompt);
        let analysis = result.response.text();
        
        // Sanitization: Strip markdown backticks if present
        analysis = analysis.replace(/```json|```/g, '').trim();

        await supabase.from('mezgebe_analysis').insert({
            file_path: filePath,
            source_index: source_index,
            analysis_text: analysis
        });

        await supabase.from('mezgebe_logs')
            .update({ status: 'completed' })
            .match({ file_path: filePath, source_index: source_index });

        await supabase.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', apiKeyRecord.id);

        console.log(`✅ [Zip ${source_index}] Success: ${filePath}`);
    } catch (err) {
        console.error(`❌ Failed: ${task.file_path} | Error: ${err.message}`);
    }
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
    const { data: tasks } = await supabase.from('mezgebe_logs')
        .select('file_path, source_index')
        .eq('status', 'pending')
        .limit(40);

    if (!tasks || tasks.length === 0) {
        console.log('No more Mezgebe files. Chain ended.');
        return;
    }

    const keys = await getLeastUsedKeys();
    const WAVE_SIZE = Math.min(keys.length, 10);

    for (let i = 0; i < tasks.length; i += WAVE_SIZE) {
        const currentWave = tasks.slice(i, i + WAVE_SIZE);
        await Promise.all(currentWave.map((task, index) => {
            const key = keys[index % keys.length];
            return processFile(task, key, i + index + 1, tasks.length);
        }));
        if (i + WAVE_SIZE < tasks.length) await sleep(3000);
    }

    const { data: remaining } = await supabase.from('mezgebe_logs').select('id').eq('status', 'pending').limit(1);
    if (remaining.length > 0) {
        await axios.post("https://api.github.com/repos/" + process.env.GITHUB_REPOSITORY + "/actions/workflows/mezgebe_analysis.yml/dispatches",
            { ref: process.env.GITHUB_REF_NAME || 'main' },
            { headers: { Authorization: "token " + process.env.MY_PAT, Accept: 'application/vnd.github.v3+json', 'User-Agent': 'NodeJS-Worker' } }
        ).catch(e => console.error('Chain trigger failed:', e.message));
    }
}

main();