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
    const startTime = Date.now();
    try {
        const { file_path: filePath, source_index } = task;
        const maskedKey = `***${String(apiKeyRecord.id).slice(-4)}`;
        
        console.log(`[${currentCount}/${totalCount}] 📥 Process Start: ${filePath} (Source: ${source_index})`);

        if (!zipCache.has(source_index)) {
            console.log(`🔍 [Zip ${source_index}] Cache miss. Initializing AdmZip...`);
            const zipPath = path.join(classesDir, `${source_index}tele_class.dex.zip`);
            if (!fs.existsSync(zipPath)) throw new Error(`Zip not found: ${zipPath}`);
            zipCache.set(source_index, new AdmZip(zipPath));
            console.log(`📦 [Zip ${source_index}] Successfully cached.`);
        }
        
        const zip = zipCache.get(source_index);
        const entry = zip.getEntry(filePath);
        if (!entry) throw new Error(`Entry ${filePath} not in zip ${source_index}`);
        
        const content = entry.getData().toString('utf8');
        console.log(`📑 [${currentCount}/${totalCount}] File Read: ${filePath} (${content.length} bytes)`);

        const cleanKey = apiKeyRecord.api_key.trim().replace(/^"|"$/g, '');
        const genAI = new GoogleGenerativeAI(cleanKey);
        const model = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite' });

        console.log(`🤖 [${currentCount}/${totalCount}] Sending to Gemini... (Key: ${maskedKey})`);
        const prompt = `### ROLE

        const result = await model.generateContent(prompt);
        const rawResponse = result.response.text();
        console.log(`📡 [${currentCount}/${totalCount}] AI Data Received (${rawResponse.length} chars).`);
        
        const start = rawResponse.indexOf('{');
        const end = rawResponse.lastIndexOf('}');
        
        if (start === -1 || end === -1) {
            console.error("Response format failure:", rawResponse);
            throw new Error('AI response did not contain a valid JSON object');
        }
        
        const analysis = rawResponse.slice(start, end + 1);

        console.log(`💾 [${currentCount}/${totalCount}] Writing to Supabase...`);
        await supabase.from('mezgebe_analysis').insert({
            file_path: filePath,
            source_index: source_index,
            analysis_text: analysis
        });

        await supabase.from('mezgebe_logs')
            .update({ status: 'completed' })
            .match({ file_path: filePath, source_index: source_index });

        await supabase.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', apiKeyRecord.id);

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`✅ [${currentCount}/${totalCount}] Complete: ${filePath} (${duration}s)`);
    } catch (err) {
        console.error(`❌ Failed: ${task.file_path} | Source: ${task.source_index} | Error: ${err.message}`);
        console.log(`♻️ Leaving ${task.file_path} as 'pending' for retry.`);
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
    console.log(`🚀 Processing ${tasks.length} Mezgebe tasks. Wave size: ${WAVE_SIZE}`);

    for (let i = 0; i < tasks.length; i += WAVE_SIZE) {
        const currentWave = tasks.slice(i, i + WAVE_SIZE);
        console.log(`🌊 Launching wave ${Math.floor(i / WAVE_SIZE) + 1}...`);

        await Promise.all(currentWave.map((task, index) => {
            const key = keys[index % keys.length];
            const globalIndex = i + index + 1;
            return processFile(task, key, globalIndex, tasks.length);
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