import { timingSafeEqual } from "node:crypto";
import { BusinessError } from "./validation";
export function authorizedBearer(request: Request, secret: string | undefined) {
  if (!secret || secret.length < 24) return false;
  const a = Buffer.from(request.headers.get("authorization") || "");
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function requireSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const expected = process.env.BETTER_AUTH_URL
    ? new URL(process.env.BETTER_AUTH_URL).origin
    : new URL(request.url).origin;
  if (!origin || origin !== expected)
    throw new BusinessError("Invalid request origin", 403);
}
export async function boundedJson(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new BusinessError("Request body required");
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 1_100_000) {
      await reader.cancel();
      throw new BusinessError("Request exceeds 1.1 MB", 413);
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new BusinessError("Invalid JSON");
  }
}
