CREATE TABLE "account_pref" (
	"sub" text PRIMARY KEY NOT NULL,
	"deletion_credit" text DEFAULT 'deleted' NOT NULL,
	"deletion_name" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
