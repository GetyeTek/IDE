import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// --- CONFIGURATION ---
const GITHUB_PAT = Deno.env.get("GITHUB_PAT");
const REPO_OWNER = "GetyeTek";
const REPO_NAME = "LinkUp";
const BRANCH = "main";
const PUBLIC_ENDPOINT = "https://vlzgfaqrnyiqfxxxvtas.supabase.co/functions/v1/book-reader";

// --- HEADERS ---
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, accept-encoding",
  "Access-Control-Expose-Headers": "Content-Length"
};

// --- MAIN SERVER LOGIC ---
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);

  if (req.method === "GET") {
    const action = url.searchParams.get("action");
    const path = url.searchParams.get("path");

    if (action === "proxy_image" && path && GITHUB_PAT) {
      try {
        const rawUrl = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BRANCH}/${path}`;
        const imgResp = await fetch(rawUrl, {
          headers: { "Authorization": `token ${GITHUB_PAT}` }
        });

        if (!imgResp.ok) {
          return new Response("Image not found on GitHub", { status: 404, headers: corsHeaders });
        }

        const blob = await imgResp.blob();
        return new Response(blob, {
          headers: {
            ...corsHeaders,
            "Content-Type": imgResp.headers.get("Content-Type") || "image/jpeg",
            "Cache-Control": "public, max-age=31536000"
          }
        });
      } catch (e) {
        return new Response("Error fetching image", { status: 500, headers: corsHeaders });
      }
    }
  }

  try {
    const body = await req.json();
    const { action, book_path } = body;

    if (!GITHUB_PAT) throw new Error("GITHUB_PAT secret not configured in Supabase");

    const commonHeaders = {
      "Authorization": `token ${GITHUB_PAT}`,
      "Accept": "application/vnd.github.v3+json",
      "User-Agent": "LinkUp-Reader-Agent"
    };

    if (action === "list_books") {
      const treeUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/git/trees/${BRANCH}?recursive=1`;
      const resp = await fetch(treeUrl, { headers: commonHeaders });
      if (!resp.ok) throw new Error(`GitHub Tree Error: ${resp.status}`);
      const data = await resp.json();

      const folderMap = new Map();
      for (const item of data.tree) {
        if (!item.path.startsWith("Books/") || item.type !== "blob") continue;
        
        const parts = item.path.split("/");
        parts.pop();
        const folder = parts.join("/");
        
        if (!folderMap.has(folder)) folderMap.set(folder, {});
        const entry = folderMap.get(folder);

        if (item.path.endsWith(".html")) {
            entry.html = item;
        } else if (/\.(jpg|jpeg|png|webp)$/i.test(item.path)) {
            if (!entry.image) entry.image = item.path;
        }
      }

      const books = [];
      for (const [folder, data] of folderMap) {
        if (data.html) {
             const parts = data.html.path.split("/");
             const filename = parts[parts.length - 1];
             const folderName = parts.length > 2 ? parts[parts.length - 2] : "Uncategorized";
             const title = filename.replace(/\.html$/i, "").replace(/_/g, " ");

             let coverUrl = null;
             if (data.image) {
                 coverUrl = `${PUBLIC_ENDPOINT}?action=proxy_image&path=${encodeURIComponent(data.image)}`;
             }

             books.push({
                path: data.html.path,
                category: folderName,
                title: title,
                cover_url: coverUrl 
             });
        }
      }
      return new Response(JSON.stringify({ books }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "get_book_compressed") {
      if (!book_path) throw new Error("Missing 'book_path'");
      const rawUrl = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BRANCH}/${book_path}`;
      const resp = await fetch(rawUrl, { headers: { "Authorization": `token ${GITHUB_PAT}` } });
      if (!resp.ok) throw new Error("Book not found on GitHub");
      
      const acceptsGzip = req.headers.get("accept-encoding")?.includes("gzip");

      if (acceptsGzip && resp.body) {
        const compressionStream = new CompressionStream("gzip");
        const compressedBody = resp.body.pipeThrough(compressionStream);
        return new Response(compressedBody, {
          headers: { ...corsHeaders, "Content-Encoding": "gzip", "Content-Type": "text/html; charset=utf-8" }
        });
      } else {
        return new Response(resp.body, { headers: { ...corsHeaders, "Content-Type": "text/html" } });
      }
    }

    throw new Error(`Unknown action: ${action}`);

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { 
      status: 500, 
      headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });
  }
});