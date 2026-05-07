CREATE TABLE "judgments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"source_url" text NOT NULL,
	"source_id" text,
	"citation" text,
	"case_name" text,
	"court" text,
	"jurisdiction" text,
	"decision_date" date,
	"hearing_dates" text,
	"judges" text[],
	"parties" jsonb,
	"representation" jsonb,
	"file_numbers" text[],
	"category" text,
	"catchwords" text,
	"decision_summary" text,
	"cases_cited" jsonb,
	"legislation_cited" jsonb,
	"paragraphs" jsonb NOT NULL,
	"full_text" text NOT NULL,
	"paragraph_count" integer NOT NULL,
	"raw_html" text,
	"publication_restriction" text,
	"suppression_flag" boolean DEFAULT false NOT NULL,
	"content_hash" text NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decision_last_updated" date
);
--> statement-breakpoint
CREATE UNIQUE INDEX "judgments_source_url_idx" ON "judgments" USING btree ("source_url");--> statement-breakpoint
CREATE INDEX "judgments_citation_idx" ON "judgments" USING btree ("citation");--> statement-breakpoint
CREATE INDEX "judgments_decision_date_idx" ON "judgments" USING btree ("decision_date");--> statement-breakpoint
CREATE INDEX "judgments_source_idx" ON "judgments" USING btree ("source");