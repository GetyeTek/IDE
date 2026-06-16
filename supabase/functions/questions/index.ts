// supabase/functions/migrate-questions/index.ts

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  try {
    // 🔐 DESTINATION (auto from Supabase env)
    const destUrl = Deno.env.get("SUPABASE_URL")!;
    const destKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const dest = createClient(destUrl, destKey);

    // 📡 SOURCE (YOU manually fill these)
    const SOURCE_URL = "https://xvldfsmxskhemkslsbym.supabase.co";
    const SOURCE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh2bGRmc214c2toZW1rc2xzYnltIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MjY4ODE3OSwiZXhwIjoyMDc4MjY0MTc5fQ.S_FLg5nQ-6wMSa1Zpdr9xRlCbBj7R9BwWNs3eTOylUc";

    const source = createClient(SOURCE_URL, SOURCE_KEY);

    // 🧠 STEP 1: check if destination already has questions
    const { count, error: countErr } = await dest
      .from("questions")
      .select("*", { count: "exact", head: true });

    if (countErr) throw countErr;

    if (count && count > 0) {
      return new Response(
        JSON.stringify({
          message: "Questions already exist. Aborting safe mode.",
          count,
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // 📥 STEP 2: fetch all questions from source
    const { data: questions, error: fetchErr } = await source
      .from("questions")
      .select("*");

    if (fetchErr) throw fetchErr;

    if (!questions || questions.length === 0) {
      return new Response(
        JSON.stringify({ message: "No questions found in source." }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // 🚀 STEP 3: batch insert into destination
    const BATCH_SIZE = 100;

    for (let i = 0; i < questions.length; i += BATCH_SIZE) {
      const batch = questions.slice(i, i + BATCH_SIZE);

      const { error: insertErr } = await dest
        .from("questions")
        .insert(batch);

      if (insertErr) throw insertErr;
    }

    return new Response(
      JSON.stringify({
        message: "Questions migration completed 🚀",
        inserted: questions.length,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: err.message,
      }),
      { status: 500 }
    );
  }
});