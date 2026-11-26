CREATE TABLE "key_revocation" (
	"jti" text PRIMARY KEY NOT NULL,
	"sub" text NOT NULL,
	"exp" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "key_revocation_revoked_at" ON "key_revocation" USING btree ("revoked_at");