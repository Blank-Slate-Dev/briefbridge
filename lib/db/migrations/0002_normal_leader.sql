CREATE INDEX "judgments_search_vector_idx" ON "judgments" USING gin ((
          setweight(to_tsvector('english', coalesce("case_name", '')), 'A') ||
          setweight(to_tsvector('english', coalesce("citation", '')), 'A') ||
          setweight(to_tsvector('english', coalesce("catchwords", '')), 'B') ||
          setweight(to_tsvector('english', coalesce("full_text", '')), 'C')
        ));