CREATE TABLE "issue_dismissals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"issue_key" text NOT NULL,
	"resolution" text NOT NULL,
	"reason" text NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transition_annotations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"artifact_id" uuid NOT NULL,
	"artifact_revision_id" uuid NOT NULL,
	"transition" jsonb NOT NULL,
	"source" text NOT NULL,
	"reviewed" boolean NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "issue_dismissals" ADD CONSTRAINT "issue_dismissals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transition_annotations" ADD CONSTRAINT "transition_annotations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transition_annotations" ADD CONSTRAINT "transition_annotations_artifact_revision_id_artifact_revisions_id_fk" FOREIGN KEY ("artifact_revision_id") REFERENCES "public"."artifact_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transition_annotations" ADD CONSTRAINT "transition_annotations_artifact_fk" FOREIGN KEY ("project_id","artifact_id") REFERENCES "public"."artifacts"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "issue_dismissals_project_key_idx" ON "issue_dismissals" USING btree ("project_id","issue_key");--> statement-breakpoint
CREATE INDEX "transition_annotations_artifact_idx" ON "transition_annotations" USING btree ("artifact_id","created_at");