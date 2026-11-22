CREATE TABLE "articles" (
	"id" serial PRIMARY KEY,
	"slug" text NOT NULL UNIQUE,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"sections" jsonb NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL
);
