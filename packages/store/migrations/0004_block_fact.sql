CREATE TABLE "fact_anchors" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"fact_artifact_id" uuid NOT NULL,
	"fact_revision_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "fact_anchors_project_id_id_uq" UNIQUE("project_id","id")
);
--> statement-breakpoint
CREATE TABLE "fact_candidates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"triangle_id" uuid NOT NULL,
	"fact_artifact_id" uuid NOT NULL,
	"fact_revision_id" uuid NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "fact_candidates_triangle_artifact_uq" UNIQUE("triangle_id","fact_artifact_id")
);
--> statement-breakpoint
CREATE TABLE "fact_rationales" (
	"fact_artifact_id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"rationale" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "protocol_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"config" jsonb NOT NULL,
	"status" text NOT NULL,
	"briefs" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "protocol_runs_project_id_id_uq" UNIQUE("project_id","id")
);
--> statement-breakpoint
CREATE TABLE "protocol_tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"run_id" uuid,
	"type" text NOT NULL,
	"role" text NOT NULL,
	"assignee_principal_id" uuid,
	"state" text NOT NULL,
	"stage_index" integer NOT NULL,
	"depth" integer NOT NULL,
	"triangle_id" uuid,
	"side" text,
	"direction" text,
	"result_refs" jsonb NOT NULL,
	"submit_idempotency_key" text,
	"created_at" timestamp with time zone NOT NULL,
	"submitted_at" timestamp with time zone,
	CONSTRAINT "protocol_tasks_project_idempotency_uq" UNIQUE("project_id","submit_idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "triangle_continuations" (
	"triangle_id" uuid NOT NULL,
	"side" text NOT NULL,
	"artifact_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"task_id" uuid,
	CONSTRAINT "triangle_continuations_triangle_id_side_artifact_id_pk" PRIMARY KEY("triangle_id","side","artifact_id")
);
--> statement-breakpoint
CREATE TABLE "triangles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"run_id" uuid,
	"left_artifact_id" uuid NOT NULL,
	"left_revision_id" uuid NOT NULL,
	"left_fact_anchor_id" uuid,
	"right_artifact_id" uuid NOT NULL,
	"right_revision_id" uuid NOT NULL,
	"right_fact_anchor_id" uuid,
	"fact_artifact_id" uuid,
	"fact_revision_id" uuid,
	"status" text NOT NULL,
	"stage_index" integer NOT NULL,
	"depth" integer NOT NULL,
	"parent_triangle_id" uuid,
	"left_direction" text DEFAULT 'forward' NOT NULL,
	"right_direction" text DEFAULT 'backward' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "triangles_project_id_id_uq" UNIQUE("project_id","id")
);
--> statement-breakpoint
ALTER TABLE "agent_principals" ADD COLUMN "executor_kind" text DEFAULT 'ai' NOT NULL;--> statement-breakpoint
ALTER TABLE "artifacts" ADD COLUMN "artifact_class" text DEFAULT 'BLOCK' NOT NULL;--> statement-breakpoint
ALTER TABLE "artifacts" ADD COLUMN "fact_kind" text;--> statement-breakpoint
ALTER TABLE "fact_anchors" ADD CONSTRAINT "fact_anchors_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_anchors" ADD CONSTRAINT "fact_anchors_artifact_fk" FOREIGN KEY ("project_id","fact_artifact_id") REFERENCES "public"."artifacts"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_candidates" ADD CONSTRAINT "fact_candidates_triangle_id_triangles_id_fk" FOREIGN KEY ("triangle_id") REFERENCES "public"."triangles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_rationales" ADD CONSTRAINT "fact_rationales_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_rationales" ADD CONSTRAINT "fact_rationales_artifact_fk" FOREIGN KEY ("project_id","fact_artifact_id") REFERENCES "public"."artifacts"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protocol_runs" ADD CONSTRAINT "protocol_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protocol_tasks" ADD CONSTRAINT "protocol_tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protocol_tasks" ADD CONSTRAINT "protocol_tasks_run_id_protocol_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."protocol_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protocol_tasks" ADD CONSTRAINT "protocol_tasks_assignee_principal_id_agent_principals_id_fk" FOREIGN KEY ("assignee_principal_id") REFERENCES "public"."agent_principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protocol_tasks" ADD CONSTRAINT "protocol_tasks_triangle_id_triangles_id_fk" FOREIGN KEY ("triangle_id") REFERENCES "public"."triangles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triangle_continuations" ADD CONSTRAINT "triangle_continuations_triangle_id_triangles_id_fk" FOREIGN KEY ("triangle_id") REFERENCES "public"."triangles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triangle_continuations" ADD CONSTRAINT "triangle_continuations_task_id_protocol_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."protocol_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triangles" ADD CONSTRAINT "triangles_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triangles" ADD CONSTRAINT "triangles_run_id_protocol_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."protocol_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triangles" ADD CONSTRAINT "triangles_left_fact_anchor_id_fact_anchors_id_fk" FOREIGN KEY ("left_fact_anchor_id") REFERENCES "public"."fact_anchors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triangles" ADD CONSTRAINT "triangles_right_fact_anchor_id_fact_anchors_id_fk" FOREIGN KEY ("right_fact_anchor_id") REFERENCES "public"."fact_anchors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triangles" ADD CONSTRAINT "triangles_left_fk" FOREIGN KEY ("project_id","left_artifact_id") REFERENCES "public"."artifacts"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triangles" ADD CONSTRAINT "triangles_right_fk" FOREIGN KEY ("project_id","right_artifact_id") REFERENCES "public"."artifacts"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triangles" ADD CONSTRAINT "triangles_fact_fk" FOREIGN KEY ("project_id","fact_artifact_id") REFERENCES "public"."artifacts"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triangles" ADD CONSTRAINT "triangles_parent_fk" FOREIGN KEY ("parent_triangle_id") REFERENCES "public"."triangles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fact_anchors_project_idx" ON "fact_anchors" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "fact_candidates_triangle_idx" ON "fact_candidates" USING btree ("triangle_id");--> statement-breakpoint
CREATE INDEX "fact_rationales_project_idx" ON "fact_rationales" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "protocol_runs_project_idx" ON "protocol_runs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "protocol_tasks_project_idx" ON "protocol_tasks" USING btree ("project_id","state");--> statement-breakpoint
CREATE INDEX "protocol_tasks_role_idx" ON "protocol_tasks" USING btree ("project_id","role","state");--> statement-breakpoint
CREATE INDEX "protocol_tasks_triangle_idx" ON "protocol_tasks" USING btree ("triangle_id");--> statement-breakpoint
CREATE INDEX "protocol_tasks_assignee_idx" ON "protocol_tasks" USING btree ("assignee_principal_id");--> statement-breakpoint
CREATE INDEX "triangle_continuations_artifact_idx" ON "triangle_continuations" USING btree ("artifact_id");--> statement-breakpoint
CREATE INDEX "triangles_project_idx" ON "triangles" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "triangles_run_idx" ON "triangles" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "triangles_parent_idx" ON "triangles" USING btree ("parent_triangle_id");