CREATE TABLE "continuity_findings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"severity" text NOT NULL,
	"artifact_ids" jsonb NOT NULL,
	"explanation" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"source" text NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "protocol_tasks" ADD COLUMN "payload" jsonb;--> statement-breakpoint
ALTER TABLE "continuity_findings" ADD CONSTRAINT "continuity_findings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "continuity_findings_project_idx" ON "continuity_findings" USING btree ("project_id","created_at");