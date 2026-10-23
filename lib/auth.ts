import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { pool } from "./db";
function createAuth() {
  if (!process.env.BETTER_AUTH_SECRET || !process.env.ADMIN_EMAIL)
    throw new Error("Administrator authentication is not configured");
  return betterAuth({
    appName: "Shedko Marketing Automation",
    database: pool(),
    baseURL: process.env.BETTER_AUTH_URL,
    secret: process.env.BETTER_AUTH_SECRET,
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 14,
    },
    session: { expiresIn: 60 * 60 * 12, updateAge: 60 * 60 },
    rateLimit: { enabled: true, storage: "database", window: 60, max: 20 },
    plugins: [nextCookies()],
  });
}
let authInstance: ReturnType<typeof createAuth> | undefined;
export function getAuth() {
  return (authInstance ??= createAuth());
}
export async function requireAdmin(headers: Headers) {
  const session = await getAuth().api.getSession({ headers });
  if (
    !session ||
    session.user.email.toLowerCase() !== process.env.ADMIN_EMAIL?.toLowerCase()
  )
    throw new Error("UNAUTHORIZED");
  return session;
}
