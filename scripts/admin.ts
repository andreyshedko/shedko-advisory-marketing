import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
import { betterAuth } from "better-auth";
import { pool } from "../lib/db";
try {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password || password.length < 14)
    throw new Error(
      "Set ADMIN_EMAIL and ADMIN_PASSWORD (14+ characters) for this one-time command",
    );
  const auth = betterAuth({
    database: pool(),
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL,
    emailAndPassword: { enabled: true, minPasswordLength: 14 },
  });
  await auth.api.signUpEmail({
    body: { email, password, name: "Shedko Administrator" },
  });
  console.log(
    "Administrator created. Remove ADMIN_PASSWORD from the environment. Public signup is disabled.",
  );
} finally {
  await pool().end();
}
