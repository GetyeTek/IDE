import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const formData = await req.formData()
    const file = formData.get('file') as File
    const deviceId = formData.get('deviceId') as string
    const category = formData.get('category') as string || 'GENERAL'

    if (!file || !deviceId) {
      return new Response(JSON.stringify({ error: 'Missing file or deviceId' }), { 
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      })
    }

    // Initialize Supabase with Service Role Key (Server-side power)
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Sanitize filename and create path: device_id/category/timestamp_name
    const timestamp = Date.now()
    const filePath = `${deviceId}/${category}/${timestamp}_${file.name}`

    // 1. Upload to Storage
    const { data: storageData, error: storageError } = await supabase.storage
      .from('cortex-vault')
      .upload(filePath, file.stream(), {
        contentType: file.type,
        upsert: false
      })

    if (storageError) throw storageError

    // 2. Register in Database
    const { error: dbError } = await supabase
      .from('file_registry')
      .insert({
        device_id: deviceId,
        file_name: file.name,
        file_path: filePath,
        category: category,
        file_size: file.size
      })

    if (dbError) throw dbError

    return new Response(JSON.stringify({ message: 'Upload successful', path: filePath }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})