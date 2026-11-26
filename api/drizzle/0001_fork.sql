ALTER TABLE "profile" ADD COLUMN "forked_from_id" text;--> statement-breakpoint
ALTER TABLE "profile" ADD COLUMN "forked_from_revision" integer;--> statement-breakpoint
CREATE INDEX "profile_forked_from" ON "profile" USING btree ("forked_from_id");