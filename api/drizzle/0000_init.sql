CREATE TABLE "api_key" (
	"id" text PRIMARY KEY NOT NULL,
	"prefix" text NOT NULL,
	"hash" text NOT NULL,
	"kind" text NOT NULL,
	"owner_sub" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"actor_sub" text NOT NULL,
	"action" text NOT NULL,
	"target" text NOT NULL,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile" (
	"id" text PRIMARY KEY NOT NULL,
	"rig_macro" text NOT NULL,
	"operation" text NOT NULL,
	"title" text NOT NULL,
	"current_revision" integer DEFAULT 1 NOT NULL,
	"published_revision" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"owner_sub" text NOT NULL,
	"owner_callsign" text,
	"star_count" integer DEFAULT 0 NOT NULL,
	"worked_count" integer DEFAULT 0 NOT NULL,
	"not_worked_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_revision" (
	"profile_id" text NOT NULL,
	"revision" integer NOT NULL,
	"document" json NOT NULL,
	"hamlib" text NOT NULL,
	"created_by_sub" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_revision_profile_id_revision_pk" PRIMARY KEY("profile_id","revision")
);
--> statement-breakpoint
CREATE TABLE "report" (
	"id" serial PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"revision" integer NOT NULL,
	"sub" text NOT NULL,
	"callsign" text,
	"worked" boolean NOT NULL,
	"firmware" text,
	"hamlib" text,
	"interface" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "star" (
	"profile_id" text NOT NULL,
	"sub" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "star_profile_id_sub_pk" PRIMARY KEY("profile_id","sub")
);
--> statement-breakpoint
ALTER TABLE "profile_revision" ADD CONSTRAINT "profile_revision_profile_id_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report" ADD CONSTRAINT "report_profile_id_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "star" ADD CONSTRAINT "star_profile_id_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_key_hash" ON "api_key" USING btree ("hash");--> statement-breakpoint
CREATE INDEX "api_key_owner" ON "api_key" USING btree ("owner_sub");--> statement-breakpoint
CREATE INDEX "profile_rig_op" ON "profile" USING btree ("rig_macro","operation");--> statement-breakpoint
CREATE INDEX "profile_owner" ON "profile" USING btree ("owner_sub");--> statement-breakpoint
CREATE UNIQUE INDEX "report_one_per_revision" ON "report" USING btree ("profile_id","revision","sub");