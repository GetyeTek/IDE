import { createClient } from "https://esm.sh/@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GITHUB_PAT = Deno.env.get("GITHUB_PAT")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE);

const OWNER = "GetyeTek";
const REPO = "IDE";
const BRANCH = "main";

const TABLES = [
  "tele_analysis",
  "conduit_logs",
  "flat_source_metadata",
  "processed_words",
];

function toBase64(str: string) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  const len = bytes.byteLength;

  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }

  return btoa(binary);
}

async function uploadToGitHub(path: string, content: string) {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`;

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${GITHUB_PAT}`,
      "Content-Type": "application/json",
      "User-Agent": "supabase-exporter",
    },
    body: JSON.stringify({
      message: `backup: ${path}`,
      content: toBase64(content),
      branch: BRANCH,
    }),
  });

  if (!res.ok) {
    throw new Error(await res.text());
  }
}

Deno.serve(async () => {
  for (const table of TABLES) {
    const { data: progress } = await supabase
      .from("github_export_progress")
      .select("*")
      .eq("table_name", table)
      .single();

    const offset = progress?.last_offset ?? 0;
    const limit = 1000;

    const { data, error } = await supabase
      .from(table)
      .select("*")
      .range(offset, offset + limit - 1);

    if (error) return new Response(error.message);

    if (!data || data.length === 0) continue;

    const filePath = `backup/${table}/${offset}.json`;
    const json = JSON.stringify(data);

    await uploadToGitHub(filePath, json);

    await supabase
      .from("github_export_progress")
      .update({
        last_offset: offset + limit,
        status: "running",
        updated_at: new Date().toISOString(),
      })
      .eq("table_name", table);
  }

  return new Response("batch done");
});