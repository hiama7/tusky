CREATE TYPE "public"."history_status" AS ENUM('pending', 'scraping', 'ready', 'needs_review', 'failed');--> statement-breakpoint
CREATE TYPE "public"."match_player_role" AS ENUM('squad', 'starting', 'bench');--> statement-breakpoint
CREATE TYPE "public"."match_status" AS ENUM('scheduled', 'live', 'completed', 'postponed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."data_source" AS ENUM('api', 'llm', 'manual');--> statement-breakpoint
CREATE TYPE "public"."scrape_run_status" AS ENUM('running', 'succeeded', 'failed', 'needs_review');--> statement-breakpoint
CREATE TABLE "competitions" (
	"id" serial PRIMARY KEY NOT NULL,
	"sport_id" integer NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"country" text,
	"season" text,
	"logo_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "match_players" (
	"id" serial PRIMARY KEY NOT NULL,
	"match_id" integer NOT NULL,
	"player_id" integer NOT NULL,
	"team_id" integer NOT NULL,
	"role" "match_player_role" DEFAULT 'squad' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" serial PRIMARY KEY NOT NULL,
	"sport_id" integer NOT NULL,
	"competition_id" integer,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"home_team_id" integer NOT NULL,
	"away_team_id" integer NOT NULL,
	"start_time" timestamp with time zone NOT NULL,
	"venue" text,
	"city" text,
	"status" "match_status" DEFAULT 'scheduled' NOT NULL,
	"provider_status" text,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" serial PRIMARY KEY NOT NULL,
	"sport_id" integer NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"nationality" text,
	"birth_date" date,
	"position" text,
	"photo_url" text,
	"current_team_id" integer,
	"history_status" "history_status" DEFAULT 'pending' NOT NULL,
	"history_updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sports" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "sports_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" serial PRIMARY KEY NOT NULL,
	"sport_id" integer NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"country" text,
	"logo_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_insights" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"summary" text NOT NULL,
	"recent_form" jsonb NOT NULL,
	"win_conditions" jsonb NOT NULL,
	"loss_conditions" jsonb NOT NULL,
	"strengths" jsonb NOT NULL,
	"weaknesses" jsonb NOT NULL,
	"injuries" jsonb NOT NULL,
	"key_stats" jsonb NOT NULL,
	"sources" jsonb NOT NULL,
	"confidence" real NOT NULL,
	"source" "data_source" NOT NULL,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_stats" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"season" text NOT NULL,
	"competition_id" integer,
	"competition_name" text DEFAULT '' NOT NULL,
	"source" "data_source" NOT NULL,
	"stats" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "match_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"match_id" integer NOT NULL,
	"type" text NOT NULL,
	"period" text,
	"clock" text,
	"team_id" integer,
	"player_id" integer,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dedupe_key" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "match_events_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "provider_quota" (
	"provider" text NOT NULL,
	"sport" text NOT NULL,
	"day" date NOT NULL,
	"requests_used" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "provider_quota_provider_sport_day_pk" PRIMARY KEY("provider","sport","day")
);
--> statement-breakpoint
CREATE TABLE "scrape_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_name" text NOT NULL,
	"job_id" text,
	"entity_type" text NOT NULL,
	"entity_id" integer NOT NULL,
	"status" "scrape_run_status" DEFAULT 'running' NOT NULL,
	"error" text,
	"llm_provider" text,
	"llm_model" text,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"meta" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "competitions" ADD CONSTRAINT "competitions_sport_id_sports_id_fk" FOREIGN KEY ("sport_id") REFERENCES "public"."sports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_players" ADD CONSTRAINT "match_players_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_players" ADD CONSTRAINT "match_players_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_players" ADD CONSTRAINT "match_players_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_sport_id_sports_id_fk" FOREIGN KEY ("sport_id") REFERENCES "public"."sports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_home_team_id_teams_id_fk" FOREIGN KEY ("home_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_away_team_id_teams_id_fk" FOREIGN KEY ("away_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_sport_id_sports_id_fk" FOREIGN KEY ("sport_id") REFERENCES "public"."sports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_current_team_id_teams_id_fk" FOREIGN KEY ("current_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_sport_id_sports_id_fk" FOREIGN KEY ("sport_id") REFERENCES "public"."sports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_insights" ADD CONSTRAINT "player_insights_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_stats" ADD CONSTRAINT "player_stats_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_stats" ADD CONSTRAINT "player_stats_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_events" ADD CONSTRAINT "match_events_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_events" ADD CONSTRAINT "match_events_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_events" ADD CONSTRAINT "match_events_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "competitions_provider_ext_uq" ON "competitions" USING btree ("sport_id","provider","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "match_players_uq" ON "match_players" USING btree ("match_id","player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "matches_provider_ext_uq" ON "matches" USING btree ("sport_id","provider","external_id");--> statement-breakpoint
CREATE INDEX "matches_status_start_idx" ON "matches" USING btree ("status","start_time");--> statement-breakpoint
CREATE UNIQUE INDEX "players_provider_ext_uq" ON "players" USING btree ("sport_id","provider","external_id");--> statement-breakpoint
CREATE INDEX "players_name_idx" ON "players" USING btree ("name");--> statement-breakpoint
CREATE INDEX "players_history_status_idx" ON "players" USING btree ("history_status");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_provider_ext_uq" ON "teams" USING btree ("sport_id","provider","external_id");--> statement-breakpoint
CREATE INDEX "teams_name_idx" ON "teams" USING btree ("name");--> statement-breakpoint
CREATE INDEX "player_insights_player_idx" ON "player_insights" USING btree ("player_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "player_stats_uq" ON "player_stats" USING btree ("player_id","season","competition_name","source");--> statement-breakpoint
CREATE INDEX "match_events_match_idx" ON "match_events" USING btree ("match_id","occurred_at");--> statement-breakpoint
CREATE INDEX "scrape_runs_entity_idx" ON "scrape_runs" USING btree ("entity_type","entity_id");