// supabase/functions/pump-questions/index.ts

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  const SOURCE_URL = Deno.env.get("SOURCE_SUPABASE_URL")!;
  const SOURCE_KEY = Deno.env.get("SOURCE_SERVICE_ROLE_KEY")!;
  const DEST_URL = Deno.env.get("DESTINATION_RECEIVER_URL")!;

  const source = createClient(SOURCE_URL, SOURCE_KEY);

  // pull questions (you can paginate later)
  const { data: questions, error } = await source
    .from("questions")
    .select("*")
    .limit(500);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  const res = await fetch(DEST_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      batch: questions
    }),
  });

  const result = await res.text();

  return new Response(result, { status: 200 });
});