CREATE TABLE opportunity_events (
 id uuid PRIMARY KEY, opportunity_id uuid NOT NULL REFERENCES opportunities(id), stage text NOT NULL CHECK(stage IN ('qualified','negotiation','proposal','won','lost')),
 entered_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX opportunity_stage_dates ON opportunity_events(entered_at,stage);
INSERT INTO opportunity_events(id,opportunity_id,stage,entered_at) SELECT id,id,stage,created_at FROM opportunities;
CREATE TABLE marketing_reports (
 week date PRIMARY KEY, report jsonb NOT NULL, generated_at timestamptz NOT NULL DEFAULT now()
);
