import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PAGE_SIZE = 1000;

Deno.serve(async () => {
  // DESTINATION (auto from Supabase secrets)
  const destUrl = Deno.env.get("SUPABASE_URL")!;
  const destKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const dest = createClient(destUrl, destKey);

  // SOURCE (manual placeholders)
  const sourceUrl = "https://xvldfsmxskhemkslsbym.supabase.co";
  const sourceKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh2bGRmc214c2toZW1rc2xzYnltIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MjY4ODE3OSwiZXhwIjoyMDc4MjY0MTc5fQ.S_FLg5nQ-6wMSa1Zpdr9xRlCbBj7R9BwWNs3eTOylUc";

  const source = createClient(sourceUrl, sourceKey);

  try {
    // 1. Load state
    let { data: state } = await dest
      .from("migration_state")
      .select("*")
      .eq("table_name", "questions")
      .maybeSingle();

    if (!state) {
      await dest.from("migration_state").insert({
        table_name: "questions",
        last_offset: 0,
        status: "running"
      });

      state = {
        last_offset: 0,
        processed_rows: 0
      };
    }

    const from = state.last_offset ?? 0;
    const to = from + PAGE_SIZE - 1;

    // 2. Fetch batch
    const { data: rows, error } = await source
      .from("questions")
      .select("*")
      .range(from, to);

    if (error) throw error;

    if (!rows || rows.length === 0) {
      await dest.from("migration_state")
        .update({
          status: "done",
          updated_at: new Date().toISOString()
        })
        .eq("table_name", "questions");

      return new Response("DONE 🚀");
    }

    // 3. Insert batch (idempotent)
    const { error: insertError } = await dest
      .from("questions")
      .upsert(rows, { onConflict: "id" });

    if (insertError) throw insertError;

    // 4. Update state
    await dest.from("migration_state")
      .update({
        last_offset: to + 1,
        processed_rows: (state.processed_rows ?? 0) + rows.length,
        status: "running",
        updated_at: new Date().toISOString()
      })
      .eq("table_name", "questions");

    // 5. Return progress
    return new Response(JSON.stringify({
      fetched: rows.length,
      next_offset: to + 1,
      processed_total: (state.processed_rows ?? 0) + rows.length
    }));

  } catch (err) {
    await dest.from("migration_state")
      .update({
        status: "failed",
        error: String(err),
        updated_at: new Date().toISOString()
      })
      .eq("table_name", "questions");

    return new Response("FAILED 💥 " + err, { status: 500 });
  }
});