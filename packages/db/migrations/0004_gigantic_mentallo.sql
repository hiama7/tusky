CREATE TABLE "match_weather" (
	"match_id" integer PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"kind" text NOT NULL,
	"date" date NOT NULL,
	"temp_mean" double precision,
	"humidity_mean" double precision,
	"dew_point_mean" double precision,
	"wind_max" double precision,
	"cloud_mean" double precision,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "geo_source" text;--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "geo_match" text;--> statement-breakpoint
ALTER TABLE "match_weather" ADD CONSTRAINT "match_weather_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;