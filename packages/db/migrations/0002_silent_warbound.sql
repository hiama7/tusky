CREATE TABLE "match_aliases" (
	"id" serial PRIMARY KEY NOT NULL,
	"match_id" integer NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_aliases" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_aliases" (
	"id" serial PRIMARY KEY NOT NULL,
	"sport_id" integer NOT NULL,
	"alias" text NOT NULL,
	"team_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "venues" (
	"id" serial PRIMARY KEY NOT NULL,
	"sport_id" integer NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"city" text,
	"country" text,
	"lat" double precision,
	"lon" double precision,
	"timezone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cricket_innings" (
	"id" serial PRIMARY KEY NOT NULL,
	"match_id" integer NOT NULL,
	"innings_no" integer NOT NULL,
	"batting_team_id" integer NOT NULL,
	"bowling_team_id" integer,
	"runs" integer NOT NULL,
	"wickets" integer NOT NULL,
	"legal_balls" integer NOT NULL,
	"extras" integer NOT NULL,
	"target_runs" integer,
	"target_overs" real,
	"declared" boolean DEFAULT false NOT NULL,
	"forfeited" boolean DEFAULT false NOT NULL,
	"is_super_over" boolean DEFAULT false NOT NULL,
	"pp_runs" integer,
	"pp_wkts" integer,
	"mid_runs" integer,
	"mid_wkts" integer,
	"death_runs" integer,
	"death_wkts" integer
);
--> statement-breakpoint
CREATE TABLE "deliveries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"match_id" integer NOT NULL,
	"innings_no" integer NOT NULL,
	"over" integer NOT NULL,
	"ball" integer NOT NULL,
	"batter_id" integer NOT NULL,
	"bowler_id" integer NOT NULL,
	"non_striker_id" integer,
	"runs_batter" integer NOT NULL,
	"runs_extras" integer NOT NULL,
	"runs_total" integer NOT NULL,
	"extras_kind" text,
	"is_legal" boolean NOT NULL,
	"non_boundary" boolean DEFAULT false NOT NULL,
	"wicket_kind" text,
	"player_out_id" integer,
	"extra_wickets" jsonb,
	"bowler_type" text
);
--> statement-breakpoint
CREATE TABLE "ingest_files" (
	"source" text NOT NULL,
	"file_name" text NOT NULL,
	"sha256" text NOT NULL,
	"match_id" integer,
	"status" text NOT NULL,
	"error" text,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ingest_files_source_file_name_pk" PRIMARY KEY("source","file_name")
);
--> statement-breakpoint
CREATE TABLE "match_lineups" (
	"id" serial PRIMARY KEY NOT NULL,
	"match_id" integer NOT NULL,
	"team_id" integer NOT NULL,
	"player_id" integer NOT NULL,
	"batting_position" integer,
	"is_captain" boolean,
	"is_keeper" boolean,
	"source" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "competitions" ADD COLUMN "format" text;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "venue_id" integer;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "format" text;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "toss_winner_team_id" integer;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "toss_decision" text;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "winner_team_id" integer;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "result_type" text;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "neutral_venue" boolean;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "batting_hand" text;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "bowling_style" text;--> statement-breakpoint
ALTER TABLE "match_aliases" ADD CONSTRAINT "match_aliases_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_aliases" ADD CONSTRAINT "player_aliases_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_aliases" ADD CONSTRAINT "team_aliases_sport_id_sports_id_fk" FOREIGN KEY ("sport_id") REFERENCES "public"."sports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_aliases" ADD CONSTRAINT "team_aliases_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venues" ADD CONSTRAINT "venues_sport_id_sports_id_fk" FOREIGN KEY ("sport_id") REFERENCES "public"."sports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cricket_innings" ADD CONSTRAINT "cricket_innings_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cricket_innings" ADD CONSTRAINT "cricket_innings_batting_team_id_teams_id_fk" FOREIGN KEY ("batting_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cricket_innings" ADD CONSTRAINT "cricket_innings_bowling_team_id_teams_id_fk" FOREIGN KEY ("bowling_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_batter_id_players_id_fk" FOREIGN KEY ("batter_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_bowler_id_players_id_fk" FOREIGN KEY ("bowler_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_non_striker_id_players_id_fk" FOREIGN KEY ("non_striker_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_player_out_id_players_id_fk" FOREIGN KEY ("player_out_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_files" ADD CONSTRAINT "ingest_files_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_lineups" ADD CONSTRAINT "match_lineups_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_lineups" ADD CONSTRAINT "match_lineups_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_lineups" ADD CONSTRAINT "match_lineups_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "match_aliases_uq" ON "match_aliases" USING btree ("provider","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "player_aliases_uq" ON "player_aliases" USING btree ("provider","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "team_aliases_uq" ON "team_aliases" USING btree ("sport_id","alias");--> statement-breakpoint
CREATE UNIQUE INDEX "venues_provider_ext_uq" ON "venues" USING btree ("sport_id","provider","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cricket_innings_uq" ON "cricket_innings" USING btree ("match_id","innings_no");--> statement-breakpoint
CREATE INDEX "deliveries_match_idx" ON "deliveries" USING btree ("match_id","innings_no","over","ball");--> statement-breakpoint
CREATE INDEX "deliveries_batter_idx" ON "deliveries" USING btree ("batter_id");--> statement-breakpoint
CREATE INDEX "deliveries_bowler_idx" ON "deliveries" USING btree ("bowler_id");--> statement-breakpoint
CREATE UNIQUE INDEX "match_lineups_uq" ON "match_lineups" USING btree ("match_id","player_id");--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_toss_winner_team_id_teams_id_fk" FOREIGN KEY ("toss_winner_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_winner_team_id_teams_id_fk" FOREIGN KEY ("winner_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;