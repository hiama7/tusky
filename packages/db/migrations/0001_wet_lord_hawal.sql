CREATE TABLE "predictions" (
	"id" serial PRIMARY KEY NOT NULL,
	"match_id" integer NOT NULL,
	"sport_id" integer NOT NULL,
	"model_version" text NOT NULL,
	"p_home" double precision NOT NULL,
	"p_draw" double precision NOT NULL,
	"p_away" double precision NOT NULL,
	"exp_home_score" double precision NOT NULL,
	"exp_away_score" double precision NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"features" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "home_score" integer;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "away_score" integer;--> statement-breakpoint
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_sport_id_sports_id_fk" FOREIGN KEY ("sport_id") REFERENCES "public"."sports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "predictions_match_model_uq" ON "predictions" USING btree ("match_id","model_version");--> statement-breakpoint
CREATE INDEX "predictions_match_idx" ON "predictions" USING btree ("match_id","updated_at");