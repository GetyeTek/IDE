import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { Client } from "https://deno.land/x/postgres@v0.17.0/mod.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const databaseUrl = Deno.env.get("SUPABASE_DB_URL")!
  const client = new Client(databaseUrl)

  try {
    const { query } = await req.json()
    await client.connect()

    // Switch to queryObject so results are self-describing {key: value}
    const result = await client.queryObject(query);
    const columns = result.columns ? result.columns.map(col => col.name) : [];

    // Safe serialization for BigInt and other non-JSON types
    const payload = JSON.stringify({
      data: result.rows,
      columns: columns,
      count: result.rowCount
    }, (_, v) => typeof v === 'bigint' ? v.toString() : v);

    return new Response(
      payload,
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  } finally {
    try {
      await client.end()
    } catch (e) {
      console.error("Error closing connection:", e)
    }
  }
})