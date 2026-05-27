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
    const now = new Date().toISOString();
    const { data, error } = await supabase
        .from('api_keys')
        .select('*')
        .eq('is_active', true)
        .eq('service', 'gemini')
        .or(`cooldown_until.is.null,cooldown_until.lte.${now}`)
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

        const zipFileName = 'Mezgebe.zip';
        if (!zipCache.has(zipFileName)) {
            console.log(`🔍 [${zipFileName}] Cache miss. Initializing AdmZip...`);
            const zipPath = path.join(classesDir, zipFileName);
            if (!fs.existsSync(zipPath)) throw new Error(`Zip not found: ${zipPath}`);
            zipCache.set(zipFileName, new AdmZip(zipPath));
            console.log(`📦 [${zipFileName}] Successfully cached.`);
        }
        
        const zip = zipCache.get(zipFileName);
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
        const isQuotaError = err.message.includes('429') || 
                             err.message.toLowerCase().includes('resource has been exhausted') || 
                             err.message.toLowerCase().includes('quota exceeded');

        if (isQuotaError) {
            const cooldownTime = new Date(Date.now() + 15 * 60 * 1000).toISOString();
            console.error(`⚠️  QUOTA EXHAUSTED for Key ${apiKeyRecord.id}. Cooling down until ${cooldownTime}`);
            await supabase.from('api_keys')
                .update({ cooldown_until: cooldownTime })
                .eq('id', apiKeyRecord.id);
        } else {
            console.error(`❌ Failed: ${task.file_path} | Source: ${task.source_index} | Error: ${err.message}`);
        }
        
        console.log(`♻️ Leaving ${task.file_path} as 'pending' for retry.`);
    }
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const getRandomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

async function main() {
    const { data: rawTasks } = await supabase.from('mezgebe_logs')
        .select('file_path, source_index')
        .eq('status', 'pending')
        .limit(40);

    if (!rawTasks || rawTasks.length === 0) {
        console.log('No more Mezgebe files. Chain ended.');
        return;
    }

    // 1. Shuffle tasks to break linear patterns
    const tasks = shuffleArray([...rawTasks]);
    const availableKeys = await getLeastUsedKeys();
    
    console.log(`🚀 Processing ${tasks.length} Mezgebe tasks with ${availableKeys.length} available keys.`);

    let processedCount = 0;
    while (tasks.length > 0) {
        // 2. Dynamic Wave Sizing (Randomly take 3 to 7 tasks)
        const currentWaveSize = Math.min(tasks.length, availableKeys.length, getRandomInt(3, 7));
        const currentWave = tasks.splice(0, currentWaveSize);
        
        // 3. Shuffle keys for this wave to prevent circular rotation patterns
        const waveKeys = shuffleArray([...availableKeys]).slice(0, currentWaveSize);

        console.log(`🌊 Launching wave (Size: ${currentWaveSize})...`);

        await Promise.all(currentWave.map((task, index) => {
            processedCount++;
            return processFile(task, waveKeys[index], processedCount, rawTasks.length);
        }));

        if (tasks.length > 0) {
            // 4. Randomized Jitter (4 to 12 seconds)
            let sleepTime = getRandomInt(4000, 12000);
            
            // 5. 10% Chance of a "Human Deep Breath" (30 to 60 seconds)
            if (Math.random() > 0.9) {
                sleepTime = getRandomInt(30000, 60000);
                console.log(`☕ Taking a human coffee break... (${(sleepTime/1000).toFixed(0)}s)`);
            } else {
                console.log(`⏳ Jittering... (${(sleepTime/1000).toFixed(1)}s)`);
            }
            
            await sleep(sleepTime);
        }
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