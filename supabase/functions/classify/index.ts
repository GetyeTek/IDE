import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

const SYSTEM_PROMPT = `
You are an advanced academic classifier. Your task is to classify academic exam questions into their correct course.
You will be given a JSON array of up to 5 questions. You must analyze the vocabulary, subject matter, and context of each question and map it to exactly one of the 23 courses listed below.

---
### COURSE CATALOG
1. "ANTH 1012" - Social Anthropology
2. "BIOL 1012" - General Biology
3. "CEN 2201" - Engineering Mechanics
4. "CHEM 1012" - General Chemistry
5. "ECEG 1052" - Computer Programming
6. "ECON 1011" - Introduction to Economics
7. "EMTE 1012" - Introduction to Emerging Technologies
8. "EXAM 0000" - Specialized Entrance / Exit Exams
9. "FLEN 1011" - Communicative English Language Skills
10. "GEES 1011" - Geography
11. "GLTR 1012" - Global Trends
12. "HIST 1012" - History
13. "ICT 1011" - Information & Communication Technology (ICT)
14. "INCL 1012" - Inclusiveness
15. "LOCT 1011" - Logic and Critical Thinking
16. "MATH 1011" - Mathematics for Social Sciences
17. "MATH 1012" - Mathematics for Natural Sciences
18. "MCIE 1012" - Moral and Civic Education
19. "MGMT 1012" - Entrepreneurship
20. "PHYS 1011" - General Physics
21. "PSYC 1011" - General Psychology
22. "SOSC 1011" - General Social Science
23. "SPSC 1011" - Physical Education
24. "STAT 2011" - Probability and Statistics

---
### OUTPUT FORMAT
You must respond with ONLY a valid JSON object matching this schema. Do not include any markdown block formatting or conversational text.

{
  "classifications": [
    {
      "index": 0,              // Integer. The 0-based index of the question in the input array.
      "course_code": "CODE"    // String. Must be the exact course code from the catalog above (e.g. "LOCT 1011").
    }
  ]
}
`;

serve(async (req) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // 1. Fetch up to 10 pending tasks
    const { data: tasks, error: fetchErr } = await supabase
      .from("classification_progress")
      .select("id, result_id")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(10);

    if (fetchErr) throw fetchErr;
    if (!tasks || tasks.length === 0) {
      return new Response(JSON.stringify({ message: "No pending classification tasks found." }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    }

    // 2. Lock tasks to prevent overlapping processing
    const taskIds = tasks.map((t) => t.id);
    await supabase
      .from("classification_progress")
      .update({ status: "processing", updated_at: new Date().toISOString() })
      .in("id", taskIds);

    // 3. Fetch active API keys for our parallel threads
    const keys = await getActiveApiKeys(supabase, tasks.length);

    // 4. Process tasks in parallel
    const processingPromises = tasks.map(async (task, index) => {
      const apiKeyRecord = keys[index % keys.length];
      
      try {
        // A. Fetch raw result data
        const { data: resultRow, error: resultErr } = await supabase
          .from("results")
          .select("id, data")
          .eq("id", task.result_id)
          .single();

        if (resultErr) throw resultErr;
        if (!resultRow || !resultRow.data) throw new Error("Result raw payload missing.");

        const payload = resultRow.data;
        const questionsList = payload.questions || [];

        if (questionsList.length === 0) {
          await updateTaskStatus(supabase, task.id, "completed");
          return;
        }

        // B. Extract clean text packages for Gemini (Max 5 questions per page)
        const questionsToClassify = questionsList.slice(0, 5).map((q: any, idx: number) => ({
          index: idx,
          text: q.text,
          elements: q.elements || []
        }));

        // C. Call Gemini model
        const classificationData = await callGeminiClassification(
          apiKeyRecord.api_key,
          questionsToClassify
        );

        // Track key usage success
        await updateKeyUsage(supabase, apiKeyRecord.id);

        // D. Map classifications back into the JSONB data payload
        const mappings = classificationData.classifications || [];
        for (const item of mappings) {
          if (questionsList[item.index]) {
            questionsList[item.index].course_code = item.course_code;
          }
        }

        // E. Update the results table with the enriched JSON payload
        payload.questions = questionsList;
        const { error: updateErr } = await supabase
          .from("results")
          .update({ data: payload })
          .eq("id", resultRow.id);

        if (updateErr) throw updateErr;

        // F. Update progress to completed
        await updateTaskStatus(supabase, task.id, "completed");

      } catch (err: any) {
        const errorMsg = err.message || JSON.stringify(err);
        console.error(`[Task ${task.id}] Failed: ${errorMsg}`);
        
        const isTransient = err.status === 500 || err.status === 503;

        if (isTransient) {
          await updateTaskStatus(supabase, task.id, "pending", `Transient upstream error (${err.status}): ${errorMsg}`);
        } else {
          await updateTaskStatus(supabase, task.id, "failed", errorMsg);
        }

        if (apiKeyRecord) {
          if (err.status === 429 || errorMsg.includes("429")) {
            await cooldownKey(supabase, apiKeyRecord.id, 5);
          } else if (isTransient) {
            await cooldownKey(supabase, apiKeyRecord.id, 2);
          }
        }
      }
    });

    await Promise.all(processingPromises);

    return new Response(JSON.stringify({ message: "Parallel batch classification completed." }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });

  } catch (globalErr: any) {
    return new Response(JSON.stringify({ error: globalErr.message }), {
      headers: { "Content-Type": "application/json" },
      status: 500,
    });
  }
});

/**
 * Queries the gemma-4-31b-it model and parses out the reasoning thoughts
 * to target only the actual output text payload.
 */
async function callGeminiClassification(apiKey: string, questions: any[]): Promise<any> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemma-4-31b-it:generateContent?key=${apiKey}`;
  
  const payload = {
    contents: [
      {
        parts: [
          {
            text: `${SYSTEM_PROMPT}\n\nHere is the target JSON array of questions to classify:\n${JSON.stringify(questions, null, 2)}`
          }
        ]
      }
    ],
    generationConfig: {
      responseMimeType: "application/json"
    }
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    const errObj = { status: response.status, message: `Model API Error: ${errorText}` };
    throw errObj;
  }

  const responseData = await response.json();
  const parts = responseData.candidates?.[0]?.content?.parts;
  
  if (!parts || !Array.isArray(parts)) {
    throw new Error("Model returned an empty response or invalid structure.");
  }

  // Find the block that does not contain thought/reasoning logs
  const actualResponsePart = parts.find((part: any) => !part.thought);
  const jsonText = actualResponsePart?.text;

  if (!jsonText) {
    throw new Error("Could not locate the non-thought response text block in the model output.");
  }

  return JSON.parse(jsonText);
}

/**
 * Fetches a list of available keys based on least-recently used priority.
 */
async function getActiveApiKeys(supabase: any, limit: number): Promise<any[]> {
  const nowStr = new Date().toISOString();
  
  const { data, error } = await supabase
    .from("api_keys")
    .select("id, api_key")
    .eq("service", "gemini")
    .eq("is_active", true)
    .or(`cooldown_until.is.null,cooldown_until.lt.${nowStr}`)
    .order("last_used_at", { ascending: true, nullsFirst: true })
    .limit(limit);

  if (error || !data || data.length === 0) {
    throw new Error("No active, non-cooldown API keys available.");
  }
  return data;
}

async function updateKeyUsage(supabase: any, keyId: number): Promise<void> {
  await supabase
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", keyId);
}

async function cooldownKey(supabase: any, keyId: number, durationMinutes: number): Promise<void> {
  const cooldownLimit = new Date();
  cooldownLimit.setMinutes(cooldownLimit.getMinutes() + durationMinutes);
  
  await supabase
    .from("api_keys")
    .update({ cooldown_until: cooldownLimit.toISOString() })
    .eq("id", keyId);
}

async function updateTaskStatus(supabase: any, taskId: string, status: string, errorMsg: string | null = null): Promise<void> {
  await supabase
    .from("classification_progress")
    .update({ 
      status, 
      error_message: errorMsg,
      updated_at: new Date().toISOString() 
    })
    .eq("id", taskId);
}