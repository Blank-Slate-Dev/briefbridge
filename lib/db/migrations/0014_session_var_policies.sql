-- 0014_session_var_policies.sql
-- ============================================================================
-- STEP 2 of real RLS (Path A): session-variable policies.
--
-- For each existing auth.uid()-based policy, add a PARALLEL policy that reads
-- current_setting('app.user_id', true)::uuid instead. These are what make RLS
-- work for the Drizzle connection (which has no auth.uid(), but WILL set
-- app.user_id per transaction once the transaction helper + cutover land).
--
-- ADDITIVE + COEXISTING: the old auth.uid() policies are NOT touched. Postgres
-- ORs permissive policies, so a row is visible if EITHER the old OR the new
-- policy allows it. Nothing breaks during the transition. The old policies are
-- removed only in a later cleanup step, AFTER the cutover is proven.
--
-- FAITHFUL TRANSLATION (Option 1): these mirror the EXISTING ownership logic
-- (user_id = identity) exactly. They do NOT yet implement firm+assignment —
-- that logic change is a separate later step, kept apart so this step only
-- changes the identity SOURCE, not the access RULE.
--
-- SAFETY: current_setting(..., true) returns NULL (not an error) when the
-- setting is absent. So on the current `postgres` connection (which never sets
-- app.user_id), every one of these evaluates against NULL and grants nothing —
-- harmless and inert. They only "light up" for a connection that sets the var.
--
-- Run each block separately in the SQL editor (select-all per block) to avoid
-- the partial-run issue seen with large multi-statement pastes.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- matters  (direct ownership: user_id = identity)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS matters_select_sessvar ON matters;
CREATE POLICY matters_select_sessvar ON matters
  FOR SELECT
  USING (user_id = current_setting('app.user_id', true)::uuid);

DROP POLICY IF EXISTS matters_insert_sessvar ON matters;
CREATE POLICY matters_insert_sessvar ON matters
  FOR INSERT
  WITH CHECK (user_id = current_setting('app.user_id', true)::uuid);

DROP POLICY IF EXISTS matters_update_sessvar ON matters;
CREATE POLICY matters_update_sessvar ON matters
  FOR UPDATE
  USING (user_id = current_setting('app.user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.user_id', true)::uuid);

DROP POLICY IF EXISTS matters_delete_sessvar ON matters;
CREATE POLICY matters_delete_sessvar ON matters
  FOR DELETE
  USING (user_id = current_setting('app.user_id', true)::uuid);

-- ----------------------------------------------------------------------------
-- conversations  (direct ownership)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS conversations_select_sessvar ON conversations;
CREATE POLICY conversations_select_sessvar ON conversations
  FOR SELECT
  USING (user_id = current_setting('app.user_id', true)::uuid);

DROP POLICY IF EXISTS conversations_insert_sessvar ON conversations;
CREATE POLICY conversations_insert_sessvar ON conversations
  FOR INSERT
  WITH CHECK (user_id = current_setting('app.user_id', true)::uuid);

DROP POLICY IF EXISTS conversations_update_sessvar ON conversations;
CREATE POLICY conversations_update_sessvar ON conversations
  FOR UPDATE
  USING (user_id = current_setting('app.user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.user_id', true)::uuid);

DROP POLICY IF EXISTS conversations_delete_sessvar ON conversations;
CREATE POLICY conversations_delete_sessvar ON conversations
  FOR DELETE
  USING (user_id = current_setting('app.user_id', true)::uuid);

-- ----------------------------------------------------------------------------
-- files  (direct ownership)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS files_select_sessvar ON files;
CREATE POLICY files_select_sessvar ON files
  FOR SELECT
  USING (user_id = current_setting('app.user_id', true)::uuid);

DROP POLICY IF EXISTS files_insert_sessvar ON files;
CREATE POLICY files_insert_sessvar ON files
  FOR INSERT
  WITH CHECK (user_id = current_setting('app.user_id', true)::uuid);

DROP POLICY IF EXISTS files_update_sessvar ON files;
CREATE POLICY files_update_sessvar ON files
  FOR UPDATE
  USING (user_id = current_setting('app.user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.user_id', true)::uuid);

DROP POLICY IF EXISTS files_delete_sessvar ON files;
CREATE POLICY files_delete_sessvar ON files
  FOR DELETE
  USING (user_id = current_setting('app.user_id', true)::uuid);

-- ----------------------------------------------------------------------------
-- profiles  (direct ownership, keyed on id NOT user_id)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS profiles_select_sessvar ON profiles;
CREATE POLICY profiles_select_sessvar ON profiles
  FOR SELECT
  USING (id = current_setting('app.user_id', true)::uuid);

DROP POLICY IF EXISTS profiles_insert_sessvar ON profiles;
CREATE POLICY profiles_insert_sessvar ON profiles
  FOR INSERT
  WITH CHECK (id = current_setting('app.user_id', true)::uuid);

DROP POLICY IF EXISTS profiles_update_sessvar ON profiles;
CREATE POLICY profiles_update_sessvar ON profiles
  FOR UPDATE
  USING (id = current_setting('app.user_id', true)::uuid)
  WITH CHECK (id = current_setting('app.user_id', true)::uuid);

DROP POLICY IF EXISTS profiles_delete_sessvar ON profiles;
CREATE POLICY profiles_delete_sessvar ON profiles
  FOR DELETE
  USING (id = current_setting('app.user_id', true)::uuid);

-- ----------------------------------------------------------------------------
-- messages  (indirect, via conversation ownership)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS messages_select_sessvar ON messages;
CREATE POLICY messages_select_sessvar ON messages
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = messages.conversation_id
      AND c.user_id = current_setting('app.user_id', true)::uuid
  ));

DROP POLICY IF EXISTS messages_insert_sessvar ON messages;
CREATE POLICY messages_insert_sessvar ON messages
  FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = messages.conversation_id
      AND c.user_id = current_setting('app.user_id', true)::uuid
  ));

DROP POLICY IF EXISTS messages_update_sessvar ON messages;
CREATE POLICY messages_update_sessvar ON messages
  FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = messages.conversation_id
      AND c.user_id = current_setting('app.user_id', true)::uuid
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = messages.conversation_id
      AND c.user_id = current_setting('app.user_id', true)::uuid
  ));

DROP POLICY IF EXISTS messages_delete_sessvar ON messages;
CREATE POLICY messages_delete_sessvar ON messages
  FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = messages.conversation_id
      AND c.user_id = current_setting('app.user_id', true)::uuid
  ));

-- ----------------------------------------------------------------------------
-- file_tags  (indirect, via file ownership)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS file_tags_select_sessvar ON file_tags;
CREATE POLICY file_tags_select_sessvar ON file_tags
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM files f
    WHERE f.id = file_tags.file_id
      AND f.user_id = current_setting('app.user_id', true)::uuid
  ));

DROP POLICY IF EXISTS file_tags_insert_sessvar ON file_tags;
CREATE POLICY file_tags_insert_sessvar ON file_tags
  FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM files f
    WHERE f.id = file_tags.file_id
      AND f.user_id = current_setting('app.user_id', true)::uuid
  ));

DROP POLICY IF EXISTS file_tags_delete_sessvar ON file_tags;
CREATE POLICY file_tags_delete_sessvar ON file_tags
  FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM files f
    WHERE f.id = file_tags.file_id
      AND f.user_id = current_setting('app.user_id', true)::uuid
  ));