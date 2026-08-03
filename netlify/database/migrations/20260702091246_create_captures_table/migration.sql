CREATE TABLE IF NOT EXISTS "captures" (
	"id" serial PRIMARY KEY,
	"blob_key" text NOT NULL,
	"status" text NOT NULL,
	"camera_label" text NOT NULL,
	"threshold" double precision NOT NULL,
	"brightness" double precision NOT NULL,
	"sharpness" double precision NOT NULL,
	"contrast" double precision NOT NULL,
	"overall" double precision NOT NULL,
	"image_bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
