import os
import json
import requests
import google.generativeai as genai
from supabase import create_client

# Configuration
SUPABASE_URL = os.environ.get('SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

MEGA_PROMPT = """You are an expert Document Architect. Transcribe the following PDF pages into the Ultimate PDF Manufacturer JSON format (History Engine). 
Rules: 1. Verbatim text. 2. Use 'history-header' at top. 3. Use 'history-arrow-list' for bulleted items. 
4. If text describes a flowchart/diagram, create a high-quality SVG code and place it in the 'url' field of 'history-graphic'. 
5. If it's a photo/drawing, set page-level 'requires_manual_image': true. 
Output ONLY valid JSON."""

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
