-- AUTO-GENERATED SCHEMA DUMP
-- Date: 2026-07-02T10:07:44.457Z

-- ========================
-- TABLES & COLUMNS
-- ========================
Table: api_keys
last_used_at (text), name (text), cooldown_until (text), api_key (text), is_active (boolean), service (text), created_at (text), id (bigint)

Table: book_pages
page_number (integer), page_key (text), created_at (timestamp with time zone), content_json (jsonb), manual_flag (text), book_id (uuid), id (uuid)

Table: book_question_links
created_at (timestamp with time zone), similarity_score (double precision), question_id (uuid), chunk_id (uuid), id (uuid)

Table: books
course_code (text), title (text), category (text), cover_url (text), created_at (timestamp with time zone), page_offset (integer), toc (jsonb), id (uuid), author (text)

Table: chunks
embedding (USER-DEFINED), id (uuid), document_id (uuid), page_number (integer), created_at (timestamp with time zone), toc_node_id (uuid), prev_chunk_id (uuid), next_chunk_id (uuid), chunk_index (integer), chunk_text (text)

Table: conduit_favorites
target_id (text), repo_name (text), id (uuid), metadata (jsonb), created_at (timestamp with time zone), category (text)

Table: conduit_history
ops (jsonb), note (text), created_at (timestamp with time zone), conduit_id (integer), id (uuid), repo_name (text), sha (text), title (text), type (text), meta (text)

Table: conduit_logs
repo_name (text), type (text), id (uuid), data (jsonb), created_at (timestamp with time zone)

Table: conversation_members
muted_until (timestamp with time zone), created_at (timestamp with time zone), last_read_at (timestamp with time zone), role (USER-DEFINED), user_id (uuid), conversation_id (uuid), id (uuid)

Table: conversations
created_at (timestamp with time zone), owner_id (uuid), title (character varying), avatar_url (text), metadata (jsonb), type (USER-DEFINED), id (uuid), last_message_at (timestamp with time zone)

Table: courses
department_id (uuid), id (uuid), created_at (timestamp with time zone), code (text), name (text)

Table: departments
id (uuid), created_at (timestamp with time zone), name (text)

Table: documents
id (uuid), file_name (text), storage_path (text), page_count (integer), last_processed_at (timestamp with time zone), created_at (timestamp with time zone), status (text), chunk_count (integer), user_id (uuid)

Table: embedding_progress
error_message (text), id (uuid), locked_until (timestamp with time zone), block_index (integer), book_id (uuid), status (text), updated_at (timestamp with time zone), page_number (integer)

Table: exams
created_at (timestamp with time zone), date (text), time_allowed_minutes (integer), general_instructions (text), id (uuid), total_marks (numeric), program (text), exam_type (text), university_id (uuid), course_id (uuid), media_summary (jsonb), exam_quality_notes (jsonb), constants_provided (jsonb)

Table: messages
reply_to_id (uuid), id (uuid), conversation_id (uuid), text (text), sender_id (uuid), attachments (jsonb), created_at (timestamp with time zone), is_edited (boolean)

Table: migration_progress
status (text), id (uuid), processed_at (timestamp with time zone), remote_id (text), pdf_name (text), page_index (text), error_message (text)

Table: migration_sync_state
current_offset (integer), last_run_at (timestamp with time zone), id (integer)

Table: news_feed
title (text), channel (text), telegram_id (bigint), id (bigint), image_url (text), post_url (text), created_at (timestamp with time zone), full_text (text), telegram_timestamp (timestamp with time zone), snippet (text)

Table: profiles
updated_at (timestamp with time zone), id (uuid), linkoin_balance (integer), last_seen_at (timestamp with time zone), university_id (uuid), last_username_change_at (timestamp with time zone), full_name (text), avatar_url (text), level (text), username (text), department (text), freshman_stream (text), year (text), target_department (text), program (text), phone (text)

Table: question_book_mappings
snippet (text), is_valid (boolean), book_id (uuid), question_id (uuid), id (uuid), page_key (text), status (text), error_message (text), created_at (timestamp with time zone), processed_at (timestamp with time zone), content_index (integer)

Table: question_reports
created_at (timestamp with time zone), source (text), report_text (text), id (uuid), question_id (uuid), status (text)

Table: questions
question_order (integer), embedding (USER-DEFINED), retry_count (integer), created_at (timestamp with time zone), text (text), media (jsonb), matching_data (jsonb), question_number (text), question_type (text), options (jsonb), transcription_quality (jsonb), points (numeric), section_id (uuid), id (uuid), embedding_status (text)

Table: sections
total_points (numeric), exam_id (uuid), shared_context (jsonb), section_order (integer), id (uuid), title (text), created_at (timestamp with time zone), instructions (text)

Table: squad_bans
id (uuid), conversation_id (uuid), user_id (uuid), created_at (timestamp with time zone), banned_until (timestamp with time zone)

Table: universities
short_name (text), name (text), id (uuid), created_at (timestamp with time zone)

-- ========================
-- RLS POLICIES
-- ========================
Table: profiles | Policy: Allow update for owners | Cmd: UPDATE | Using: (auth.uid() = id)
Table: conversations | Policy: Conversations visibility | Cmd: SELECT | Using: is_member_of(id)
Table: conversation_members | Policy: Members visibility | Cmd: SELECT | Using: (is_member_of(conversation_id) OR (user_id = auth.uid()))
Table: messages | Policy: Messages visibility | Cmd: SELECT | Using: is_member_of(conversation_id)
null
Table: messages | Policy: Users can update their own messages | Cmd: UPDATE | Using: (auth.uid() = sender_id)
Table: messages | Policy: Users can delete their own messages | Cmd: DELETE | Using: (auth.uid() = sender_id)
Table: news_feed | Policy: Allow public read access | Cmd: SELECT | Using: true
Table: conversations | Policy: Owners can update their squads | Cmd: UPDATE | Using: (auth.uid() = owner_id)
Table: conversations | Policy: Owners can delete their squads | Cmd: DELETE | Using: (auth.uid() = owner_id)
Table: messages | Policy: Dynamic Read Access for Messages | Cmd: SELECT | Using: ((EXISTS ( SELECT 1
   FROM conversation_members
  WHERE ((conversation_members.conversation_id = messages.conversation_id) AND (conversation_members.user_id = auth.uid())))) OR (EXISTS ( SELECT 1
   FROM conversations
  WHERE ((conversations.id = messages.conversation_id) AND ((conversations.metadata ->> 'privacy'::text) = 'public'::text)))))
Table: conversations | Policy: Dynamic Read Access for Conversations | Cmd: SELECT | Using: (((metadata ->> 'privacy'::text) = 'public'::text) OR (auth.uid() = owner_id) OR (EXISTS ( SELECT 1
   FROM conversation_members
  WHERE ((conversation_members.conversation_id = conversations.id) AND (conversation_members.user_id = auth.uid())))))
Table: books | Policy: Auth read only | Cmd: SELECT | Using: (auth.role() = 'authenticated'::text)
Table: book_pages | Policy: Auth read only | Cmd: SELECT | Using: (auth.role() = 'authenticated'::text)
Table: exams | Policy: Auth read only | Cmd: SELECT | Using: (auth.role() = 'authenticated'::text)
Table: questions | Policy: Auth read only | Cmd: SELECT | Using: (auth.role() = 'authenticated'::text)
Table: sections | Policy: Auth read only | Cmd: SELECT | Using: (auth.role() = 'authenticated'::text)
Table: courses | Policy: Auth read only | Cmd: SELECT | Using: (auth.role() = 'authenticated'::text)
null
null
Table: profiles | Policy: Sensitive data visibility | Cmd: SELECT | Using: (auth.uid() = id)
Table: profiles | Policy: Users can delete their own profile | Cmd: DELETE | Using: (auth.uid() = id)
Table: conversation_members | Policy: Users can update their own conversation member status | Cmd: UPDATE | Using: (auth.uid() = user_id)

-- ========================
-- FUNCTIONS & RPCs
-- ========================
-- Function: sum
null

-- Function: halfvec
null

-- Function: halfvec_to_vector
null

-- Function: vector_to_halfvec
null

-- Function: array_to_halfvec
null

-- Function: array_to_halfvec
null

-- Function: array_to_halfvec
null

-- Function: array_to_halfvec
null

-- Function: halfvec_to_float4
null

-- Function: hamming_distance
null

-- Function: jaccard_distance
null

-- Function: vector_ne
null

-- Function: vector_ge
null

-- Function: vector_gt
null

-- Function: vector_cmp
null

-- Function: vector_l2_squared_distance
null

-- Function: vector_negative_inner_product
null

-- Function: vector_spherical_distance
null

-- Function: vector_accum
null

-- Function: vector_avg
null

-- Function: vector_combine
null

-- Function: avg
null

-- Function: sum
null

-- Function: vector
null

-- Function: array_to_vector
null

-- Function: array_to_vector
null

-- Function: array_to_vector
null

-- Function: array_to_vector
null

-- Function: vector_to_float4
null

-- Function: ivfflathandler
null

-- Function: hnswhandler
null

-- Function: ivfflat_halfvec_support
null

-- Function: ivfflat_bit_support
null

-- Function: hnsw_halfvec_support
null

-- Function: gtrgm_in
null

-- Function: gtrgm_out
null

-- Function: gtrgm_consistent
null

-- Function: gtrgm_distance
null

-- Function: gtrgm_compress
null

-- Function: gtrgm_decompress
null

-- Function: gtrgm_penalty
null

-- Function: gtrgm_picksplit
null

-- Function: gtrgm_union
null

-- Function: gtrgm_same
null

-- Function: gin_extract_value_trgm
null

-- Function: gin_extract_query_trgm
null

-- Function: gin_trgm_consistent
null

-- Function: gin_trgm_triconsistent
null

-- Function: hnsw_bit_support
null

-- Function: hnsw_sparsevec_support
null

-- Function: halfvec_send
null

-- Function: halfvec_in
null

-- Function: halfvec_out
null

-- Function: halfvec_typmod_in
null

-- Function: halfvec_recv
null

-- Function: l2_distance
null

-- Function: inner_product
null

-- Function: cosine_distance
null

-- Function: l1_distance
null

-- Function: vector_dims
null

-- Function: l2_norm
null

-- Function: l2_normalize
null

-- Function: binary_quantize
null

-- Function: subvector
null

-- Function: halfvec_add
null

-- Function: halfvec_sub
null

-- Function: halfvec_mul
null

-- Function: halfvec_concat
null

-- Function: halfvec_lt
null

-- Function: halfvec_le
null

-- Function: halfvec_eq
null

-- Function: halfvec_ne
null

-- Function: halfvec_ge
null

-- Function: halfvec_gt
null

-- Function: halfvec_cmp
null

-- Function: halfvec_l2_squared_distance
null

-- Function: halfvec_negative_inner_product
null

-- Function: halfvec_spherical_distance
null

-- Function: halfvec_accum
null

-- Function: halfvec_avg
null

-- Function: halfvec_combine
null

-- Function: avg
null

-- Function: vector_in
null

-- Function: vector_out
null

-- Function: vector_typmod_in
null

-- Function: vector_recv
null

-- Function: vector_send
null

-- Function: l2_distance
null

-- Function: inner_product
null

-- Function: cosine_distance
null

-- Function: l1_distance
null

-- Function: vector_dims
null

-- Function: vector_norm
null

-- Function: l2_normalize
null

-- Function: binary_quantize
null

-- Function: subvector
null

-- Function: vector_add
null

-- Function: vector_sub
null

-- Function: vector_mul
null

-- Function: vector_concat
null

-- Function: vector_lt
null

-- Function: vector_le
null

-- Function: vector_eq
null

-- Function: sparsevec_in
null

-- Function: sparsevec_out
null

-- Function: sparsevec_typmod_in
null

-- Function: sparsevec_recv
null

-- Function: sparsevec_send
null

-- Function: l2_distance
null

-- Function: inner_product
null

-- Function: cosine_distance
null

-- Function: l1_distance
null

-- Function: l2_norm
null

-- Function: l2_normalize
null

-- Function: sparsevec_lt
null

-- Function: sparsevec_le
null

-- Function: sparsevec_eq
null

-- Function: sparsevec_ne
null

-- Function: sparsevec_ge
null

-- Function: sparsevec_gt
null

-- Function: sparsevec_cmp
null

-- Function: sparsevec_l2_squared_distance
null

-- Function: sparsevec_negative_inner_product
null

-- Function: sparsevec
null

-- Function: vector_to_sparsevec
null

-- Function: sparsevec_to_vector
null

-- Function: halfvec_to_sparsevec
null

-- Function: sparsevec_to_halfvec
null

-- Function: array_to_sparsevec
null

-- Function: array_to_sparsevec
null

-- Function: array_to_sparsevec
null

-- Function: array_to_sparsevec
null

-- Function: word_similarity_dist_commutator_op
null

-- Function: show_trgm
null

-- Function: get_table_counts

DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT t.table_name
        FROM information_schema.tables t
        WHERE t.table_schema = 'public'
          AND t.table_name IN (
            'amharic_dictionary_final',
            'purified_amharic_dictionary',
            'flat_source_metadata',
            'union_refined_dictionary',
            'processed_words',
            'candidate_words',
            'candidate_words_imp6',
            'tele_analysis',
            'verse_analysis',
            'lonely_roots_inspection'
          )
    LOOP
        EXECUTE format(
            'SELECT %L, count(*) FROM public.%I',
            r.table_name, r.table_name
        )
        INTO table_name, row_count;

        RETURN NEXT;
    END LOOP;
END;


-- Function: set_limit
null

-- Function: show_limit
null

-- Function: similarity
null

-- Function: similarity_op
null

-- Function: word_similarity
null

-- Function: word_similarity_op
null

-- Function: word_similarity_commutator_op
null

-- Function: similarity_dist
null

-- Function: word_similarity_dist_op
null

-- Function: strict_word_similarity
null

-- Function: strict_word_similarity_op
null

-- Function: strict_word_similarity_commutator_op
null

-- Function: strict_word_similarity_dist_op
null

-- Function: strict_word_similarity_dist_commutator_op
null

-- Function: gtrgm_options
null

-- Function: get_pending_questions_for_mapping

BEGIN
    RETURN QUERY
    SELECT q.id, q.text, q.question_type, q.options, q.matching_data
    FROM questions q
    JOIN sections s ON q.section_id = s.id
    JOIN exams e ON s.exam_id = e.id
    WHERE e.course_id = p_course_id
      AND NOT EXISTS (
          SELECT 1 
          FROM question_book_mappings qbm 
          WHERE qbm.question_id = q.id 
            AND qbm.book_id = p_book_id 
            AND qbm.status IN ('completed', 'processing')
      )
    ORDER BY q.created_at ASC
    LIMIT p_limit;
END;


-- Function: lease_gemini_api_key

DECLARE
    selected_id bigint;
BEGIN
    SELECT k.id INTO selected_id
    FROM api_keys k
    WHERE k.service = 'gemini'
      AND k.is_active = true
      -- Look how clean this is now! Native date comparison.
      AND (k.cooldown_until IS NULL OR k.cooldown_until <= NOW())
    ORDER BY k.last_used_at ASC NULLS FIRST
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    IF selected_id IS NOT NULL THEN
        UPDATE api_keys AS ak
        SET last_used_at = NOW()
        WHERE ak.id = selected_id;

        RETURN QUERY 
        SELECT k.id, k.api_key
        FROM api_keys k
        WHERE k.id = selected_id;
    END IF;
END;


-- Function: complete_embedding_job

BEGIN
    UPDATE public.embedding_progress
    SET status = 'completed',
        locked_until = NULL,
        error_message = NULL,
        updated_at = now()
    WHERE id = p_job_id;
END;


-- Function: fail_embedding_job

BEGIN
    UPDATE public.embedding_progress
    SET status = 'failed',
        locked_until = NULL,
        error_message = p_error,
        updated_at = now()
    WHERE id = p_job_id;
END;


-- Function: cooldown_api_key

BEGIN
    UPDATE public.api_keys
    SET cooldown_until = (now() + interval '5 minutes')::text
    WHERE id = p_key_id;
END;


-- Function: find_user_by_any_identity

BEGIN
    RETURN QUERY
    SELECT p.id, p.full_name, p.username, p.avatar_url
    FROM public.profiles p
    WHERE p.id != req_user_id 
    AND p.username ILIKE (search_term || '%')
    LIMIT 5;
END;


-- Function: initialize_book_embedding_jobs

DECLARE
    v_inserted_rows integer := 0;
BEGIN
    -- 1. Clear out any stale records for this book to start fresh
    DELETE FROM public.embedding_progress WHERE book_id = p_book_id;

    -- 2. Extract array blocks natively using WITH ORDINALITY
    INSERT INTO public.embedding_progress (book_id, page_number, block_index, status)
    SELECT 
        p_book_id,
        bp.page_number,
        arr.idx - 1 as block_index, -- Convert 1-based ordinality index to 0-based block index
        'pending'::text
    FROM 
        public.book_pages bp
    CROSS JOIN LATERAL 
        jsonb_array_elements(bp.content_json) WITH ORDINALITY arr(elem, idx)
    WHERE 
        bp.book_id = p_book_id
        AND jsonb_typeof(bp.content_json) = 'array'; -- Safe-guard: ignore malformed columns

    GET DIAGNOSTICS v_inserted_rows = ROW_COUNT;
    RETURN v_inserted_rows;
END;


-- Function: get_user_conversations

BEGIN
  RETURN QUERY
  SELECT 
    c.id as conversation_id,
    c.type::text, -- Safely cast the custom enum to text
    c.title,
    c.avatar_url,
    c.last_message_at,
    (SELECT m.text FROM public.messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) as last_message_text,
    (SELECT count(*) FROM public.messages m2 
     WHERE m2.conversation_id = c.id 
       AND m2.sender_id != req_user_id 
       AND m2.created_at > cm.last_read_at) as unread_count,
    (SELECT p.full_name FROM public.conversation_members cm2 JOIN public.profiles p ON p.id = cm2.user_id WHERE cm2.conversation_id = c.id AND cm2.user_id != req_user_id LIMIT 1) as other_user_name,
    (SELECT p.avatar_url FROM public.conversation_members cm2 JOIN public.profiles p ON p.id = cm2.user_id WHERE cm2.conversation_id = c.id AND cm2.user_id != req_user_id LIMIT 1) as other_user_avatar,
    (SELECT p.id FROM public.conversation_members cm2 JOIN public.profiles p ON p.id = cm2.user_id WHERE cm2.conversation_id = c.id AND cm2.user_id != req_user_id LIMIT 1) as other_user_id,
    (SELECT p.last_seen_at FROM public.conversation_members cm2 JOIN public.profiles p ON p.id = cm2.user_id WHERE cm2.conversation_id = c.id AND cm2.user_id != req_user_id LIMIT 1) as other_user_last_seen
  FROM public.conversations c
  JOIN public.conversation_members cm ON c.id = cm.conversation_id
  WHERE cm.user_id = req_user_id
  ORDER BY c.last_message_at DESC;
END;


-- Function: squad_kick_member

BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.conversation_members 
        WHERE conversation_id = req_conv_id 
        AND user_id = auth.uid() 
        AND role IN ('owner', 'admin')
    ) THEN
        RAISE EXCEPTION 'Access Denied: Administrative privileges required.';
    END IF;

    DELETE FROM public.conversation_members WHERE conversation_id = req_conv_id AND user_id = req_target_id;
END;


-- Function: squad_ban_member

BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.conversation_members 
        WHERE conversation_id = req_conv_id 
        AND user_id = auth.uid() 
        AND role IN ('owner', 'admin')
    ) THEN
        RAISE EXCEPTION 'Access Denied: Administrative privileges required.';
    END IF;
    
    INSERT INTO public.squad_bans (conversation_id, user_id, banned_until) 
    VALUES (req_conv_id, req_target_id, req_banned_until)
    ON CONFLICT (conversation_id, user_id) 
    DO UPDATE SET banned_until = EXCLUDED.banned_until;
    
    DELETE FROM public.conversation_members WHERE conversation_id = req_conv_id AND user_id = req_target_id;
END;


-- Function: squad_mute_member

BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.conversation_members 
        WHERE conversation_id = req_conv_id 
        AND user_id = auth.uid() 
        AND role IN ('owner', 'admin')
    ) THEN
        RAISE EXCEPTION 'Access Denied: Administrative privileges required.';
    END IF;
    
    UPDATE public.conversation_members SET muted_until = req_muted_until 
    WHERE conversation_id = req_conv_id AND user_id = req_target_id;
END;


-- Function: acquire_embedding_jobs

DECLARE
    v_now timestamp with time zone := now();
BEGIN
    -- Safeguard: Ensure there is at least one active key not in cooldown
    IF NOT EXISTS (
        SELECT 1 FROM public.api_keys 
        WHERE service = 'gemini' AND is_active = true 
          AND (cooldown_until IS NULL OR cooldown_until::timestamp with time zone < v_now)
    ) THEN
        RAISE EXCEPTION 'No active, non-cooled-down Gemini API keys available in key pool.';
    END IF;

    RETURN QUERY
    WITH 
    -- 1. Sort active keys by least recently used
    active_keys AS (
        SELECT 
            id, 
            ak.api_key,
            row_number() OVER (ORDER BY last_used_at ASC NULLS FIRST) - 1 as seq_id,
            count(*) OVER () as total_keys
        FROM public.api_keys ak
        WHERE service = 'gemini' 
          AND is_active = true 
          AND (cooldown_until IS NULL OR cooldown_until::timestamp with time zone < v_now)
    ),
    -- 2. STAGE 1: Lock a batch of blocks using SKIP LOCKED (No window functions here)
    raw_jobs AS (
        SELECT 
            ep.id,
            ep.page_number,
            ep.block_index
        FROM public.embedding_progress ep
        WHERE ep.book_id = p_book_id
          AND (ep.status = 'pending' OR ep.status = 'failed' OR (ep.status = 'processing' AND ep.locked_until < v_now))
        ORDER BY ep.page_number, ep.block_index
        LIMIT p_batch_size
        FOR UPDATE SKIP LOCKED
    ),
    -- 3. STAGE 2: Safely apply window indexing over the locked rows
    locked_jobs AS (
        SELECT 
            rj.id,
            rj.page_number,
            rj.block_index,
            row_number() OVER (ORDER BY rj.page_number, rj.block_index) - 1 as seq_id
        FROM raw_jobs rj
    ),
    -- 4. Mark the locked blocks as processing in the DB for 5 minutes
    update_jobs AS (
        UPDATE public.embedding_progress ep
        SET status = 'processing',
            locked_until = v_now + interval '5 minutes',
            updated_at = v_now
        FROM raw_jobs rj
        WHERE ep.id = rj.id
    ),
    -- 5. Join jobs and keys using modulo mapping
    mapped_assignments AS (
        SELECT 
            lj.id as job_id,
            lj.page_number,
            lj.block_index,
            ak.api_key,
            ak.id as api_key_id
        FROM locked_jobs lj
        JOIN active_keys ak ON (lj.seq_id % ak.total_keys) = ak.seq_id
    ),
    -- 6. Update last_used_at on the keys to rotate them instantly
    update_keys AS (
        UPDATE public.api_keys ak
        SET last_used_at = v_now
        FROM (SELECT DISTINCT ma.api_key_id FROM mapped_assignments ma) u
        WHERE ak.id = u.api_key_id
    )
    SELECT 
        ma.job_id,
        ma.page_number,
        ma.block_index,
        ma.api_key,
        ma.api_key_id
    FROM mapped_assignments ma;
END;


-- Function: handle_new_user

BEGIN
  INSERT INTO public.profiles (id, full_name, avatar_url, level, linkoin_balance)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'full_name', 'New Scholar'),
    COALESCE(
      new.raw_user_meta_data->>'avatar_url', 
      'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=80'
    ),
    'Division I',
    100
  );
  RETURN new;
END;


-- Function: update_conv_last_message

BEGIN
  UPDATE public.conversations 
  SET last_message_at = NEW.created_at 
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;


-- Function: is_member_of

BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.conversation_members
    WHERE conversation_id = conv_id AND user_id = auth.uid()
  );
END;


-- Function: check_self_reply

DECLARE
    target_sender_id uuid;
BEGIN
    -- If there's no reply, just allow it
    IF NEW.reply_to_id IS NULL THEN
        RETURN NEW;
    END IF;

    -- Look up the sender of the original message
    SELECT sender_id INTO target_sender_id FROM public.messages WHERE id = NEW.reply_to_id;

    -- Compare
    IF target_sender_id = NEW.sender_id THEN
        RAISE EXCEPTION 'You cannot reply to your own messages. That is just sad.';
    END IF;

    RETURN NEW;
END;


-- Function: check_username_available

BEGIN
  RETURN NOT EXISTS (SELECT 1 FROM public.profiles WHERE username = req_username);
END;


-- Function: check_email_provider

DECLARE
    found_provider TEXT;
BEGIN
    -- Look into the private auth.users table safely
    SELECT (raw_app_meta_data->>'provider') INTO found_provider
    FROM auth.users
    WHERE email = req_email
    LIMIT 1;

    IF found_provider IS NOT NULL THEN
        RETURN QUERY SELECT TRUE, found_provider;
    ELSE
        RETURN QUERY SELECT FALSE, NULL::TEXT;
    END IF;
END;


-- Function: get_suggested_squads

BEGIN
    RETURN QUERY
    SELECT 
        c.id AS conversation_id,
        c.title::text AS title,
        COALESCE(c.metadata, '{}'::jsonb) AS metadata,
        (SELECT COUNT(*) FROM public.conversation_members cm WHERE cm.conversation_id = c.id) AS m_count
    FROM public.conversations c
    WHERE c.type::text = 'group'
      AND (c.metadata->>'privacy' = 'public' OR c.metadata->>'privacy' IS NULL)
      AND NOT EXISTS (
          SELECT 1 FROM public.conversation_members cm2 
          WHERE cm2.conversation_id = c.id AND cm2.user_id = req_user_id
      )
    -- THE ALGORITHM TWEAK: Prioritize member count, then recency
    ORDER BY m_count DESC, c.created_at DESC
    LIMIT 20;
END;


-- Function: protect_profile_fields

BEGIN
    IF auth.role() = 'authenticated' THEN
        NEW.linkoin_balance = OLD.linkoin_balance;
        NEW.level = OLD.level;
    END IF;
    RETURN NEW;
END;


-- Function: protect_member_roles

BEGIN
    IF auth.role() = 'authenticated' AND NEW.role IS DISTINCT FROM OLD.role THEN
        IF NOT EXISTS (
            SELECT 1 FROM conversation_members 
            WHERE conversation_id = NEW.conversation_id AND user_id = auth.uid() AND role = 'owner'
        ) THEN
            RAISE EXCEPTION 'Security Violation: Role elevation is strictly prohibited.';
        END IF;
    END IF;
    RETURN NEW;
END;


-- Function: get_or_create_notes

DECLARE
    conv_id uuid;
BEGIN
    IF req_user_id != auth.uid() THEN
        RAISE EXCEPTION 'Access Denied: You cannot create notes for another user.';
    END IF;

    SELECT c.id INTO conv_id
    FROM public.conversations c
    JOIN public.conversation_members cm ON c.id = cm.conversation_id
    WHERE c.type = 'notes' AND cm.user_id = req_user_id
    LIMIT 1;

    IF conv_id IS NULL THEN
        INSERT INTO public.conversations (type, title, owner_id) VALUES ('notes', 'My Notes', req_user_id) RETURNING id INTO conv_id;
        INSERT INTO public.conversation_members (conversation_id, user_id, role) VALUES (conv_id, req_user_id, 'admin');
    END IF;

    RETURN conv_id;
END;


-- Function: get_public_profiles

BEGIN
    RETURN QUERY
    SELECT p.id, p.full_name, p.avatar_url, p.username
    FROM public.profiles p
    WHERE p.id = ANY(user_ids);
END;


-- Function: get_social_discovery

DECLARE
    my_uni UUID;
    my_dept TEXT;
BEGIN
    SELECT p.university_id, p.department INTO my_uni, my_dept
    FROM public.profiles p WHERE p.id = req_user_id;

    RETURN QUERY
    SELECT 
        p.id, p.full_name, p.username, p.avatar_url, p.university_id, p.department,
        CASE 
            WHEN p.university_id = my_uni AND p.department = my_dept THEN 1
            WHEN p.university_id = my_uni THEN 2
            ELSE 3
        END as tier
    FROM public.profiles p
    WHERE p.id != req_user_id
    AND p.id NOT IN (
        SELECT cm2.user_id
        FROM public.conversation_members cm1
        JOIN public.conversation_members cm2 ON cm1.conversation_id = cm2.conversation_id
        JOIN public.conversations c ON cm1.conversation_id = c.id
        WHERE cm1.user_id = req_user_id AND cm2.user_id != req_user_id AND c.type = 'dm'
    )
    ORDER BY tier ASC, p.last_seen_at DESC NULLS LAST
    LIMIT 30;
END;


-- Function: sync_squad_privacy_slug

DECLARE
    base_slug text;
    candidate_slug text;
    counter integer := 1;
BEGIN
    -- If switched to private: Vaporize the slug
    IF NEW.metadata->>'privacy' = 'private' THEN
        NEW.metadata := NEW.metadata - 'slug';
        
    -- If switched to public: Generate a fresh secure slug
    ELSIF (NEW.metadata->>'privacy' = 'public' OR NEW.metadata->>'privacy' IS NULL) AND NOT (NEW.metadata ? 'slug') THEN
        base_slug := regexp_replace(lower(NEW.title), '[^a-z0-9]', '', 'g');
        IF base_slug = '' THEN base_slug := 'squad'; END IF;
        candidate_slug := base_slug;

        WHILE EXISTS (SELECT 1 FROM public.conversations WHERE id != NEW.id AND metadata->>'slug' = candidate_slug) LOOP
            candidate_slug := base_slug || counter::text;
            counter := counter + 1;
        END LOOP;
        
        NEW.metadata := NEW.metadata || jsonb_build_object('slug', candidate_slug);
    END IF;
    RETURN NEW;
END;


-- Function: enforce_squad_message_rules

DECLARE
    v_role text;
    v_muted_until timestamp with time zone;
    v_members_can_post boolean;
    v_type text;
BEGIN
    -- 1. Check if the conversation is a group
    SELECT type, COALESCE((metadata->>'members_can_post')::boolean, true) 
    INTO v_type, v_members_can_post 
    FROM public.conversations 
    WHERE id = NEW.conversation_id;

    IF v_type = 'group' THEN
        -- 2. Grab the sender's current rank and mute status
        SELECT role, muted_until INTO v_role, v_muted_until
        FROM public.conversation_members
        WHERE conversation_id = NEW.conversation_id AND user_id = NEW.sender_id;

        -- 3. Reject non-members outright
        IF v_role IS NULL THEN
            RAISE EXCEPTION 'Access Denied: You are not a member of this squad.';
        END IF;

        -- 4. Reject if the user is individually muted/restricted
        IF v_muted_until IS NOT NULL AND v_muted_until > now() THEN
            RAISE EXCEPTION 'Access Denied: You are currently restricted from posting in this group.';
        END IF;

        -- 5. Reject if global posting is turned off (and the user isn't an admin)
        IF v_members_can_post = false AND v_role NOT IN ('owner', 'admin') THEN
            RAISE EXCEPTION 'Access Denied: Administrators have temporarily disabled posting for members.';
        END IF;
    END IF;

    RETURN NEW;
END;


-- Function: leave_squad

BEGIN
    DELETE FROM public.conversation_members
    WHERE conversation_id = req_conv_id AND user_id = auth.uid();
END;


-- Function: create_study_group

DECLARE
  base_slug text;
  candidate_slug text;
  counter integer := 1;
  new_conv_id uuid;
  final_metadata jsonb;
  owned_count integer;
BEGIN
  -- BACKEND ENFORCEMENT: Enforce limit of 3 groups owned by the user
  SELECT count(*) INTO owned_count 
  FROM public.conversations 
  WHERE owner_id = auth.uid() AND type = 'group';
  
  IF owned_count >= 3 THEN
      RAISE EXCEPTION 'Limit reached. You can only own up to 3 study groups.';
  END IF;

  final_metadata := COALESCE(req_metadata, '{}'::jsonb);

  IF (final_metadata->>'privacy' IS NULL OR final_metadata->>'privacy' = 'public') THEN
      base_slug := regexp_replace(lower(req_title), '[^a-z0-9]', '', 'g');
      IF base_slug = '' THEN base_slug := 'squad'; END IF;
      candidate_slug := base_slug;

      LOOP
        WHILE EXISTS (SELECT 1 FROM public.conversations WHERE metadata->>'slug' = candidate_slug) LOOP
          candidate_slug := base_slug || counter::text;
          counter := counter + 1;
        END LOOP;

        BEGIN
          final_metadata := final_metadata || jsonb_build_object('slug', candidate_slug);
          INSERT INTO public.conversations (type, title, metadata, owner_id)
          VALUES ('group', req_title, final_metadata, auth.uid())
          RETURNING id INTO new_conv_id;
          EXIT; 
        EXCEPTION WHEN unique_violation THEN
          candidate_slug := base_slug || counter::text;
          counter := counter + 1;
        END;
      END LOOP;
  ELSE
      INSERT INTO public.conversations (type, title, metadata, owner_id)
      VALUES ('group', req_title, final_metadata, auth.uid())
      RETURNING id INTO new_conv_id;
  END IF;

  INSERT INTO public.conversation_members (conversation_id, user_id, role)
  VALUES (new_conv_id, auth.uid(), 'owner');

  RETURN new_conv_id;
END;


-- Function: create_direct_message

DECLARE
  new_conv_id UUID;
  existing_conv_id UUID;
BEGIN
  -- Prevent concurrent creation of duplicate DMs
  SELECT c.id INTO existing_conv_id
  FROM public.conversations c
  JOIN public.conversation_members cm1 ON c.id = cm1.conversation_id
  JOIN public.conversation_members cm2 ON c.id = cm2.conversation_id
  WHERE c.type = 'dm' 
    AND cm1.user_id = auth.uid() 
    AND cm2.user_id = target_user_id
  LIMIT 1;

  IF existing_conv_id IS NOT NULL THEN
      RETURN existing_conv_id;
  END IF;

  INSERT INTO public.conversations (type) VALUES ('dm') RETURNING id INTO new_conv_id;
  
  INSERT INTO public.conversation_members (conversation_id, user_id) 
  VALUES (new_conv_id, auth.uid()), (new_conv_id, target_user_id);
  
  RETURN new_conv_id;
END;


-- Function: join_study_group

DECLARE
    ban_record RECORD;
    conv_privacy text;
BEGIN
    IF req_user_id != auth.uid() THEN
        RAISE EXCEPTION 'Access Denied: You cannot force another user to join a group.';
    END IF;

    SELECT metadata->>'privacy' INTO conv_privacy FROM public.conversations WHERE id = req_conversation_id;
    IF conv_privacy = 'private' THEN
        RAISE EXCEPTION 'Access Denied: This group is private.';
    END IF;

    SELECT banned_until INTO ban_record FROM public.squad_bans WHERE conversation_id = req_conversation_id AND user_id = req_user_id;
    IF FOUND THEN
        IF ban_record.banned_until IS NULL OR ban_record.banned_until > now() THEN
            RAISE EXCEPTION 'Access Denied: You are banned from this group.';
        ELSE
            DELETE FROM public.squad_bans WHERE conversation_id = req_conversation_id AND user_id = req_user_id;
        END IF;
    END IF;

    INSERT INTO public.conversation_members (conversation_id, user_id, role)
    VALUES (req_conversation_id, req_user_id, 'member')
    ON CONFLICT DO NOTHING;
END;


