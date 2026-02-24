import { createClient } from "https://esm.sh/@supabase/supabase-client@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  // Handle CORS Preflight (Standard for browsers)
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // 1. Get data from URL parameters
    const url = new URL(req.url);
    const dataValue = url.searchParams.get("data") || "No Data";

    // 2. Initialize Supabase Admin (bypasses RLS)
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // 3. Perform the Write
    const { error } = await supabase
      .from("logs")
      .insert([{ data: dataValue }]);

    if (error) throw error;

    return new Response(JSON.stringify({ status: "success", wrote: dataValue }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }
});