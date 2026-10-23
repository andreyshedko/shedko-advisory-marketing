CREATE TABLE research_runs (
 id uuid PRIMARY KEY, run_key text NOT NULL UNIQUE, payload_hash text NOT NULL,
 producer text NOT NULL, transport text NOT NULL CHECK(transport IN ('local','http','manual','github')),
 query text NOT NULL, researched_at timestamptz NOT NULL, received_at timestamptz NOT NULL DEFAULT now(),
 created_count integer NOT NULL DEFAULT 0, matched_count integer NOT NULL DEFAULT 0, conflict_count integer NOT NULL DEFAULT 0
);
CREATE TABLE research_records (
 id uuid PRIMARY KEY, run_id uuid NOT NULL REFERENCES research_runs(id), record_index integer NOT NULL,
 organization_id uuid REFERENCES organizations(id), candidate jsonb NOT NULL,
 outcome text NOT NULL CHECK(outcome IN ('created','matched','conflict')), note text NOT NULL,
 UNIQUE(run_id,record_index)
);
CREATE INDEX research_runs_received ON research_runs(received_at DESC);
