import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { PDFDocument } from "https://cdn.skypack.dev/pdf-lib?dts"

// Configuration
const GITHUB_PAT = Deno.env.get('GITHUB_PAT')!;
const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SB_SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// URL for ወንጌል.pdf in your repo
const GITHUB_URL = "https://raw.githubusercontent.com/GetyeTek/Bible/main/Books/%E1%8B%88%E1%8A%95%E1%8C%B4%E1%88%8D.pdf";

const supabase = createClient(SB_URL, SB_SERVICE_ROLE);

serve(async (req) => {
  try {
    // Expecting JSON like: { "start": 1, "end": 25 }
    const { start, end } = await req.json();

    if (!start || !end) {
      return new Response(JSON.stringify({ error: "Please provide 'start' and 'end' page numbers." }), { status: 400 });
    }

    console.log(`Starting migration for pages ${start} to ${end}...`);

    // 1. Fetch the PDF from GitHub
    const res = await fetch(GITHUB_URL, {
      headers: { 
        Authorization: `token ${GITHUB_PAT}`,
        "Accept": "application/vnd.github.v3.raw"
      }
    });
    
    if (!res.ok) {
      throw new Error(`GitHub fetch failed: ${res.statusText}`);
    }

    const pdfBytes = await res.arrayBuffer();
    
    // 2. Load the PDF document
    // We use ignoreEncryption to ensure we can read it
    const mainPdf = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const totalPages = mainPdf.getPageCount();
    
    const actualEnd = Math.min(end, totalPages);
    const results = [];

    // 3. Loop through the requested page range
    for (let i = start - 1; i < actualEnd; i++) {
      const pageNum = i + 1;
      
      // Create a new PDF document for just this one page
      const subDoc = await PDFDocument.create();
      const [copiedPage] = await subDoc.copyPages(mainPdf, [i]);
      subDoc.addPage(copiedPage);
      
      const subPdfBytes = await subDoc.save();
      const fileName = `page_${pageNum}.pdf`;

      // 4. Upload the 1-page PDF to 'gospel-pages' bucket
      const { error: uploadError } = await supabase.storage
        .from('gospel-pages')
        .upload(fileName, subPdfBytes, {
          contentType: 'application/pdf',
          upsert: true
        });

      if (uploadError) {
        console.error(`Upload error on page ${pageNum}:`, uploadError.message);
        continue;
      }

      // 5. Insert record into gospel_transcriptions table
      const { error: dbError } = await supabase
        .from('gospel_transcriptions')
        .upsert({
          page_number: pageNum,
          storage_path: fileName,
          status: 'pending'
        }, { onConflict: 'page_number' });

      if (dbError) {
        console.error(`DB error on page ${pageNum}:`, dbError.message);
      } else {
        results.push(fileName);
        console.log(`Successfully migrated page ${pageNum}`);
      }
    }

    return new Response(JSON.stringify({ 
      message: `Batch completed`, 
      pages_processed: results.length,
      files: results 
    }), { 
      headers: { "Content-Type": "application/json" } 
    });

  } catch (err) {
    console.error("Critical error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), { 
      status: 500,
      headers: { "Content-Type": "application/json" } 
    });
  }
})