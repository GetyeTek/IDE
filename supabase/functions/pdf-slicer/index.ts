import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { PDFDocument } from 'https://cdn.skypack.dev/pdf-lib?dts'

const BUCKET = 'PDFs';
const MASTER_FILE = 'History of Ethiopian and the Horn.pdf';
const OUTPUT_FOLDER = 'History';
const PAGES_PER_SEGMENT = 2;
const BATCH_SIZE = 10; // Number of segments to create per function run

serve(async (req) => {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // 1. Download Master PDF
    const { data: pdfBlob, error: downloadError } = await supabase.storage
      .from(BUCKET)
      .download(MASTER_FILE)

    if (downloadError) throw downloadError

    // 2. Load PDF and count pages
    const masterPdf = await PDFDocument.load(await pdfBlob.arrayBuffer())
    const totalPages = masterPdf.getPageCount()

    // 3. Determine starting point by checking existing segments in DB
    const { count } = await supabase
      .from('processed_history_pages')
      .select('*', { count: 'exact', head: true })

    const startPage = (count || 0) * PAGES_PER_SEGMENT

    if (startPage >= totalPages) {
      return new Response(JSON.stringify({ message: 'Slicing complete. No more pages to process.' }))
    }

    const endBatchPage = Math.min(startPage + (BATCH_SIZE * PAGES_PER_SEGMENT), totalPages)
    const results = []

    // 4. Slicing Loop
    for (let i = startPage; i < endBatchPage; i += PAGES_PER_SEGMENT) {
      const newPdf = await PDFDocument.create()
      const pagesToCopy = []
      
      // Add the 2 pages (or 1 if at the very end)
      pagesToCopy.push(i)
      if (i + 1 < totalPages) pagesToCopy.push(i + 1)

      const copiedPages = await newPdf.copyPages(masterPdf, pagesToCopy)
      copiedPages.forEach(p => newPdf.addPage(p))

      const pdfBytes = await newPdf.save()
      const fileName = `${OUTPUT_FOLDER}/segment_${String(i + 1).padStart(3, '0')}_${String(Math.min(i + 2, totalPages)).padStart(3, '0')}.pdf`

      // 5. Upload to Storage
      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(fileName, pdfBytes, { contentType: 'application/pdf', upsert: true })

      if (!uploadError) {
        // 6. Register in DB for the AI Processor
        await supabase.from('processed_history_pages').insert({
          file_name: fileName,
          status: 'pending'
        })
        results.push(fileName)
      }
    }

    return new Response(JSON.stringify({ 
      message: `Batch processed ${results.length} segments`,
      processed_segments: results
    }), { status: 200 })

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
})
