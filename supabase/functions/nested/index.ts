import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

// ==========================================
// 🔴 PLACEHOLDERS FOR YOUR REMOTE NESTED DB
// ==========================================
const REMOTE_PROJECT_URL = "https://vlzgfaqrnyiqfxxxvtas.supabase.co";
const REMOTE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZsemdmYXFybnlpcWZ4eHh2dGFzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTU1OTk0MCwiZXhwIjoyMDgxMTM1OTQwfQ.UHSO5jjQOrBT5e06-uFoMW7nirOZbeR8OvsJNQ91c8M";
const REMOTE_TABLE_NAME = "results"; // e.g. "extracted_pages"
const BATCH_SIZE = 50; // How many rows to process per cron execution
// ==========================================

serve(async (req) => {
  try {
    // 1. Initialize Local Database Client (Relational DB)
    // Supabase Edge Functions provide the URL and ANON key by default, but we need the Service Role 
    // key to bypass RLS and perform admin-level inserts during migration.
    const localUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const localServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const localSupabase = createClient(localUrl, localServiceKey);

    // 2. Initialize Remote Database Client (Nested JSON DB)
    const remoteSupabase = createClient(REMOTE_PROJECT_URL, REMOTE_SERVICE_ROLE_KEY);

    // 3. Get the current offset from the local sync state
    const { data: stateData, error: stateError } = await localSupabase
      .from("migration_sync_state")
      .select("current_offset")
      .eq("id", 1)
      .single();

    if (stateError) throw new Error(`Failed to read sync state: ${stateError.message}`);
    const currentOffset = stateData.current_offset;

    // 4. Fetch a chunk of rows from the remote database
    // Note: Assuming the remote table has an 'id' column to order by. If not, change 'id' to another sorting column.
    const { data: rows, error: fetchError } = await remoteSupabase
      .from(REMOTE_TABLE_NAME)
      .select("*")
      .order("id", { ascending: true })
      .range(currentOffset, currentOffset + BATCH_SIZE - 1);

    if (fetchError) throw new Error(`Failed to fetch from remote: ${fetchError.message}`);
    
    if (!rows || rows.length === 0) {
      return new Response(JSON.stringify({ message: "Migration complete. No more rows to process." }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    }

    // 5. Process each row sequentially
    let processedCount = 0;

    for (const row of rows) {
      const remoteId = String(row.id || "unknown");
      const pdfName = row.pdf_name || "unknown";
      const pageIndex = String(row.page_index || "unknown");

      try {
        // --- A. VALIDATION & PARSING ---
        if (!row.data) throw new Error("Data column is empty or null.");
        
        let parsedData;
        try {
          // Data is stored as an escaped JSON string, so we parse it.
          parsedData = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
        } catch (e) {
          throw new Error("Failed to parse JSON string in data column.");
        }

        const metadata = parsedData.metadata;
        const questionsList = parsedData.questions;

        // Strict null/empty checking
        if (!metadata) throw new Error("Metadata object is missing or null.");
        if (!Array.isArray(questionsList) || questionsList.length === 0) {
          throw new Error("Questions array is missing, null, or empty. Skipping row.");
        }

        // --- B. RELATIONAL RESOLUTION ---
        
        // 1. University
        let universityId = null;
        if (metadata.university) {
          let { data: uni } = await localSupabase.from("universities").select("id").eq("name", metadata.university).single();
          if (!uni) {
            const { data: newUni, error: uniErr } = await localSupabase.from("universities").insert({ name: metadata.university }).select("id").single();
            if (uniErr) throw new Error(`Failed inserting university: ${uniErr.message}`);
            universityId = newUni?.id;
          } else {
            universityId = uni.id;
          }
        }

        // 2. Course
        let courseId = null;
        const courseCode = metadata.course_code || "UNKNOWN";
        let { data: course } = await localSupabase.from("courses").select("id").eq("code", courseCode).single();
        if (!course) {
          const { data: newCourse, error: crsErr } = await localSupabase.from("courses").insert({ code: courseCode, name: courseCode }).select("id").single();
          if (crsErr) throw new Error(`Failed inserting course: ${crsErr.message}`);
          courseId = newCourse?.id;
        } else {
          courseId = course.id;
        }

        // 3. Exam (Using Smart Merge for exam_quality_notes)
        const examType = metadata.term || "General";
        const examDate = metadata.year || "";
        
        let examId = null;
        let { data: exam } = await localSupabase.from("exams").select("id")
          .eq("course_id", courseId)
          .eq("exam_type", examType)
          .eq("date", examDate)
          .single();

        if (!exam) {
          // SMART MERGE: Packaging completeness and quality notes into JSONB
          const examQualityNotes = {
            is_complete: metadata.is_complete ?? null,
            quality_score: metadata.quality_score ?? null,
            completeness_notes: metadata.completeness_notes ?? ""
          };

          const { data: newExam, error: examErr } = await localSupabase.from("exams").insert({
            university_id: universityId, // Assuming it could be null if not found, schema permits? If not, setup a fallback ID.
            course_id: courseId,
            course_code: courseCode,
            exam_type: examType,
            date: examDate,
            exam_quality_notes: examQualityNotes // Merged JSONB
          }).select("id").single();
          
          if (examErr) throw new Error(`Failed inserting exam: ${examErr.message}`);
          examId = newExam?.id;
        } else {
          examId = exam.id;
        }

        // 4. Section (Creating a fallback/default section)
        let sectionId = null;
        let { data: section } = await localSupabase.from("sections").select("id").eq("exam_id", examId).eq("title", "Extracted Section").single();
        if (!section) {
          const { data: newSection, error: secErr } = await localSupabase.from("sections").insert({
            exam_id: examId,
            title: "Extracted Section",
            section_order: 1
          }).select("id").single();
          
          if (secErr) throw new Error(`Failed inserting section: ${secErr.message}`);
          sectionId = newSection?.id;
        } else {
          sectionId = section.id;
        }

        // 5. Questions (Using Smart Merge for media)
        for (let i = 0; i < questionsList.length; i++) {
          const q = questionsList[i];
          
          if (!q.text || !q.type) {
            throw new Error(`Question at index ${i} is missing required fields text or type.`);
          }

          // SMART MERGE: Packaging PDF, Page Index, and Diagram Info into JSONB
          const questionMedia = {
            source_pdf: pdfName,
            page_index: parseInt(pageIndex, 10) || pageIndex,
            has_diagrams: metadata.has_diagrams ?? false,
            diagrams_desc: metadata.diagrams_desc ?? ""
          };

          const { error: qErr } = await localSupabase.from("questions").insert({
            section_id: sectionId,
            question_number: String(q.num || ""),
            question_type: q.type,
            text: q.text,
            options: q.elements || [], // Array stored in JSONB
            media: questionMedia,      // Merged JSONB 
            question_order: i + 1
          });

          if (qErr) throw new Error(`Failed inserting question ${q.num}: ${qErr.message}`);
        }

        // --- C. MARK SUCCESS ---
        await localSupabase.from("migration_progress").insert({
          remote_id: remoteId,
          pdf_name: pdfName,
          page_index: pageIndex,
          status: "success",
          error_message: null
        });

      } catch (err: any) {
        // --- D. MARK ERROR (Skip and move on) ---
        await localSupabase.from("migration_progress").insert({
          remote_id: remoteId,
          pdf_name: pdfName,
          page_index: pageIndex,
          status: "error",
          error_message: err.message
        });
      }
      processedCount++;
    }

    // 6. Update Sync State for the Next Cron Execution
    const newOffset = currentOffset + rows.length;
    await localSupabase.from("migration_sync_state").update({
      current_offset: newOffset,
      last_run_at: new Date().toISOString()
    }).eq("id", 1);

    return new Response(JSON.stringify({ 
      message: "Batch processed successfully.", 
      rows_fetched: rows.length, 
      new_offset: newOffset 
    }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });

  } catch (error: any) {
    // Top-level failure (e.g. database connection down)
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { "Content-Type": "application/json" },
      status: 500,
    });
  }
});