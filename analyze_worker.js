const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const AdmZip = require('adm-zip');
const path = require('path');
const axios = require('axios');
const fs = require('fs');

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

async function processFile(task, apiKeyRecord, currentCount, totalCount) {
    try {
        const { file_path: filePath, source_index } = task;
        const maskedKey = `***${String(apiKeyRecord.id).slice(-4)}`;
        
        // Get zip from cache or load it
        if (!zipCache.has(source_index)) {
            const zipPath = path.join(classesDir, `${source_index}tele_class.dex.zip`);
            if (!fs.existsSync(zipPath)) throw new Error(`Zip not found: ${zipPath}`);
            const zipInstance = new AdmZip(zipPath);
            console.log(`📦 [Zip ${source_index}] Loaded. Total entries in zip: ${zipInstance.getEntries().length}`);
            zipCache.set(source_index, zipInstance);
        }
        
        const zip = zipCache.get(source_index);
        const entry = zip.getEntry(filePath);
        if (!entry) throw new Error(`Entry ${filePath} not in zip ${source_index}`);
        
        const content = entry.getData().toString('utf8');
        console.log(`[${currentCount}/${totalCount}] 🛠️ Analyzing: ${filePath} (Size: ${content.length} bytes) using Key: ${maskedKey}`);

        const cleanKey = apiKeyRecord.api_key.trim().replace(/^"|"$/g, '');
        const genAI = new GoogleGenerativeAI(cleanKey);
        const model = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite-preview' });

        const prompt = `You are an Elite Cyber-Security Architect and Senior Reverse Engineer. You are performing a deep-dive forensic analysis on a legacy, now-abandoned payment processing application for documentation and security research purposes. Your goal is to map out the application's internal mechanics, focusing specifically on high-value targets typical of financial software.\n\nSCOPE OF ANALYSIS:\nYou must examine the provided source code for any of the following technical indicators:\n1. AUTHENTICATION & SESSION MANAGEMENT: Identify how the app handles logins, JWT tokens, session persistence, or biometric handshake logic. Look for vulnerabilities in how tokens are stored or transmitted.\n2. TRANSACTION & REQUEST INTEGRITY: Document how the app signs network requests. Look for HMAC implementations, custom hashing algorithms, or any payload encryption (AES, DES, RSA) used before data hits the network wire.\n3. SENSITIVE DATA LEAKAGE: Scan for hardcoded merchant IDs, API keys, gateway endpoints, hardcoded salts, or IVs (Initialization Vectors) used in cryptographic operations.\n4. ANTI-REVERSING & OBFUSCATION: Identify use of reflection, dynamic class loading, ProGuard/DexGuard artifacts, or custom XOR loops designed to mask strings and sensitive logic.\n5. NETWORK ARCHITECTURE: Identify all hardcoded URLs, IP addresses, or proxy-detection logic. Look for SSL pinning implementations or custom trust managers that might be bypassable.\n6. FINANCIAL LOGIC: Trace the flow of variables related to balances, currency conversion, or transaction confirmations.\n\nOUTPUT STRUCTURE REQUIREMENTS:\n- [EXECUTIVE TECHNICAL SUMMARY]: A high-level overview of what this file does in the context of a payment app.\n- [DETAILED LOGIC FLOW]: A step-by-step technical breakdown of the methods and logic. Do not skip over 'boring' boilerplate if it contains sensitive constants.\n- [SECURITY RED FLAGS]: Explicitly list any discovered hardcoded secrets, weak crypto, or insecure storage patterns.\n- [REVERSE ENGINEERING INSIGHTS]: Explain how a researcher would hook or modify this file (e.g., via Frida) to intercept transaction data.\n\nCRITICAL INSTRUCTION: You MUST provide a numerical importance score (1-10) representing how 'Critical' this file is to the app's security (10 being a core encryption/payment logic file, 1 being a generic UI helper). Wrap it at the absolute end of your response like this:\n<RE_CRITICALITY>[SCORE] - [BRIEF JUSTIFICATION]</RE_CRITICALITY>\n\nFILE CONTENT TO ANALYZE:\n${content}`;

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

        console.log(`✅ [Zip ${source_index}] Success: ${filePath}`);
    } catch (err) {
        console.error(`❌ Failed: ${task.file_path} | Source: ${task.source_index} | Error: ${err.message}`);
        console.log(`♻️ Leaving ${task.file_path} as 'pending' for retry.`);
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
            const globalIndex = i + index + 1;
            return processFile(task, key, globalIndex, tasks.length);
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