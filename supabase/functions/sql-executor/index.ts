import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { Client } from "https://deno.land/x/postgres@v0.17.0/mod.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { query } = await req.json()
    const databaseUrl = Deno.env.get("SUPABASE_DB_URL")!
    const client = new Client(databaseUrl)
    await client.connect()

    const result = await client.queryObject(query)
    await client.end()

    // The Fix: Recursively convert all BigInts to Strings before sending
    const safeData = JSON.parse(JSON.stringify(result.rows, (_, v) => 
      typeof v === 'bigint' ? v.toString() : v
    ));

    return new Response(
      JSON.stringify({ data: safeData, count: result.rowCount }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})
