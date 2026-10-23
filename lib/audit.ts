import { randomUUID } from "node:crypto";
import type { DB } from "./db";
export async function audit(
  db: DB,
  actor: string,
  action: string,
  entityId: string | null = null,
  detail: Record<string, unknown> = {},
) {
  await db.query(
    "INSERT INTO activity_log(id,actor,action,entity_id,detail) VALUES($1,$2,$3,$4,$5)",
    [randomUUID(), actor, action, entityId, JSON.stringify(detail)],
  );
}
