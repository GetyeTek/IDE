import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// Immediate logging to verify the script actually loaded
console.log("SYSTEM: Image Monitor Edge Function Loaded Successfully");

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

serve(async (req) => {
  console.log("REQUEST_START: Method:", req.method);
  
  // Handle health checks or OPTIONS
  if (req.method === 'OPTIONS') return new Response('ok');

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    
    // 1. EXTRACT DATA
    const formData = await req.formData().catch(e => {
      console.error("FormData Parse Error:", e);
      throw new Error("Malformed multipart data");
    });
    
    const file = formData.get('file') as File;
    if (!file) throw new Error("No file provided in request");
    console.log("FILE_RECEIVED:", file.name, "Size:", file.size);

    // 2. UPLOAD TO STORAGE
    const fileName = `${Date.now()}_${file.name.replace(/\s/g, '_')}`;
    const { data: storageData, error: storageError } = await supabase.storage
      .from('images')
      .upload(fileName, file, { contentType: file.type });
    
    if (storageError) {
      console.error("Storage Error:", storageError);
      throw storageError;
    }

    // 3. KEY ROTATION
    const { data: keyData, error: keyError } = await supabase
      .from('api_keys')
      .select('*')
      .eq('service', 'gemini')
      .eq('is_active', true)
      .order('last_used_at', { ascending: true })
      .limit(1)
      .single();

    if (keyError || !keyData) throw new Error("No active Gemini keys found in DB");
    
    await supabase.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', keyData.id);

    // 4. PREPARE AI REQUEST
    const arrayBuffer = await file.arrayBuffer();
    const base64Image = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
    
    const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${keyData.api_key}`;

    // 5. AI EXECUTION (Transcription + Thinking Mode Solution)
    // To save time and avoid 500s, we do a high-intensity single-pass with Thinking Mode enabled
    const aiResponse = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: "Task: Transcribe every word and solve all questions. Format as JSON only. Schema: { 'sections': [ { 'type': 'string', 'items': [ { 'question': 'string', 'answer': 'string' } ] } ] }" },
            { inline_data: { mime_type: file.type, data: base64Image } }
          ]
        }],
        generationConfig: { response_mime_type: "application/json" },
        thinking_config: { include_thoughts: false }
      })
    });

    const aiResult = await aiResponse.json();
    
    if (!aiResult.candidates) {
      console.error("Gemini API Rejection:", JSON.stringify(aiResult));
      throw new Error(`AI Model Rejection: ${aiResult.error?.message || 'Check logs'}`);
    }

    const finalSolution = JSON.parse(aiResult.candidates[0].content.parts[0].text);

    // 6. DB PERSISTENCE
    const { error: dbError } = await supabase.from('processed_images').insert({
        image_path: storageData.path,
        transcription: "Aggregated via 2.5 thinking mode",
        solution_json: finalSolution,
        status: 'completed'
    });

    if (dbError) console.error("DB Insert Error:", dbError);

    return new Response(JSON.stringify({ success: true, file: storageData.path }), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    console.error("CRITICAL_ERROR:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
});
