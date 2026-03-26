const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const AdmZip = require('adm-zip');
const path = require('path');
const axios = require('axios');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
// Zip path base - we'll build this dynamically
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
        console.error('❌ CRITICAL: No active Gemini API keys found in the database.');
        process.exit(1);
    }
    return data;
}

async function processFile(task, apiKeyRecord) {
    try {
        const { file_path: filePath, source_index } = task;
        
        // Get zip from cache or load it
        if (!zipCache.has(source_index)) {
            const zipPath = path.join(classesDir, `${source_index}tele_class.dex.zip`);
            if (!fs.existsSync(zipPath)) throw new Error(`Zip not found: ${zipPath}`);
            zipCache.set(source_index, new AdmZip(zipPath));
        }
        
        const zip = zipCache.get(source_index);
        const entry = zip.getEntry(filePath);
        if (!entry) throw new Error(`Entry ${filePath} not in zip ${source_index}`);
        
        const content = entry.getData().toString('utf8');
        const cleanKey = apiKeyRecord.api_key.trim().replace(/^"|"$/g, '');
        const genAI = new GoogleGenerativeAI(cleanKey);
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' }); // Updated to a stable model identifier

        const prompt = `You are a Senior Reverse Engineer specializing in legacy Android forensics. Your mission is to reconstruct the resource-loading and decryption logic of an old Ethiopian Orthodox Church offline application. The app uses components from 'Faith Comes By Hearing' (FCBH) and likely custom encryption for its internal texts.\n\nTASK:\nProvide a multi-layered technical analysis of the provided Java code. Your depth MUST be proportional to the complexity of the file.\n\nFile Content:\n${content}\n\nCRITICAL INSTRUCTION: You MUST provide a numerical importance score (1-10) and a brief justification at the VERY end, wrapped in this tag: <RE_CRITICALITY>[SCORE] - [JUSTIFICATION]</RE_CRITICALITY>.`;

        const result = await model.generateContent(prompt);
        const analysis = result.response.text();

        // Store in new tables
        await supabase.from('tele_analysis').insert({
            file_path: filePath,
            source_index: source_index,
            analysis_text: analysis
        });

        await supabase.from('tele_logs')
            .update({ status: 'completed' })
            .match({ file_path: filePath, source_index: source_index });

        await supabase.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', apiKeyRecord.id);

        console.log(`✅ [Zip ${source_index}] Processed: ${filePath}`);
    } catch (err) {
        console.error(`❌ Failed: ${task.file_path} | Source: ${task.source_index} | Error: ${err.message}`);
    }
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
    // Fetch tasks including source_index
    const { data: tasks } = await supabase.from('tele_logs')
        .select('file_path, source_index')
        .eq('status', 'pending')
        .limit(40);

    if (!tasks || tasks.length === 0) {
        console.log('No more pending files in tele_logs. Chain ended.');
        return;
    }

    const keys = await getLeastUsedKeys();
    const WAVE_SIZE = Math.min(keys.length, 10);

    console.log(`🚀 Processing ${tasks.length} tasks across 8 zips. Wave size: ${WAVE_SIZE}`);

    for (let i = 0; i < tasks.length; i += WAVE_SIZE) {
        const currentWave = tasks.slice(i, i + WAVE_SIZE);
        console.log(`🌊 Launching wave ${Math.floor(i / WAVE_SIZE) + 1}...`);

        await Promise.all(currentWave.map((task, index) => {
            const key = keys[index % keys.length];
            return processFile(task, key);
        }));

        // Small breather between waves to let the API and DB catch up
        if (i + WAVE_SIZE < tasks.length) {
            console.log('⏳ Wave complete. Resting for 3s...');
            await sleep(3000);
        }
    }

    // Trigger Next Workflow (pointing to new table)
    const { data: remaining } = await supabase.from('tele_logs').select('id').eq('status', 'pending').limit(1);
    if (remaining.length > 0) {
        console.log(`Triggering next chain run on branch: ${process.env.GITHUB_REF_NAME}...`);
        await axios.post(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/actions/workflows/re_analysis.yml/dispatches`,
            { ref: process.env.GITHUB_REF_NAME || 'main' },
            { 
                headers: { 
                    Authorization: `token ${process.env.MY_PAT}`, 
                    Accept: 'application/vnd.github.v3+json',
                    'User-Agent': 'NodeJS-Worker'
                } 
            }
        ).catch(e => {
            console.error('Chain trigger failed:', e.response ? e.response.data : e.message);
        });
    }
}

main();