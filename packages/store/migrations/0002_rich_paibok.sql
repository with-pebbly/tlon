CREATE TABLE "composite_definitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"composite_artifact_id" uuid NOT NULL,
	"artifact_revision_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"contract" jsonb NOT NULL,
	"boundary" jsonb NOT NULL,
	"actor_id" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "composite_definitions_artifact_version_uq" UNIQUE("composite_artifact_id","version")
);
--> statement-breakpoint
CREATE TABLE "composite_members" (
	"definition_id" uuid NOT NULL,
	"member_artifact_id" uuid NOT NULL,
	"member_revision_id" uuid NOT NULL,
	"display_order" integer NOT NULL,
	CONSTRAINT "composite_members_definition_id_member_artifact_id_pk" PRIMARY KEY("definition_id","member_artifact_id")
);
--> statement-breakpoint
CREATE TABLE "composite_relation_members" (
	"definition_id" uuid NOT NULL,
	"relation_id" uuid NOT NULL,
	CONSTRAINT "composite_relation_members_definition_id_relation_id_pk" PRIMARY KEY("definition_id","relation_id")
);
--> statement-breakpoint
ALTER TABLE "artifacts" ADD COLUMN "composition" text DEFAULT 'ATOMIC' NOT NULL;--> statement-breakpoint
ALTER TABLE "composite_definitions" ADD CONSTRAINT "composite_definitions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "composite_definitions" ADD CONSTRAINT "composite_definitions_artifact_revision_id_artifact_revisions_id_fk" FOREIGN KEY ("artifact_revision_id") REFERENCES "public"."artifact_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "composite_definitions" ADD CONSTRAINT "composite_definitions_artifact_fk" FOREIGN KEY ("project_id","composite_artifact_id") REFERENCES "public"."artifacts"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "composite_members" ADD CONSTRAINT "composite_members_definition_id_composite_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."composite_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "composite_members" ADD CONSTRAINT "composite_members_member_artifact_id_artifacts_id_fk" FOREIGN KEY ("member_artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "composite_members" ADD CONSTRAINT "composite_members_member_revision_id_artifact_revisions_id_fk" FOREIGN KEY ("member_revision_id") REFERENCES "public"."artifact_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "composite_relation_members" ADD CONSTRAINT "composite_relation_members_definition_id_composite_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."composite_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "composite_relation_members" ADD CONSTRAINT "composite_relation_members_relation_id_relations_id_fk" FOREIGN KEY ("relation_id") REFERENCES "public"."relations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "composite_definitions_project_idx" ON "composite_definitions" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "composite_definitions_composite_idx" ON "composite_definitions" USING btree ("composite_artifact_id");--> statement-breakpoint
CREATE INDEX "composite_members_member_idx" ON "composite_members" USING btree ("member_artifact_id");--> statement-breakpoint
CREATE INDEX "composite_relation_members_relation_idx" ON "composite_relation_members" USING btree ("relation_id");