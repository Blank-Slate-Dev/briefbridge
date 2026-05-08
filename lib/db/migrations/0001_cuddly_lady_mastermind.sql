CREATE TABLE "ingestion_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_url" text NOT NULL,
	"status" text NOT NULL,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"error_message" text,
	"http_status" integer,
	"duration_ms" integer
);
--> statement-breakpoint
CREATE INDEX "ingestion_attempts_source_url_idx" ON "ingestion_attempts" USING btree ("source_url");--> statement-breakpoint
CREATE INDEX "ingestion_attempts_attempted_at_idx" ON "ingestion_attempts" USING btree ("attempted_at");