import { randomUUID } from "node:crypto";
import { z } from "zod";
import { transaction } from "./db";
import { audit } from "./audit";
import {
  BusinessError,
  orgInput,
  contactInput,
  normalizeDomain,
  normalizeName,
  ensure,
  id,
  text,
  url,
  date,
} from "./validation";
import {
  draftMessage,
  editMessage,
  approveMessage,
  sendMessage,
  recordReply,
  scheduleFollowup,
  resolveDelivery,
} from "./outreach";
import { importAds, parseAdsCsv } from "./ads";
import { runJobs } from "./jobs";
import { importResearch } from "./research";
import { syncGithubResearch } from "./research-github";
export async function operate(input: unknown, actor: string): Promise<unknown> {
  const raw = z.object({ action: z.string(), data: z.unknown() }).parse(input);
  switch (raw.action) {
    case "research.import": {
      const data = z.object({ json: text.max(1_000_000) }).parse(raw.data);
      let parsed: unknown;
      try {
        parsed = JSON.parse(data.json);
      } catch {
        throw new BusinessError("Invalid research JSON");
      }
      return importResearch(parsed, "manual", actor);
    }
    case "research.sync": {
      const data = z
        .object({ force: z.boolean().default(true) })
        .parse(raw.data);
      const result = await syncGithubResearch(data.force);
      if (!("skipped" in result))
        await transaction((db) =>
          audit(db, actor, "research.synced", null, {
            force: data.force,
            ...result,
          }),
        );
      return result;
    }
    case "organization.create": {
      const v = orgInput.parse(raw.data);
      return transaction(async (db) => {
        const orgId = randomUUID();
        await db.query(
          "INSERT INTO organizations(id,name,normalized_name,domain,website,country,kind,relevance,contact_channel,verified_at,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
          [
            orgId,
            v.name,
            normalizeName(v.name),
            normalizeDomain(v.website),
            v.website,
            v.country,
            v.kind,
            v.relevance,
            v.contactChannel || null,
            v.verified ? new Date() : null,
            v.verified ? "researched" : "discovered",
          ],
        );
        await db.query(
          "INSERT INTO evidence(id,organization_id,url,note,checked_at) VALUES($1,$2,$3,$4,$5)",
          [
            randomUUID(),
            orgId,
            v.sourceUrl,
            v.sourceNote,
            v.verified ? new Date() : null,
          ],
        );
        await audit(db, actor, "organization.created", orgId, {
          verified: v.verified,
        });
        return { id: orgId };
      });
    }
    case "contact.create": {
      const v = contactInput.parse(raw.data);
      return transaction(async (db) => {
        const contactId = randomUUID();
        ensure(
          !(
            await db.query("SELECT 1 FROM suppressions WHERE email=$1", [
              v.email,
            ])
          ).rowCount,
          "Contact opted out",
        );
        await db.query(
          "INSERT INTO contacts(id,organization_id,name,role,email,evidence_url,verified_at) VALUES($1,$2,$3,$4,$5,$6,now())",
          [
            contactId,
            v.organizationId,
            v.name || null,
            v.role || null,
            v.email,
            v.evidenceUrl,
          ],
        );
        await audit(db, actor, "contact.verified", contactId);
        return { id: contactId };
      });
    }
    case "evidence.create": {
      const v = z
        .object({ organizationId: id, url, note: text, verified: z.boolean() })
        .parse(raw.data);
      return transaction(async (db) => {
        const evidenceId = randomUUID();
        await db.query(
          "INSERT INTO evidence(id,organization_id,url,note,checked_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(organization_id,url) DO UPDATE SET note=EXCLUDED.note,checked_at=EXCLUDED.checked_at",
          [
            evidenceId,
            v.organizationId,
            v.url,
            v.note,
            v.verified ? new Date() : null,
          ],
        );
        if (v.verified)
          await db.query(
            "UPDATE organizations SET verified_at=now(),status=CASE WHEN status='discovered' THEN 'researched' ELSE status END WHERE id=$1",
            [v.organizationId],
          );
        await audit(db, actor, "evidence.saved", v.organizationId);
        return { id: evidenceId };
      });
    }
    case "organization.update": {
      const v = z
        .object({
          id,
          status: z.enum([
            "discovered",
            "researched",
            "qualified",
            "contacted",
            "replied",
            "do_not_contact",
          ]),
          nextAction: z.string().max(1000),
        })
        .parse(raw.data);
      return transaction(async (db) => {
        const {
          rows: [org],
        } = await db.query(
          "SELECT status FROM organizations WHERE id=$1 FOR UPDATE",
          [v.id],
        );
        ensure(org, "Organization not found");
        ensure(
          org.status !== "do_not_contact" || v.status === "do_not_contact",
          "Opt-out cannot be cleared by a status edit",
        );
        await db.query(
          "UPDATE organizations SET status=$2,next_action=$3 WHERE id=$1",
          [v.id, v.status, v.nextAction],
        );
        if (v.status === "do_not_contact") {
          await db.query(
            "INSERT INTO suppressions(email,reason) SELECT email,'Organization suppression' FROM contacts WHERE organization_id=$1 ON CONFLICT(email) DO NOTHING",
            [v.id],
          );
          await db.query(
            "UPDATE contacts SET do_not_contact=true WHERE organization_id=$1",
            [v.id],
          );
          await db.query(
            "UPDATE outreach_messages SET status='cancelled' WHERE organization_id=$1 AND status IN ('draft','approved')",
            [v.id],
          );
          await db.query(
            "UPDATE tasks SET status='cancelled' WHERE organization_id=$1 AND kind='followup' AND status='open'",
            [v.id],
          );
        }
        await audit(db, actor, "organization.updated", v.id, {
          status: v.status,
        });
        return { id: v.id };
      });
    }
    case "message.draft":
      return draftMessage(raw.data, actor);
    case "message.edit": {
      const v = z
        .object({ id, subject: text.max(250), body: text.max(15000) })
        .parse(raw.data);
      return editMessage(v.id, v.subject, v.body, actor);
    }
    case "message.approve": {
      const v = z
        .object({
          id,
          revision: z.number().int().positive(),
          confirmed: z.literal(true),
        })
        .parse(raw.data);
      return approveMessage(v.id, actor, v.confirmed, v.revision);
    }
    case "message.send": {
      const v = z
        .object({
          id,
          revision: z.number().int().positive(),
          confirmed: z.literal(true),
        })
        .parse(raw.data);
      return sendMessage(v.id, actor, v.confirmed, undefined, v.revision);
    }
    case "message.reply": {
      const v = z
        .object({
          id,
          kind: z.enum(["reply", "positive_reply", "opt_out"]),
          detail: text,
        })
        .parse(raw.data);
      return recordReply(v.id, v.kind, v.detail, actor);
    }
    case "message.followup": {
      const v = z
        .object({ id, dueAt: z.iso.datetime({ offset: true }) })
        .parse(raw.data);
      return scheduleFollowup(v.id, v.dueAt, actor);
    }
    case "message.resolve": {
      const v = z
        .object({ id, delivered: z.boolean(), note: text })
        .parse(raw.data);
      return resolveDelivery(v.id, v.delivered, v.note, actor);
    }
    case "partner.create": {
      const v = z
        .object({
          organizationId: id,
          url,
          channel: z.enum([
            "directory",
            "application",
            "contact_form",
            "partner_program",
          ]),
          terms: z.string().max(5000).optional(),
          termsUrl: url.optional(),
          materials: text,
        })
        .parse(raw.data);
      ensure(
        !v.terms || v.termsUrl,
        "Provide a source for participation terms",
      );
      return transaction(async (db) => {
        const programId = randomUUID();
        const appId = randomUUID();
        const {
          rows: [org],
        } = await db.query(
          "SELECT name,relevance FROM organizations WHERE id=$1",
          [v.organizationId],
        );
        ensure(org, "Organization not found");
        await db.query(
          "INSERT INTO partner_programs(id,organization_id,url,channel,terms,terms_evidence_url,materials) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [
            programId,
            v.organizationId,
            v.url,
            v.channel,
            v.terms || null,
            v.termsUrl || null,
            v.materials,
          ],
        );
        const draft = `Partnership proposal for ${org.name}\n\n${org.relevance}\n\nShedko Advisory provides independent technology / technical due diligence for investors and technology acquirers across the US, UK, Europe and Canada. We would welcome a discussion about supporting your clients with technical risk assessment.\n\nMaterials to prepare:\n${v.materials}\n\nPlease review this draft and verify all claims before submitting.`;
        await db.query(
          "INSERT INTO partner_applications(id,program_id,draft) VALUES($1,$2,$3)",
          [appId, programId, draft],
        );
        await audit(db, actor, "partner.drafted", appId);
        return { id: appId };
      });
    }
    case "partner.update": {
      const v = z
        .object({
          id,
          draft: text.max(20000),
          status: z.enum([
            "discovered",
            "researched",
            "draft",
            "review",
            "submitted",
            "replied",
            "accepted",
            "rejected",
          ]),
          confirmed: z.boolean().default(false),
        })
        .parse(raw.data);
      return transaction(async (db) => {
        const {
          rows: [app],
        } = await db.query(
          "SELECT status FROM partner_applications WHERE id=$1 FOR UPDATE",
          [v.id],
        );
        ensure(app, "Application not found");
        const transitions: Record<string, string[]> = {
          discovered: ["researched"],
          researched: ["draft"],
          draft: ["review"],
          review: ["draft", "submitted"],
          submitted: ["replied", "accepted", "rejected"],
          replied: ["accepted", "rejected"],
          accepted: [],
          rejected: [],
        };
        ensure(
          v.status === app.status || transitions[app.status].includes(v.status),
          "Invalid application status transition",
        );
        if (v.status === "submitted" && app.status !== "submitted")
          ensure(
            v.confirmed,
            "Confirm that you manually submitted this reviewed application",
          );
        await db.query(
          "UPDATE partner_applications SET draft=$2,status=$3,submitted_at=CASE WHEN $3='submitted' THEN COALESCE(submitted_at,now()) ELSE submitted_at END WHERE id=$1",
          [v.id, v.draft, v.status],
        );
        await audit(db, actor, "partner.updated", v.id, {
          status: v.status,
          manualSubmission: v.confirmed,
        });
        return { id: v.id };
      });
    }
    case "opportunity.create": {
      const v = z
        .object({
          organizationId: id,
          stage: z.enum([
            "qualified",
            "negotiation",
            "proposal",
            "won",
            "lost",
          ]),
          notes: text,
          value: z.coerce.number().nonnegative().max(1e10).optional(),
          currency: z.string().regex(/^[A-Z]{3}$/),
        })
        .parse(raw.data);
      return transaction(async (db) => {
        const opportunityId = randomUUID();
        await db.query(
          "INSERT INTO opportunities(id,organization_id,stage,notes,value,currency) VALUES($1,$2,$3,$4,$5,$6)",
          [
            opportunityId,
            v.organizationId,
            v.stage,
            v.notes,
            v.value ?? null,
            v.currency,
          ],
        );
        await db.query(
          "INSERT INTO opportunity_events(id,opportunity_id,stage) VALUES($1,$2,$3)",
          [randomUUID(), opportunityId, v.stage],
        );
        await audit(db, actor, "opportunity.created", opportunityId, {
          stage: v.stage,
        });
        return { id: opportunityId };
      });
    }
    case "opportunity.update": {
      const v = z
        .object({
          id,
          stage: z.enum([
            "qualified",
            "negotiation",
            "proposal",
            "won",
            "lost",
          ]),
          notes: text,
        })
        .parse(raw.data);
      return transaction(async (db) => {
        const previous = await db.query(
          "SELECT stage FROM opportunities WHERE id=$1 FOR UPDATE",
          [v.id],
        );
        ensure(previous.rowCount, "Opportunity not found");
        await db.query(
          "UPDATE opportunities SET stage=$2,notes=$3 WHERE id=$1",
          [v.id, v.stage, v.notes],
        );
        if (previous.rows[0].stage !== v.stage)
          await db.query(
            "INSERT INTO opportunity_events(id,opportunity_id,stage) VALUES($1,$2,$3)",
            [randomUUID(), v.id, v.stage],
          );
        await audit(db, actor, "opportunity.updated", v.id, { stage: v.stage });
        return { id: v.id };
      });
    }
    case "spend.create": {
      const v = z
        .object({
          category: z.enum(["tools", "platforms", "advertising"]),
          label: text.max(200),
          amount: z.coerce.number().nonnegative().max(1e10),
          currency: z.string().regex(/^[A-Z]{3}$/),
          day: date,
          confirmation: z.enum(["manual", "confirmed"]),
          evidenceUrl: url.optional(),
        })
        .parse(raw.data);
      ensure(
        v.confirmation !== "confirmed" || v.evidenceUrl,
        "Confirmed spend requires evidence",
      );
      return transaction(async (db) => {
        const spendId = randomUUID();
        await db.query(
          "INSERT INTO spend_records(id,category,label,amount,currency,day,confirmation,evidence_url) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
          [
            spendId,
            v.category,
            v.label,
            v.amount,
            v.currency,
            v.day,
            v.confirmation,
            v.evidenceUrl || null,
          ],
        );
        await audit(db, actor, "spend.recorded", spendId);
        return { id: spendId };
      });
    }
    case "task.create": {
      const v = z
        .object({
          organizationId: id.optional(),
          title: text.max(500),
          dueAt: z.iso.datetime({ offset: true }),
        })
        .parse(raw.data);
      return transaction(async (db) => {
        const taskId = randomUUID();
        await db.query(
          "INSERT INTO tasks(id,organization_id,title,due_at) VALUES($1,$2,$3,$4)",
          [taskId, v.organizationId || null, v.title, v.dueAt],
        );
        await audit(db, actor, "task.created", taskId);
        return { id: taskId };
      });
    }
    case "task.complete": {
      const v = z.object({ id }).parse(raw.data);
      return transaction(async (db) => {
        const r = await db.query(
          "UPDATE tasks SET status='done' WHERE id=$1 AND status='open' RETURNING id",
          [v.id],
        );
        ensure(r.rowCount, "Open task not found");
        await audit(db, actor, "task.completed", v.id);
        return { id: v.id };
      });
    }
    case "ads.import": {
      const v = z.object({ csv: text.max(1_000_000) }).parse(raw.data);
      return importAds(parseAdsCsv(v.csv), "csv", actor);
    }
    case "discovery.search": {
      const v = z.object({ query: text.max(300) }).parse(raw.data);
      ensure(
        process.env.BRAVE_SEARCH_API_KEY,
        "Search is not connected. Use the public search links and add verified organizations manually, or configure BRAVE_SEARCH_API_KEY.",
      );
      const endpoint = new URL(
        "https://api.search.brave.com/res/v1/web/search",
      );
      endpoint.searchParams.set("q", v.query);
      endpoint.searchParams.set("count", "10");
      const response = await fetch(endpoint, {
        headers: {
          Accept: "application/json",
          "X-Subscription-Token": process.env.BRAVE_SEARCH_API_KEY,
        },
        signal: AbortSignal.timeout(12000),
      });
      ensure(response.ok, "Search provider rejected the request");
      const data = await response.json();
      const found = z
        .array(
          z.object({
            title: text.max(1000),
            url,
            description: z.string().max(10000).optional(),
          }),
        )
        .max(20)
        .parse(data.web?.results || []);
      return transaction(async (db) => {
        for (const r of found)
          await db.query(
            "INSERT INTO discovery_results(id,query,title,url,description) VALUES($1,$2,$3,$4,$5) ON CONFLICT(url) DO NOTHING",
            [randomUUID(), v.query, r.title, r.url, r.description || null],
          );
        await audit(db, actor, "discovery.searched", null, {
          query: v.query,
          results: found.length,
        });
        return { found: found.length };
      });
    }
    case "jobs.run": {
      z.object({}).parse(raw.data);
      return runJobs(`manual:${randomUUID()}`, actor);
    }
    default:
      throw new Error("Unknown operation");
  }
}
