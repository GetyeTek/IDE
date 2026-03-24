const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const AdmZip = require('adm-zip');
const path = require('path');
const axios = require('axios');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const zipPath = path.join(process.cwd(), 'Classes', 'classes.dex.zip');

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

async function processFile(filePath, zip, apiKeyRecord) {
    try {
        const entry = zip.getEntry(filePath);
        if (!entry) return;
        const content = entry.getData().toString('utf8');

        // Clean the key: remove quotes and whitespace that often come from CSV imports
        const cleanKey = apiKeyRecord.api_key.trim().replace(/^"|"$/g, '');
        const genAI = new GoogleGenerativeAI(cleanKey);
        const model = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite-preview' });

        const prompt = `You are a Senior Reverse Engineer specializing in legacy Android forensics. Your mission is to reconstruct the resource-loading and decryption logic of an old Ethiopian Orthodox Church offline application. The app uses components from 'Faith Comes By Hearing' (FCBH) and likely custom encryption for its internal texts.\n\nTASK:\nProvide a multi-layered technical analysis of the provided Java code. Your depth MUST be proportional to the complexity of the file. If it's a 5-line boilerplate, be brief. If it's a core logic class, be exhaustive.\n\nKEY AREAS OF ANALYSIS:\n1. CRYPTOGRAPHIC TRACES: Identify any use of Cipher, SecretKey, MessageDigest, AES, XOR loops, or custom math-heavy encoding.\n2. RESOURCE FLOW: How does this file interact with AssetManager, getResources(), or raw stream readers? Look for custom decoders or wrappers.\n3. DEPENDENCY MAPPING: Which other classes or packages does this file reference? Identify the 'Great Puzzle' connections.\n4. NAMING & OBFUSCATION: Spot renamed methods or variables that look like they are masking sensitive data handling or key derivation.\n5. INSIGHTS: Explain exactly how this file helps us find the master decryption key or the entry point for extracting the raw database/texts.\n\nOUTPUT STRUCTURE:\n- [Technical Summary]\n- [Detailed Observations & Logic Flow]\n- [Dependencies & External References]\n- [Red Flags & RE Insights]\n\nCRITICAL INSTRUCTION: You MUST provide a numerical importance score (1-10) and a brief justification at the VERY end, wrapped in this tag: <RE_CRITICALITY>[SCORE] - [JUSTIFICATION]</RE_CRITICALITY>.\n\nFile Content:\n${content}`;

        const result = await model.generateContent(prompt);
        const analysis = result.response.text();

        // Store Result
        await supabase.from('re_store').insert({ file_path: filePath, analysis_text: analysis });
        // Mark Completed
        await supabase.from('re_log').update({ status: 'completed' }).eq('file_path', filePath);
        // Update Key Usage
        await supabase.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', apiKeyRecord.id);

        console.log(`✅ Processed: ${filePath}`);
    } catch (err) {
        console.error(`❌ Failed: ${filePath} | Key ID: ${apiKeyRecord.id} | Error: ${err.message}`);
        // Leave as pending for next run
    }
}

async function main() {
    const { data: tasks } = await supabase.from('re_log').select('file_path').eq('status', 'pending').limit(40);
    if (!tasks || tasks.length === 0) {
        console.log('No more pending files. Chain ended.');
        return;
    }

    const keys = await getLeastUsedKeys();
    const zip = new AdmZip(zipPath);
    const workers = 4;
    const tasksPerWorker = 10;

    for (let i = 0; i < workers; i++) {
        const batch = tasks.slice(i * tasksPerWorker, (i + 1) * tasksPerWorker);
        const key = keys[i % keys.length]; // LUF rotation
        
        await Promise.all(batch.map(task => processFile(task.file_path, zip, key)));
    }

    // Trigger Next Workflow
    const { data: remaining } = await supabase.from('re_log').select('id').eq('status', 'pending').limit(1);
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