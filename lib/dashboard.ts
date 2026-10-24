import type { DashboardData } from "./types";
import { pool } from "./db";
import { z } from "zod";
import { date } from "./validation";
import { smtpConfigured } from "./outreach";
import { githubResearchConfigured } from "./research-github";
import { imapConfigured } from "./imap";
const filters = z
  .object({
    from: date,
    to: date,
    kind: z
      .enum([
        "all",
        "advisor",
        "acquirer",
        "search_fund",
        "private_equity",
        "corporate_ma",
        "directory",
        "partner",
      ])
      .default("all"),
  })
  .refine((v) => v.from <= v.to, "Choose a valid date range");
export async function dashboard(input: unknown): Promise<DashboardData> {
  const f = filters.parse(input);
  const db = pool();
  const p = [f.from, f.to, f.kind];
  const queries = {
    researchRuns: `SELECT id,run_key,producer,transport,query,researched_at,received_at,created_count,matched_count,conflict_count FROM research_runs ORDER BY received_at DESC LIMIT 30`,
    researchRecords: `SELECT r.*,o.name AS organization FROM research_records r JOIN research_runs run ON run.id=r.run_id LEFT JOIN organizations o ON o.id=r.organization_id ORDER BY run.received_at DESC,r.record_index LIMIT 200`,
    organizations: `SELECT * FROM organizations ORDER BY created_at DESC`,
    contacts: `SELECT * FROM contacts ORDER BY name`,
    evidence: `SELECT * FROM evidence ORDER BY created_at DESC`,
    messages: `SELECT m.*,o.name AS organization,c.name AS contact_name FROM outreach_messages m JOIN organizations o ON o.id=m.organization_id JOIN contacts c ON c.id=m.contact_id ORDER BY m.created_at DESC`,
    events: `SELECT * FROM outreach_events ORDER BY created_at DESC`,
    partners: `SELECT a.*,p.organization_id,p.url,p.channel,p.terms,p.terms_evidence_url,p.materials,o.name AS organization FROM partner_applications a JOIN partner_programs p ON p.id=a.program_id JOIN organizations o ON o.id=p.organization_id ORDER BY a.created_at DESC`,
    tasks: `SELECT t.*,o.name AS organization FROM tasks t LEFT JOIN organizations o ON o.id=t.organization_id ORDER BY CASE t.status WHEN 'open' THEN 0 ELSE 1 END,t.due_at`,
    reports: `SELECT week::text,report,generated_at FROM marketing_reports ORDER BY week DESC LIMIT 26`,
    opportunityEvents: `SELECT * FROM opportunity_events ORDER BY entered_at DESC`,
    opportunities: `SELECT x.*,o.name AS organization FROM opportunities x JOIN organizations o ON o.id=x.organization_id ORDER BY x.created_at DESC`,
    spend: `SELECT *,day::text AS day FROM spend_records ORDER BY spend_records.day DESC`,
    activity: `SELECT * FROM activity_log ORDER BY created_at DESC LIMIT 200`,
    integrations: `SELECT * FROM integration_status ORDER BY name`,
    jobs: `SELECT * FROM job_runs ORDER BY started_at DESC LIMIT 50`,
    discoveries: `SELECT * FROM discovery_results ORDER BY created_at DESC LIMIT 100`,
  };
  const entries = await Promise.all(
    Object.entries(queries).map(
      async ([name, sql]) => [name, (await db.query(sql)).rows] as const,
    ),
  );
  const records = Object.fromEntries(entries);
  const {
    rows: [metrics],
  } = await db.query(
    `WITH org AS(SELECT * FROM organizations WHERE NOT demo AND ($3='all' OR kind=$3)),
 msg AS(SELECT m.* FROM outreach_messages m JOIN org o ON o.id=m.organization_id),
 ev AS(SELECT e.*,m.organization_id FROM outreach_events e JOIN msg m ON m.id=e.message_id),
 opp AS(SELECT p.id,e.stage,e.entered_at AS created_at FROM opportunities p JOIN org o ON o.id=p.organization_id JOIN opportunity_events e ON e.opportunity_id=p.id)
 SELECT
 (SELECT COUNT(*)::int FROM org WHERE created_at>=$1::date AND created_at<$2::date+1) AS organizations,
 (SELECT COUNT(*)::int FROM contacts c JOIN org o ON o.id=c.organization_id WHERE c.verified_at>=$1::date AND c.verified_at<$2::date+1 AND NOT c.do_not_contact) AS contacts,
 (SELECT COUNT(*)::int FROM msg WHERE created_at>=$1::date AND created_at<$2::date+1) AS drafts,
 (SELECT COUNT(*)::int FROM msg WHERE sent_at>=$1::date AND sent_at<$2::date+1 AND status='sent') AS sent,
 (SELECT COUNT(DISTINCT organization_id)::int FROM ev WHERE kind IN ('reply','positive_reply') AND created_at>=$1::date AND created_at<$2::date+1) AS replies,
 (SELECT COUNT(DISTINCT organization_id)::int FROM ev WHERE kind='positive_reply' AND created_at>=$1::date AND created_at<$2::date+1) AS positive,
 (SELECT COUNT(DISTINCT id)::int FROM opp WHERE stage='qualified' AND created_at>=$1::date AND created_at<$2::date+1) AS qualified,
 (SELECT COUNT(DISTINCT id)::int FROM opp WHERE stage='negotiation' AND created_at>=$1::date AND created_at<$2::date+1) AS negotiations,
 (SELECT COUNT(DISTINCT id)::int FROM opp WHERE stage='proposal' AND created_at>=$1::date AND created_at<$2::date+1) AS proposals,
 (SELECT COUNT(DISTINCT id)::int FROM opp WHERE stage='won' AND created_at>=$1::date AND created_at<$2::date+1) AS won`,
    p,
  );
  const campaigns = (
    await db.query(
      `SELECT account_id,external_id,name,currency,source,SUM(impressions)::float AS impressions,SUM(clicks)::float AS clicks,SUM(cost)::float AS cost,SUM(conversions)::float AS conversions FROM campaigns WHERE day>=$1::date AND day<=$2::date GROUP BY account_id,external_id,name,currency,source ORDER BY SUM(cost) DESC`,
      [f.from, f.to],
    )
  ).rows;
  const totals = (
    await db.query(
      `WITH s AS(SELECT currency,cost AS amount,'ads_data' AS source FROM campaigns WHERE day>=$1::date AND day<=$2::date UNION ALL SELECT currency,amount,confirmation AS source FROM spend_records WHERE day>=$1::date AND day<=$2::date) SELECT currency,source,SUM(amount)::float AS amount FROM s GROUP BY currency,source ORDER BY currency`,
      [f.from, f.to],
    )
  ).rows;
  const weekly = (
    await db.query(
      `WITH o AS(SELECT * FROM organizations WHERE NOT demo AND ($3='all' OR kind=$3)),
 events AS(SELECT date_trunc('week',m.sent_at)::date AS week,'sent' AS kind FROM outreach_messages m JOIN o ON o.id=m.organization_id WHERE m.status='sent' AND m.sent_at>=$1::date AND m.sent_at<$2::date+1
 UNION ALL SELECT date_trunc('week',e.created_at)::date,'replies' FROM outreach_events e JOIN outreach_messages m ON m.id=e.message_id JOIN o ON o.id=m.organization_id WHERE e.kind IN ('reply','positive_reply') AND e.created_at>=$1::date AND e.created_at<$2::date+1
 UNION ALL SELECT date_trunc('week',e.entered_at)::date,e.stage FROM opportunities x JOIN o ON o.id=x.organization_id JOIN opportunity_events e ON e.opportunity_id=x.id WHERE e.entered_at>=$1::date AND e.entered_at<$2::date+1)
 SELECT week::text,COUNT(*) FILTER(WHERE kind='sent')::int AS sent,COUNT(*) FILTER(WHERE kind='replies')::int AS replies,COUNT(*) FILTER(WHERE kind='negotiation')::int AS negotiations,COUNT(*) FILTER(WHERE kind='proposal')::int AS proposals,COUNT(*) FILTER(WHERE kind='won')::int AS won FROM events GROUP BY week ORDER BY week DESC`,
      p,
    )
  ).rows;
  const weeklySpend = (
    await db.query(
      `WITH s AS(SELECT day,currency,cost AS amount FROM campaigns UNION ALL SELECT day,currency,amount FROM spend_records) SELECT date_trunc('week',day)::date::text AS week,currency,SUM(amount)::float AS amount FROM s WHERE day>=$1::date AND day<=$2::date GROUP BY 1,2 ORDER BY 1 DESC,2`,
      [f.from, f.to],
    )
  ).rows;
  return JSON.parse(
    JSON.stringify({
      ...records,
      metrics,
      campaigns,
      totals,
      weekly,
      weeklySpend,
      filters: f,
      connections: {
        smtp: smtpConfigured(),
        research:
          Boolean(process.env.RESEARCH_INGEST_SECRET) ||
          githubResearchConfigured(),
        researchGithub: githubResearchConfigured(),
        imap: imapConfigured(),
        search: Boolean(process.env.BRAVE_SEARCH_API_KEY),
        adsScripts: Boolean(process.env.ADS_INGEST_SECRET),
        cron: Boolean(process.env.CRON_SECRET),
        database: true,
      },
      budgets: JSON.parse(process.env.DAILY_BUDGETS || "{}"),
    }),
  );
}
