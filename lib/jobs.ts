import { randomUUID } from "node:crypto";
import { pool, transaction } from "./db";
import { audit } from "./audit";
export async function runJobs(key: string, actor = "cron") {
  const jobId = randomUUID();
  const claim = await pool().query(
    `INSERT INTO job_runs(id,job_key,status) VALUES($1,$2,'running') ON CONFLICT(job_key) DO UPDATE SET status='running',started_at=now(),finished_at=NULL,error=NULL,attempts=job_runs.attempts+1 WHERE job_runs.status='failed' OR (job_runs.status='running' AND job_runs.started_at<now()-interval '10 minutes') RETURNING id`,
    [jobId, key],
  );
  if (!claim.rowCount) return { skipped: true };
  const runId = claim.rows[0].id;
  try {
    return await transaction(async (db) => {
      await db.query("SELECT pg_advisory_xact_lock(8734622)");
      const stale = await db.query(
        "UPDATE outreach_messages SET status='uncertain',last_error='Interrupted SMTP attempt; verify mailbox before manual resolution' WHERE status='sending' AND send_started_at<now()-interval '10 minutes' RETURNING id",
      );
      for (const row of stale.rows) {
        await db.query(
          "INSERT INTO outreach_events(id,message_id,kind,detail) VALUES($1,$2,'uncertain','Stale SMTP attempt found by safe background job')",
          [randomUUID(), row.id],
        );
      }
      const reviews = await db.query(
        "SELECT id,name FROM organizations WHERE verified_at<now()-interval '30 days' AND status<>'do_not_contact' AND NOT demo",
      );
      let created = 0;
      for (const o of reviews.rows) {
        const r = await db.query(
          `INSERT INTO tasks(id,organization_id,title,due_at,dedupe_key) VALUES($1,$2,$3,now(),$4) ON CONFLICT(dedupe_key) DO NOTHING`,
          [
            randomUUID(),
            o.id,
            `Recheck public evidence for ${o.name}`,
            `verify:${o.id}:${new Date().toISOString().slice(0, 7)}`,
          ],
        );
        created += r.rowCount || 0;
      }
      const budgets = JSON.parse(process.env.DAILY_BUDGETS || "{}") as Record<
        string,
        number
      >;
      const multiplier = Number(process.env.SPEND_ANOMALY_MULTIPLIER || 2);
      const totals =
        await db.query(`WITH spends AS (SELECT day,currency,cost AS amount FROM campaigns UNION ALL SELECT day,currency,amount FROM spend_records)
   SELECT day::text,currency,SUM(amount)::float AS total FROM spends WHERE day>=CURRENT_DATE-8 AND day<=CURRENT_DATE GROUP BY day,currency`);
      let alerts = 0;
      for (const r of totals.rows.filter(
        (r) => r.day === new Date().toISOString().slice(0, 10),
      )) {
        const previous =
          totals.rows
            .filter((p) => p.currency === r.currency && p.day < r.day)
            .reduce((s, p) => s + Number(p.total), 0) / 7;
        const budget = budgets[r.currency];
        const over =
          typeof budget === "number" &&
          Number.isFinite(budget) &&
          r.total > budget;
        const anomaly = previous > 0 && r.total > previous * multiplier;
        if (over || anomaly) {
          const inserted = await db.query(
            `INSERT INTO tasks(id,title,due_at,kind,dedupe_key) VALUES($1,$2,now(),'alert',$3) ON CONFLICT(dedupe_key) DO NOTHING`,
            [
              randomUUID(),
              `Spend alert: ${r.currency} ${r.total.toFixed(2)} today${over ? ` exceeds ${budget}` : ""}${anomaly ? " exceeds recent daily average" : ""}`,
              `budget:${r.day}:${r.currency}`,
            ],
          );
          alerts += inserted.rowCount || 0;
        }
      }
      const reportQuery =
        await db.query(`WITH period AS(SELECT date_trunc('week',now())-interval '1 week' AS start,date_trunc('week',now()) AS finish)
   INSERT INTO marketing_reports(week,report) SELECT start::date,jsonb_build_object(
    'sent',COALESCE((SELECT jsonb_agg(jsonb_build_object('organization',o.name,'recipient',m.recipient,'subject',m.subject)) FROM outreach_messages m JOIN organizations o ON o.id=m.organization_id WHERE NOT o.demo AND m.status='sent' AND m.sent_at>=start AND m.sent_at<finish),'[]'::jsonb),
    'replies',COALESCE((SELECT jsonb_agg(jsonb_build_object('organization',o.name,'kind',e.kind,'detail',e.detail)) FROM outreach_events e JOIN outreach_messages m ON m.id=e.message_id JOIN organizations o ON o.id=m.organization_id WHERE NOT o.demo AND e.kind IN ('reply','positive_reply','opt_out') AND e.created_at>=start AND e.created_at<finish),'[]'::jsonb),
    'opportunities',COALESCE((SELECT jsonb_agg(jsonb_build_object('organization',o.name,'stage',e.stage,'notes',x.notes)) FROM opportunity_events e JOIN opportunities x ON x.id=e.opportunity_id JOIN organizations o ON o.id=x.organization_id WHERE NOT o.demo AND e.entered_at>=start AND e.entered_at<finish),'[]'::jsonb),
    'spend',COALESCE((SELECT jsonb_agg(jsonb_build_object('currency',s.currency,'amount',s.amount)) FROM (SELECT currency,SUM(amount)::float AS amount FROM (SELECT currency,cost AS amount,day FROM campaigns UNION ALL SELECT currency,amount,day FROM spend_records) raw WHERE day>=start::date AND day<finish::date GROUP BY currency) s),'[]'::jsonb)
   ) FROM period ON CONFLICT(week) DO UPDATE SET report=EXCLUDED.report,generated_at=now() RETURNING week::text`);
      const result = {
        evidenceReviews: created,
        uncertainDeliveries: stale.rowCount,
        alerts,
        reportWeek: reportQuery.rows[0].week,
      };
      await audit(db, actor, "jobs.safe_checks_completed", runId, result);
      await db.query(
        "UPDATE job_runs SET status='succeeded',finished_at=now(),result=$2 WHERE id=$1",
        [runId, JSON.stringify(result)],
      );
      return result;
    });
  } catch {
    await pool().query(
      "UPDATE job_runs SET status='failed',finished_at=now(),error='Safe job failed; inspect configuration/database and retry manually' WHERE id=$1",
      [runId],
    );
    throw new Error(
      "Safe job failed. No emails, applications or advertising changes were sent.",
    );
  }
}
