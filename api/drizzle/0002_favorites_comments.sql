CREATE TABLE "comment" (
	"id" serial PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"revision" integer NOT NULL,
	"parent_id" integer,
	"sub" text NOT NULL,
	"callsign" text,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"hidden_at" timestamp with time zone,
	"hidden_by_sub" text
);
--> statement-breakpoint
CREATE TABLE "favorite" (
	"profile_id" text NOT NULL,
	"sub" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "favorite_profile_id_sub_pk" PRIMARY KEY("profile_id","sub")
);
--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_profile_id_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorite" ADD CONSTRAINT "favorite_profile_id_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comment_profile" ON "comment" USING btree ("profile_id","created_at");--> statement-breakpoint
CREATE INDEX "comment_sub" ON "comment" USING btree ("sub","created_at");--> statement-breakpoint
CREATE INDEX "favorite_sub" ON "favorite" USING btree ("sub","created_at");--> statement-breakpoint
-- Favorites were public stars until 2026-11-25: keep everyone's saved list.
INSERT INTO "favorite" ("profile_id", "sub", "created_at") SELECT "profile_id", "sub", "created_at" FROM "star" ON CONFLICT DO NOTHING;
