CREATE TABLE "completion_certifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"policy" text NOT NULL,
	"actor_id" text NOT NULL,
	"report" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "narrative_connections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"endpoint_a_id" uuid NOT NULL,
	"endpoint_b_id" uuid NOT NULL,
	"fact_artifact_id" uuid,
	"realized_by_ids" jsonb NOT NULL,
	"statement" text NOT NULL,
	"confidence" text NOT NULL,
	"status" text NOT NULL,
	"source" text NOT NULL,
	"approved_by" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "protocol_tasks" ADD COLUMN "input_manifest" jsonb;--> statement-breakpoint
ALTER TABLE "completion_certifications" ADD CONSTRAINT "completion_certifications_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "narrative_connections" ADD CONSTRAINT "narrative_connections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "narrative_connections" ADD CONSTRAINT "narrative_connections_a_fk" FOREIGN KEY ("project_id","endpoint_a_id") REFERENCES "public"."artifacts"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "narrative_connections" ADD CONSTRAINT "narrative_connections_b_fk" FOREIGN KEY ("project_id","endpoint_b_id") REFERENCES "public"."artifacts"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "narrative_connections" ADD CONSTRAINT "narrative_connections_fact_fk" FOREIGN KEY ("project_id","fact_artifact_id") REFERENCES "public"."artifacts"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "completion_certifications_project_idx" ON "completion_certifications" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "narrative_connections_project_idx" ON "narrative_connections" USING btree ("project_id","created_at");