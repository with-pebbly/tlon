CREATE TABLE "agent_principals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"role" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"disabled_at" timestamp with time zone,
	CONSTRAINT "agent_principals_project_role_name_uq" UNIQUE("project_id","role","name")
);
--> statement-breakpoint
CREATE TABLE "agent_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"principal_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "agent_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "disclosures" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"from_principal_id" text NOT NULL,
	"to_principal_id" uuid NOT NULL,
	"source_refs" jsonb NOT NULL,
	"shared_payload" jsonb NOT NULL,
	"redaction_note" text,
	"status" text NOT NULL,
	"shared_artifact_id" uuid,
	"reviewed_by" text,
	"created_at" timestamp with time zone NOT NULL,
	"reviewed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "grants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"grantee_principal_id" uuid NOT NULL,
	"artifact_id" uuid NOT NULL,
	"permission" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "agent_principals" ADD CONSTRAINT "agent_principals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tokens" ADD CONSTRAINT "agent_tokens_principal_id_agent_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."agent_principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disclosures" ADD CONSTRAINT "disclosures_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disclosures" ADD CONSTRAINT "disclosures_to_principal_id_agent_principals_id_fk" FOREIGN KEY ("to_principal_id") REFERENCES "public"."agent_principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disclosures" ADD CONSTRAINT "disclosures_shared_artifact_id_artifacts_id_fk" FOREIGN KEY ("shared_artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grants" ADD CONSTRAINT "grants_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grants" ADD CONSTRAINT "grants_grantee_principal_id_agent_principals_id_fk" FOREIGN KEY ("grantee_principal_id") REFERENCES "public"."agent_principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grants" ADD CONSTRAINT "grants_artifact_fk" FOREIGN KEY ("project_id","artifact_id") REFERENCES "public"."artifacts"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_principals_project_idx" ON "agent_principals" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "agent_tokens_principal_idx" ON "agent_tokens" USING btree ("principal_id");--> statement-breakpoint
CREATE INDEX "disclosures_project_status_idx" ON "disclosures" USING btree ("project_id","status","created_at");--> statement-breakpoint
CREATE INDEX "disclosures_to_idx" ON "disclosures" USING btree ("to_principal_id","status");--> statement-breakpoint
CREATE INDEX "grants_grantee_artifact_idx" ON "grants" USING btree ("grantee_principal_id","artifact_id");--> statement-breakpoint
CREATE INDEX "grants_project_idx" ON "grants" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "audit_events_actor_idx" ON "audit_events" USING btree ("project_id","actor_id","created_at");