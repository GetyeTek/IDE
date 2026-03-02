import os
import json
import requests
import google.generativeai as genai
from supabase import create_client

# Configuration
SUPABASE_URL = os.environ.get('SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

MEGA_PROMPT = """You are an expert Document Architect and JSON Engineer. Your task is to transcribe physical book pages into a precise JSON format compatible with the Ultimate PDF Manufacturer (History Engine). Your goal is 1:1 visual and textual fidelity.

ENGINE SPECIFICATIONS

You are working exclusively with the History Engine. All JSON blocks must follow the styling and component naming conventions defined for this engine.

THE TOOLSET (Component Types)

history-header: Used once at the top of standard pages. Contains the module title.

history-unit-header: For chapter/unit starts. Requires number, title, and hours.

history-arrow-list: For lists using the "➢" bullet. Put text in the items array.

paragraph: Standard body text. Use body. Use style: {"textAlign": "justify"} by default.

header: For sub-sections. Use body.

history-footer: For page numbering. Use page.

spacer: Crucial for layout. Use flex: "1" to push content apart or height: "20px" for specific gaps.

history-graphic: For visual elements.

SVG Requirement: If the book shows a flowchart, organizational chart, or diagram containing text, you MUST generate raw <svg> code in the url field (data URI or inline).

Flag Requirement: If the element is a photograph, complex map, or hand-drawing, set the page-level flag "requires_manual_image": true.

history-cover-frame: Triggered by setting "is_cover": true at the page level.

MANDATORY RULES

VERBATIM ONLY: You must transcribe every word exactly as it appears. Do not summarize. Do not fix "typos" unless they are obvious OCR errors. Do not add introductory "Here is the JSON..." text. Output ONLY the JSON object.

STRUCTURAL INTEGRITY: If a paragraph is split by a diagram, create two paragraph blocks in JSON.

WHITESPACE & LAYOUT: Use the spacer component to ensure the page looks balanced. If a page has very little text, use spacers with flex to prevent everything from huddling at the top.

SVG GRAPHICS: When creating flowcharts in SVG:

Use a clean, academic style (Black lines, white backgrounds).

Use font-family="serif".

Ensure all text within the SVG is legible and matches the book's diagram text.

JSON STRUCTURE TEMPLATE
{
  "1": {
    "is_cover": true,
    "watermark": false,
    "content": [
      {
        "type": "spacer",
        "height": "100px"
      },
      {
        "type": "header",
        "body": "ADDIS ABABA UNIVERSITY",
        "style": { "fontSize": "22px", "letterSpacing": "2px" }
      },
      {
        "type": "history-unit-header",
        "title": "History of Ethiopia and the Horn",
        "style": { "marginTop": "50px" }
      },
      {
        "type": "spacer",
        "flex": "1"
      },
      {
        "type": "paragraph",
        "body": "Prepared by: Academic Committee",
        "style": { "textAlign": "center", "fontWeight": "bold" }
      }
    ]
  },
  "2": {
    "requires_manual_image": false,
    "content": [
      { "type": "history-header" },
      {
        "type": "history-unit-header",
        "number": "ONE",
        "title": "INTRODUCTION",
        "hours": "4"
      },
      {
        "type": "header",
        "body": "1.1. The Nature and Uses of History"
      },
      {
        "type": "paragraph",
        "body": "History is a systematic study and interpretation of the past. [EXACT TEXT CONTINUES HERE...]"
      },
      {
        "type": "history-arrow-list",
        "items": [
          "Differentiate between past and history",
          "Distinguish between primary and secondary sources"
        ]
      },
      {
        "type": "history-graphic",
        "url": "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='400' height='100'><rect x='10' y='10' width='100' height='50' fill='white' stroke='black'/><text x='20' y='40' font-family='serif'>Past</text><line x1='110' y1='35' x2='150' y2='35' stroke='black' marker-end='url(#arrow)'/><rect x='150' y='10' width='100' height='50' fill='white' stroke='black'/><text x='160' y='40' font-family='serif'>History</text></svg>",
        "source": "Figure 1.1: The Historiographical Process"
      },
      { "type": "spacer", "flex": "1" },
      { "type": "history-footer", "page": "1" }
    ]
  }
}
TASK INSTRUCTIONS

I will now provide you with the text/images of [INSERT BOOK NAME/CHAPTER HERE].

Analyze the hierarchy (Units, Sections, Sub-sections).

Identify all visual aids.

If it's a flowchart/table/text-diagram, write the <svg> code now.

If it's a photo of a person or artifact, set requires_manual_image: true.

Transcribe every sentence verbatim.

Apply style objects for specific alignments or font-weighting where the book deviates from standard paragraph text.

Output ONLY the JSON. Do not talk to me. Just produce the code.

Begin Transcription:"""

def main():
    # 1. Get Task and Key from Edge Function
    # Note: Using service role to bypass auth for internal orchestrator call
    response = requests.get(f"{SUPABASE_URL}/functions/v1/processor-orchestrator", 
                            headers={"Authorization": f"Bearer {SUPABASE_KEY}"})
    
    if response.status_code != 200 or "apiKey" not in response.json():
        print("No tasks available or error in orchestrator.")
        return

    data = response.json()
    api_key = data['apiKey']
    task_id = data['taskId']
    file_path = data['fileName']

    print(f"Processing: {file_path}")

    try:
        # 2. Download PDF from Storage
        res = supabase.storage.from_('PDFs').download(file_path)
        with open("temp.pdf", "wb") as f:
            f.write(res)

        # 3. Setup Gemini (Using Gemini 2.5 Flash as requested)
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel('gemini-2.5-flash')
        
        # Upload file to Gemini
        sample_file = genai.upload_file(path="temp.pdf", display_name="Source PDF")
        
        # Generate content
        result = model.generate_content([MEGA_PROMPT, sample_file])
        
        # Clean response (remove markdown blocks if present)
        clean_json = result.text.replace('```json', '').replace('```', '').strip()
        
        # 4. Save to Supabase
        supabase.table('processed_history_pages').update({
            "content_json": json.loads(clean_json),
            "status": "completed",
            "raw_ai_response": result.text
        }).eq('id', task_id).execute()
        
        print("Successfully processed and updated database.")

    except Exception as e:
        print(f"Error: {str(e)}")
        supabase.table('processed_history_pages').update({
            "status": "error",
            "error_message": str(e)
        }).eq('id', task_id).execute()

if __name__ == "__main__":
    main()
