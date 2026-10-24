CREATE TABLE "artifact_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"artifact_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"actor_id" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "artifact_revisions_artifact_version_uq" UNIQUE("artifact_id","version")
);
--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"structured" jsonb NOT NULL,
	"status" text NOT NULL,
	"creator_role" text NOT NULL,
	"owner_scope" text NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"head_revision_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "artifacts_project_id_id_uq" UNIQUE("project_id","id")
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid,
	"actor_id" text NOT NULL,
	"operation" text NOT NULL,
	"subject_id" text,
	"outcome" text NOT NULL,
	"metadata" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expansion_candidates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"expansion_id" uuid NOT NULL,
	"artifact_id" uuid NOT NULL,
	"score" jsonb NOT NULL,
	"review_status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "expansion_candidates_expansion_artifact_uq" UNIQUE("expansion_id","artifact_id")
);
--> statement-breakpoint
CREATE TABLE "expansions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"target_relation_id" uuid,
	"left_artifact_id" uuid NOT NULL,
	"right_artifact_id" uuid NOT NULL,
	"left_revision_id" uuid NOT NULL,
	"right_revision_id" uuid NOT NULL,
	"parent_expansion_id" uuid,
	"selected_bridge_artifact_id" uuid,
	"depth" integer NOT NULL,
	"status" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"accepted_at" timestamp with time zone,
	"accept_idempotency_key" text,
	"accept_fingerprint_hash" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "expansions_project_idempotency_uq" UNIQUE("project_id","accept_idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "members" (
	"project_id" uuid NOT NULL,
	"principal_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "members_project_id_principal_id_pk" PRIMARY KEY("project_id","principal_id")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"domain" text NOT NULL,
	"settings" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "relations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"from_id" uuid NOT NULL,
	"to_id" uuid NOT NULL,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"expansion_id" uuid,
	"provenance_artifact_ids" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "artifact_revisions" ADD CONSTRAINT "artifact_revisions_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expansion_candidates" ADD CONSTRAINT "expansion_candidates_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expansion_candidates" ADD CONSTRAINT "expansion_candidates_expansion_id_expansions_id_fk" FOREIGN KEY ("expansion_id") REFERENCES "public"."expansions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expansion_candidates" ADD CONSTRAINT "expansion_candidates_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expansions" ADD CONSTRAINT "expansions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expansions" ADD CONSTRAINT "expansions_target_relation_id_relations_id_fk" FOREIGN KEY ("target_relation_id") REFERENCES "public"."relations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expansions" ADD CONSTRAINT "expansions_left_fk" FOREIGN KEY ("project_id","left_artifact_id") REFERENCES "public"."artifacts"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expansions" ADD CONSTRAINT "expansions_right_fk" FOREIGN KEY ("project_id","right_artifact_id") REFERENCES "public"."artifacts"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expansions" ADD CONSTRAINT "expansions_parent_fk" FOREIGN KEY ("parent_expansion_id") REFERENCES "public"."expansions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relations" ADD CONSTRAINT "relations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relations" ADD CONSTRAINT "relations_from_fk" FOREIGN KEY ("project_id","from_id") REFERENCES "public"."artifacts"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relations" ADD CONSTRAINT "relations_to_fk" FOREIGN KEY ("project_id","to_id") REFERENCES "public"."artifacts"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "artifact_revisions_artifact_idx" ON "artifact_revisions" USING btree ("artifact_id");--> statement-breakpoint
CREATE INDEX "artifacts_project_idx" ON "artifacts" USING btree ("project_id","created_at","id");--> statement-breakpoint
CREATE INDEX "audit_events_project_idx" ON "audit_events" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "expansion_candidates_expansion_idx" ON "expansion_candidates" USING btree ("expansion_id");--> statement-breakpoint
CREATE INDEX "expansion_candidates_project_idx" ON "expansion_candidates" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "expansions_target_active_uq" ON "expansions" USING btree ("target_relation_id") WHERE "expansions"."target_relation_id" is not null and "expansions"."status" in ('PENDING','GENERATING','REVIEW','ACCEPTED');--> statement-breakpoint
CREATE INDEX "expansions_project_idx" ON "expansions" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "expansions_parent_idx" ON "expansions" USING btree ("parent_expansion_id");--> statement-breakpoint
CREATE INDEX "expansions_target_idx" ON "expansions" USING btree ("target_relation_id");--> statement-breakpoint
CREATE INDEX "expansions_status_idx" ON "expansions" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "relations_project_idx" ON "relations" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "relations_from_idx" ON "relations" USING btree ("from_id");--> statement-breakpoint
CREATE INDEX "relations_to_idx" ON "relations" USING btree ("to_id");--> statement-breakpoint
CREATE INDEX "relations_expansion_idx" ON "relations" USING btree ("expansion_id");