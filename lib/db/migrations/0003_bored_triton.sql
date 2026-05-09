CREATE EXTENSION IF NOT EXISTS "vector";
--> statement-breakpoint
CREATE TABLE "judgment_embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"judgment_id" uuid NOT NULL,
	"paragraph_number" text NOT NULL,
	"paragraph_index" integer NOT NULL,
	"paragraph_text" text NOT NULL,
	"embedding" vector(1024) NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "judgment_embeddings_judgment_id_idx" ON "judgment_embeddings" USING btree ("judgment_id");--> statement-breakpoint
CREATE INDEX "judgment_embeddings_embedding_idx" ON "judgment_embeddings" USING hnsw ("embedding" vector_cosine_ops);