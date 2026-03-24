const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const AdmZip = require('adm-zip');
const path = require('path');
const axios = require('axios');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const zipPath = path.join(process.cwd(), 'Classes', 'classes.dex.zip');

async function getLeastUsedKeys(count) {
    const { data, error } = await supabase
        .from('api_keys')
        .select('*')
        .eq('is_active', true)
        .order('last_used_at', { ascending: true });
    if (error) throw error;
    return data;
}

async function processFile(filePath, zip, apiKeyRecord) {
    try {
        const entry = zip.getEntry(filePath);
        if (!entry) return;
        const content = entry.getData().toString('utf8');

        const genAI = new GoogleGenerativeAI(apiKeyRecord.api_key);
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

        const prompt = `Analyze this Java file from an old mobile app. The app uses components like 'Faith Comes By Hearing'. \n\nObjective: Identify logic related to resource loading, decryption, or data obfuscation. We need to understand how the app ultimately accesses its internal text/media resources. \n\nFile Content:\n${content}`;

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
        console.error(`❌ Failed: ${filePath}`, err.message);
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
        console.log('Triggering next chain run...');
        await axios.post(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/actions/workflows/re_analysis.yml/dispatches`,
            { ref: 'main' },
            { headers: { Authorization: `token ${process.env.GH_PAT}`, Accept: 'application/vnd.github.v3+json' } }
        ).catch(e => console.error('Chain trigger failed:', e.message));
    }
}

main();