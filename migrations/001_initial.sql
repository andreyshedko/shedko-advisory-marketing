CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE organizations (
 id uuid PRIMARY KEY, name text NOT NULL, normalized_name text NOT NULL UNIQUE, domain text NOT NULL UNIQUE,
 website text NOT NULL, country text NOT NULL, kind text NOT NULL CHECK(kind IN ('advisor','acquirer','search_fund','private_equity','corporate_ma','directory','partner')),
 relevance text NOT NULL, contact_channel text, status text NOT NULL DEFAULT 'discovered' CHECK(status IN ('discovered','researched','qualified','contacted','replied','do_not_contact')),
 verified_at timestamptz, next_action text, demo boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE contacts (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id), name text, role text, email text NOT NULL,
 evidence_url text NOT NULL, verified_at timestamptz, do_not_contact boolean NOT NULL DEFAULT false,
 UNIQUE(organization_id,email)
);
CREATE TABLE evidence (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id), url text NOT NULL, note text NOT NULL,
 checked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,url)
);
CREATE TABLE partner_programs (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id), url text NOT NULL,
 channel text NOT NULL CHECK(channel IN ('directory','application','contact_form','partner_program')),
 terms text, terms_evidence_url text, materials text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,url)
);
CREATE TABLE partner_applications (
 id uuid PRIMARY KEY, program_id uuid NOT NULL REFERENCES partner_programs(id), draft text NOT NULL,
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('discovered','researched','draft','review','submitted','replied','accepted','rejected')),
 submitted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE outreach_messages (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id), contact_id uuid NOT NULL REFERENCES contacts(id),
 recipient text NOT NULL, subject text NOT NULL, body text NOT NULL,
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','sending','sent','failed','uncertain','cancelled')),
 parent_id uuid REFERENCES outreach_messages(id), approved_at timestamptz, sent_at timestamptz,
 smtp_message_id text UNIQUE, last_error text, send_started_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_followup ON outreach_messages(parent_id) WHERE parent_id IS NOT NULL;
CREATE UNIQUE INDEX one_initial_per_contact ON outreach_messages(contact_id) WHERE parent_id IS NULL AND status <> 'cancelled';
CREATE TABLE outreach_events (
 id uuid PRIMARY KEY, message_id uuid NOT NULL REFERENCES outreach_messages(id),
 kind text NOT NULL CHECK(kind IN ('approved','smtp_accepted','smtp_failed','uncertain','reply','positive_reply','opt_out','manual_resolution')),
 detail text, external_id text UNIQUE, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE suppressions(email text PRIMARY KEY, reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE tasks (
 id uuid PRIMARY KEY, organization_id uuid REFERENCES organizations(id), message_id uuid REFERENCES outreach_messages(id),
 title text NOT NULL, due_at timestamptz NOT NULL, status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','done','cancelled')),
 kind text NOT NULL DEFAULT 'manual' CHECK(kind IN ('manual','followup','alert')), dedupe_key text UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE opportunities (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id),
 stage text NOT NULL CHECK(stage IN ('qualified','negotiation','proposal','won','lost')), notes text NOT NULL,
 value numeric(14,2), currency text NOT NULL DEFAULT 'USD' CHECK(currency ~ '^[A-Z]{3}$'), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE campaigns (
 id uuid PRIMARY KEY, account_id text NOT NULL, external_id text NOT NULL, name text NOT NULL, currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 day date NOT NULL, impressions bigint NOT NULL CHECK(impressions >= 0), clicks bigint NOT NULL CHECK(clicks >= 0),
 cost numeric(14,2) NOT NULL CHECK(cost >= 0), conversions numeric(14,4) NOT NULL CHECK(conversions >= 0),
 source text NOT NULL CHECK(source IN ('csv','scripts')), imported_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(account_id,external_id,day)
);
CREATE TABLE spend_records (
 id uuid PRIMARY KEY, category text NOT NULL CHECK(category IN ('tools','platforms','advertising')), label text NOT NULL,
 amount numeric(14,2) NOT NULL CHECK(amount >= 0), currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 day date NOT NULL, confirmation text NOT NULL CHECK(confirmation IN ('manual','confirmed')), evidence_url text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE activity_log (
 id uuid PRIMARY KEY, actor text NOT NULL, action text NOT NULL, entity_id text, detail jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE integration_status (
 name text PRIMARY KEY, status text NOT NULL, last_success_at timestamptz, detail text, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE job_runs (
 id uuid PRIMARY KEY, job_key text NOT NULL UNIQUE, status text NOT NULL CHECK(status IN ('running','succeeded','failed')),
 attempts integer NOT NULL DEFAULT 1, started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz, error text, result jsonb
);
CREATE TABLE discovery_results (
 id uuid PRIMARY KEY, query text NOT NULL, title text NOT NULL, url text NOT NULL UNIQUE, description text,
 status text NOT NULL DEFAULT 'unverified', created_at timestamptz NOT NULL DEFAULT now()
);
-- Better Auth's standard PostgreSQL schema, signup disabled in production configuration.
CREATE TABLE "user" (id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE, "emailVerified" boolean NOT NULL DEFAULT false, image text, "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now());
CREATE TABLE session (id text PRIMARY KEY, "expiresAt" timestamptz NOT NULL, token text NOT NULL UNIQUE, "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now(), "ipAddress" text, "userAgent" text, "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE);
CREATE TABLE account (id text PRIMARY KEY, "accountId" text NOT NULL, "providerId" text NOT NULL, "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz, scope text, password text, "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now());
CREATE TABLE verification (id text PRIMARY KEY, identifier text NOT NULL, value text NOT NULL, "expiresAt" timestamptz NOT NULL, "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now());
CREATE TABLE "rateLimit" (id text PRIMARY KEY, key text NOT NULL UNIQUE, count integer NOT NULL, "lastRequest" bigint NOT NULL);
CREATE INDEX sessions_by_user ON session("userId");
CREATE INDEX account_user ON account("userId");
CREATE INDEX tasks_due ON tasks(status,due_at);
CREATE INDEX campaigns_day ON campaigns(day);
CREATE INDEX events_message ON outreach_events(message_id);
