import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8"
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1"
import { encode as encodeBase64 } from "https://deno.land/std@0.168.0/encoding/base64.ts"

const SYSTEM_INSTRUCTIONS_PROMPT = `
You are a highly precise, specialized layout translation model. Your sole task
is to convert raw textbook page content (OCR transcriptions or visual
descriptions) from the university module "Logic and Critical Thinking
(PHIL 1011)" into a single, perfectly structured, valid JSON document matching
the template schema of the LogicRenderer engine.

You process one single page at a time and must reproduce the layout, hierarchy,
indentation, styling, and spacing of the original printed book with absolute,
pixel-perfect fidelity.

[STRICT OUTPUT CONSTRAINTS]

1.  Output ONLY valid JSON inside a single JSON code block. Do not write backticks like "\`\`\`\`json".
2.  NO explanatory text, intro, or outro outside the JSON block. Do not say
    "Here is your JSON".
3.  Pristine JSON syntax is non-negotiable: All string values must use double
    quotes. Any internal double quotes within HTML attributes or body text must
    be escaped as \\\".
4.  No raw line breaks inside JSON strings: Use \\n for line breaks inside
    strings, or <br> inside paragraph body values.

[THE LOGIC BOOK SCHEMA REFERENCE]

You must structure the JSON output using a single parent key representing the
page number (e.g., "page-70"), containing a "content" array. You may only use
the block types cataloged below:

1. Page Frame Blocks

  - {"type": "logic-header"}
      - Usage: Must be the very first block on any standard page. It
        automatically draws the top horizontal bar with the upward/outerward
        projecting right vertical tick. (Omit only on cover pages).
  - {"type": "logic-footer", "authors": "By: Teklay G. (AkU), Adane T. (MU), and
    Zelalem M. (HMU)", "page": "[NUMBER]"}
      - Usage: Must be the final block on every page. Set page strictly to the
        current integer value of the target page. It draws the bottom double red
        gradient bar with centered, aligned details.

2. Layout & Spacing Primitives

  - {"type": "spacer", "height": "[Xpx]", "flex": "1"}
      - Usage: Controls vertical gaps. Use explicit pixel heights (e.g. "20px",
        "80px", "150px") to mimic vertical page margins. Use "flex": "1" to push
        elements (like footers) directly to the bottom of the canvas viewport.
  - Style Helper Objects:
      - Any block can accept a "style" object to override default browser
        alignments. Supported properties:
          - "align": "left" | "center" | "right"
          - "bold": true | false
          - "italic": true | false
          - "underline": true | false
          - "size": "[Xpx]" (e.g., "18px", "24px")
          - "marginTop": "[Xpx]", "marginBottom": "[Xpx]"
          - "padding": "0 10%" (essential for page margins on cover elements or
            prepared-by blocks)
          - "lineHeight": "[decimal]" (e.g., "1.6")

3. Content Block Types

  - {"type": "header", "body": "[TEXT]", "style": { ... }}
      - Usage: Used for section headings, lesson numbers, and sub-lesson titles.
        Do not include lesson titles inside paragraph blocks.
  - {"type": "chapter-title", "number": "[NUM]", "title": "[TEXT]"}
      - Usage: Scoped strictly for major chapter openings. Centered, capitalized
        layout with structural gaps.
  - {"type": "paragraph", "body": "[TEXT]", "style": { ... }}
      - Usage: Standard paragraph text.
          - Super/Subscript support: Translate shorthand like 19^{th}
            (superscript) or H_{2}O (subscript) exactly as shown; the layout
            engine automatically formats them.
          - Inline HTML: You can use standard inline tags like <b>, <i>, <u>,
            and <br> inside the "body" string for micro-formatting.
          - Nested Lists: For simple numbered checklists, embed standard
            <ol>/<li> structures directly inside a paragraph body to preserve
            natural indentations.
  - {"type": "bullet-list", "bullet": "arrow" | "diamond" | "check" | "dot" |
    "star" | "default", "items": [ ... ]}
      - Usage: Renders lists with custom symbol characters corresponding to
        Microsoft Word Wingdings conversion outputs:
          - "arrow" renders triangle arrowheads ()
          - "diamond" renders four-diamond stars ()
          - "check" renders checkmarks ()
          - "dot" renders heavy solid dots ()
          - "star" renders clubs/flowers ()
  - {"type": "logic-activity", "label": "[LABEL]", "body": "[TEXT]"}
      - Usage: Activity prompts (e.g., label is "Activity # 1", body is the
        question/discussion prompt). Renders as a bordered box.
  - {"type": "logic-note", "body": "[TEXT]"}
      - Usage: Standalone note blocks. Formatted inside a thin black container
        box.
  - {"type": "logic-formula", "body": "[TEXT]"}
      - Usage: Centered, italicized logic equations, syllogism summaries, or
        definitions grouped inside a dedicated box.
  - {"type": "logic-quote", "body": "[TEXT]"}
      - Usage: Blockquotes or long textbook quotes. Indented on both margins
        with tighter line spacing.
  - {"type": "logic-example", "label": "Example", "body": "[TEXT]"}
      - Usage: Quick logical examples. Inserts an underlined label.
  - {"type": "logic-self-check", "number": "[NUM]", "question": "[TEXT]",
    "lines": [INT]}
      - Usage: End-of-chapter questions with blank lines for students to write
        on. Specify how many horizontal lines to draw using the "lines"
        property.
  - {"type": "logic-argument", "premises": [ "Premise 1", "Premise 2" ],
    "conclusion": "Conclusion"}
      - Usage: Renders syllogisms. It formats a vertical stacked array of
        premises, automatically inserts the horizontal bar line underneath, and
        places the conclusion below.
  - {"type": "logic-toc", "entries": [ { "level": [0|1|2], "text": "[TITLE]",
    "page": "[NUM]" } ]}
      - Usage: Specifically for the Table of Contents pages. Level 0 represents
        main titles, Level 1 and 2 indent. Generates dot leaders perfectly
        scaled to the A4 canvas.

[GEOMETRIC DRAWING RULES (SVGS VS. RASTERS)]

When a diagram, flowchart, or illustration is present on the page, you must
output a {"type": "graphic"} block:

A. Raster Images

If the page contains an actual photograph or a highly complex non-diagram visual
(like the cover illustration), render it via an external asset path using:

  - "url": "assets/[filename].png"
  - Always include "style": { "width": "[Xpx]", "height": "[Ypx]" } to preserve
    the original layout area.

B. Vector Logic Diagrams (SVGs)

If the page contains a logical diagram (Venn Diagrams, Squares of Opposition, or
Flowcharts), you must generate pure, high-fidelity SVG code inline under the
"svgCode" property.

1.  Venn Diagrams:
      - Use <svg viewBox="0 0 240 120"> to standardly contain overlapping
        circles.
      - Left circle (A) at cx="90" cy="60" r="35", right circle (B) at cx="130"
        cy="60" r="35".
      - Shading: Define a hatching pattern <pattern id="hatch" width="8"
        height="8" patternUnits="userSpaceOnUse"><line x1="0" y1="4" x2="8"
        y2="4" stroke="#ff4d4d" stroke-width="1.5"/></pattern> inside <defs>.
        Use a <mask> containing intersecting circles to apply the shading
        strictly within a particular region (Left moon, right moon, overlap, or
        outer region).
      - X Marks: Place an <text x="X" y="Y" fill="#ff4d4d">X</text> cleanly in
        the target intersection zone.
2.  Squares of Opposition:
      - Draw the square bounding box using paths or <rect>. Place the
        proposition letters (A, E, I, O) at the corner coordinates.
      - Draw intersecting diagonal lines using <line> or <path> with colored
        stroke configurations and custom arrow markers. Place labels (e.g.
        "Contrary", "Contradictory") in clean <text> elements.

[THE AI-EXPLORE FLAG ("ai_ready") PROTOCOL]

A critical aspect of manufacturing this document is determining where the user
can query the AI for deeper academic exploration.

  - Rule of Individual Blocks: You must only assign "ai_ready": true on
    complete, self-contained collections of ideas at the block level.
  - What to Tag:
      - A complete paragraph containing a core philosophical argument.
      - An entire checklist or lesson overview.
      - A finished logic-note or logic-formula block.
      - An entire logic-activity or exercise prompt.
      - A complete logic-argument syllogism.
  - What to Omit (CRITICAL):
      - NO incomplete thoughts: If a sentence or paragraph at the bottom of the
        page is cut off and continues on the next page, do not set "ai_ready":
        true on it. It must be left clean.
      - NO generic blocks: Do not tag headers, spacers, chapter numbers, cover
        title blocks, or transition sentences (e.g. "Look at the following
        examples:").
      - NO cramming: A page should typically have no more than one or two
        ai_ready tags to prevent cognitive overload.

[JSON REFERENCE TEMPLATE]

This is the structural template you must strictly replicate:

{
  "page-NN": {
    "content": [
      {
        "type": "logic-header"
      },
      {
        "type": "header",
        "body": "Lesson Title",
        "style": {
          "size": "18px",
          "bold": true,
          "marginBottom": "20px"
        }
      },
      {
        "type": "paragraph",
        "body": "This is a standard text block with inline <b>formatting</b> and formatting shorthand for subscripts: H_{2}O."
      },
      {
        "type": "logic-note",
        "body": "This is an isolated note box.",
        "ai_ready": true
      },
      {
        "type": "logic-argument",
        "premises": [
          "All philosophers are critical thinkers.",
          "Socrates is a philosopher."
        ],
        "conclusion": "Therefore, Socrates is a critical thinker."
      },
      {
        "type": "spacer",
        "height": "40px",
        "flex": "1"
      },
      {
        "type": "logic-footer",
        "authors": "By: Teklay G. (AkU), Adane T. (MU), and Zelalem M. (HMU)",
        "page": "NN"
      }
    ]
  }
}

`;

// Helper: Safely rotate Gemini keys (Least used first, honoring active and non-cooldown states)
async function getGeminiApiKey(supabase: any) {
  const nowStr = new Date().toISOString();
  
  // Query all active keys
  const { data: keys, error } = await supabase
    .from('api_keys')
    .select('id, api_key, cooldown_until')
    .eq('service', 'gemini')
    .eq('is_active', true)
    .order('last_used_at', { ascending: true, nullsFirst: true });

  if (error || !keys || keys.length === 0) {
    throw new Error('No active Gemini keys available in database.');
  }

  // Filter out keys undergoing rate-limit cooldown
  const availableKeys = keys.filter((key: any) => {
    if (!key.cooldown_until) return true;
    try {
      return new Date(key.cooldown_until).getTime() < Date.now();
    } catch {
      return true;
    }
  });

  if (availableKeys.length === 0) {
    throw new Error('All active Gemini keys are temporarily cooled down due to 429 errors.');
  }

  const selected = availableKeys[0];

  // Instantly mark key as used to preserve strict round-robin rotation
  await supabase
    .from('api_keys')
    .update({ last_used_at: nowStr })
    .eq('id', selected.id);

  return selected;
}

// Helper: Cooldown key for 5 minutes when a 429 rate limit is hit
async function cooldownKey(supabase: any, keyId: number) {
  const cooldownUntil = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  await supabase
    .from('api_keys')
    .update({ cooldown_until: cooldownUntil })
    .eq('id', keyId);
}

serve(async (req) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const pdfName = "Logic and Critical Thinking.pdf";

  try {
    // 1. Atomically lock a batch of up to 10 pending pages
    const { data: pagesToProcess, error: lockError } = await supabase
      .rpc('get_and_lock_pending_pages', { limit_count: 10 });

    if (lockError || !pagesToProcess || pagesToProcess.length === 0) {
      return new Response(JSON.stringify({ message: "No pending pages found to process." }), { status: 200 });
    }

    const pageNumbers = pagesToProcess.map((row: any) => row.locked_page_num);
    console.log(`Locked batch of pages for processing: ${pageNumbers.join(", ")}`);

    // 2. Download the textbook PDF once from the "pdfs" bucket
    const { data: pdfBlob, error: downloadError } = await supabase.storage
      .from('pdfs')
      .download(pdfName);

    if (downloadError || !pdfBlob) {
      throw new Error(`Failed to download PDF from storage: ${downloadError?.message}`);
    }

    const pdfBytes = new Uint8Array(await pdfBlob.arrayBuffer());
    const originPdf = await PDFDocument.load(pdfBytes);

    // 3. Sequentially process the locked pages in the batch
    for (const pageNum of pageNumbers) {
      console.log(`Extracting and processing page: ${pageNum}`);
      let selectedKeyObj: any = null;

      try {
        // Extract the single page (pdf-lib indices are 0-based)
        const subDoc = await PDFDocument.create();
        const [copiedPage] = await subDoc.copyPages(originPdf, [pageNum - 1]);
        subDoc.addPage(copiedPage);
        const singlePageBytes = await subDoc.save();

        // Convert the PDF binary to base64 safely without call stack exhaustion
        const base64Pdf = encodeBase64(singlePageBytes);

        // Fetch round-robin API key
        selectedKeyObj = await getGeminiApiKey(supabase);

        // Call Gemini 3.1 Flash Lite Preview Multimodal API directly with the PDF binary
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${selectedKeyObj.api_key}`;
        
        const payload = {
          contents: [{
            parts: [
              {
                inlineData: {
                  mimeType: "application/pdf",
                  data: base64Pdf
                }
              },
              {
                text: SYSTEM_INSTRUCTIONS_PROMPT
              }
            ]
          }],
          generationConfig: {
            responseMimeType: "application/json"
          }
        };

        const response = await fetch(geminiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

        if (response.status === 429) {
          // Trigger cooldown on the current key
          await cooldownKey(supabase, selectedKeyObj.id);
          throw new Error("Rate limit hit (429). Key has been cooled down.");
        }

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Gemini API returned error code ${response.status}: ${errText}`);
        }

        const resData = await response.json();
        const rawText = resData.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!rawText) {
          throw new Error("Gemini returned an empty candidate content block.");
        }

        // Clean up markdown wrapping if present
        let cleanJsonText = rawText.trim();
        if (cleanJsonText.startsWith('```')) {
          cleanJsonText = cleanJsonText.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
        }

        const parsedJson = JSON.parse(cleanJsonText);

        // Save result and mark page completion inside a transaction block via RPC or sequentially
        await supabase
          .from('logic_book_results')
          .insert({
            pdf_name: pdfName,
            page_number: pageNum,
            result_json: parsedJson
          });

        await supabase
          .from('logic_book_progress')
          .update({ status: 'completed', error_message: null, updated_at: new Date().toISOString() })
          .eq('pdf_name', pdfName)
          .eq('page_number', pageNum);

        console.log(`Page ${pageNum} successfully parsed and stored.`);

      } catch (pageErr: any) {
        console.error(`Error processing page ${pageNum}:`, pageErr);

        // Update progress state to failed with detail
        await supabase
          .from('logic_book_progress')
          .update({
            status: 'failed',
            error_message: pageErr.message,
            updated_at: new Date().toISOString()
          })
          .eq('pdf_name', pdfName)
          .eq('page_number', pageNum);
      }
    }

    return new Response(JSON.stringify({ success: true, processedPages: pageNumbers }), { status: 200 });

  } catch (globalErr: any) {
    console.error("Global Execution Error:", globalErr);
    return new Response(JSON.stringify({ error: globalErr.message }), { status: 500 });
  }
});