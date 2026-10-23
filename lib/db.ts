import pg, { type PoolClient } from "pg";
const shared = globalThis as unknown as { marketingPool?: pg.Pool };
export function pool() {
  if (!process.env.DATABASE_URL)
    throw new Error("DATABASE_URL is not configured");
  return (shared.marketingPool ??= new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    options: "-c timezone=UTC",
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  }));
}
export type DB = Pick<PoolClient, "query">;
export async function transaction<T>(
  fn: (db: PoolClient) => Promise<T>,
): Promise<T> {
  const db = await pool().connect();
  try {
    await db.query("BEGIN");
    const result = await fn(db);
    await db.query("COMMIT");
    return result;
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
}
