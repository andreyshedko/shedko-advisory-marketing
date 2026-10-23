import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
const root = process.cwd();
const local = path.join(root, ".local");
const socket = path.join(local, "pgsocket");
const data = path.join(local, "postgres");
mkdirSync(local, { recursive: true, mode: 0o700 });
mkdirSync(socket, { recursive: true, mode: 0o700 });
const bin = execFileSync("pg_config", ["--bindir"], {
  encoding: "utf8",
}).trim();
function run(command, args, options = {}) {
  return execFileSync(command, args, { stdio: "pipe", ...options });
}
if (!existsSync(path.join(data, "PG_VERSION")))
  run(path.join(bin, "initdb"), [
    "-D",
    data,
    "-A",
    "trust",
    "-U",
    "shedko_local",
    "--no-locale",
    "-E",
    "UTF8",
  ]);
try {
  run(path.join(bin, "pg_ctl"), ["-D", data, "status"]);
} catch {
  run(path.join(bin, "pg_ctl"), [
    "-D",
    data,
    "-l",
    path.join(local, "postgres.log"),
    "-o",
    `-k '${socket.replaceAll("'", "'\\''")}' -p 55441 -h ''`,
    "start",
  ]);
}
try {
  run(path.join(bin, "createdb"), [
    "-h",
    socket,
    "-p",
    "55441",
    "-U",
    "shedko_local",
    "shedko_marketing",
  ]);
} catch {
  /* Existing database is preserved. Migration verifies connectivity. */
}
const envPath = path.join(root, ".env.local");
if (!existsSync(envPath)) {
  const password = randomBytes(24).toString("base64url");
  const database = `postgresql://shedko_local@localhost/shedko_marketing?host=${encodeURIComponent(socket)}&port=55441`;
  const email = "local-admin@shedko.invalid";
  writeFileSync(
    envPath,
    `DATABASE_URL=${database}\nBETTER_AUTH_SECRET=${randomBytes(48).toString("hex")}\nBETTER_AUTH_URL=http://localhost:3000\nADMIN_EMAIL=${email}\nCRON_SECRET=${randomBytes(32).toString("hex")}\nADS_INGEST_SECRET=${randomBytes(32).toString("hex")}\nDAILY_BUDGETS={}\n`,
    { mode: 0o600 },
  );
  writeFileSync(
    path.join(local, "admin-credentials.txt"),
    `Local workspace only\nEmail: ${email}\nPassword: ${password}\nURL: http://localhost:3000\n`,
    { mode: 0o600 },
  );
  run("npm", ["run", "db:migrate"], { stdio: "inherit" });
  run("npm", ["run", "admin:create"], {
    stdio: "inherit",
    env: { ...process.env, ADMIN_PASSWORD: password },
  });
} else {
  run("npm", ["run", "db:migrate"], { stdio: "inherit" });
  const { config } = await import("dotenv");
  config({ path: envPath, quiet: true });
  const { default: pg } = await import("pg");
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    if (
      !(
        await db.query('SELECT 1 FROM "user" WHERE email=$1', [
          process.env.ADMIN_EMAIL,
        ])
      ).rowCount
    ) {
      const saved = readFileSync(
        path.join(local, "admin-credentials.txt"),
        "utf8",
      );
      const password = saved.match(/^Password: (.+)$/m)?.[1];
      if (!password) throw new Error("Local credentials are missing");
      run("npm", ["run", "admin:create"], {
        stdio: "inherit",
        env: { ...process.env, ADMIN_PASSWORD: password },
      });
    }
  } finally {
    await db.end();
  }
}
console.log(
  "Local PostgreSQL ready (Unix socket only). Login is in .local/admin-credentials.txt. No outbound integrations configured.",
);
