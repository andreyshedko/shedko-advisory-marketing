import { z } from "zod";
import { getDomain } from "tldts";
export const id = z.uuid();
export const text = z.string().trim().min(1).max(5000);
export const url = z
  .url()
  .max(2000)
  .refine((value) => {
    const u = new URL(value);
    return (
      ["https:", "http:"].includes(u.protocol) && !u.username && !u.password
    );
  }, "Use a public HTTP(S) URL");
export const date = z.iso.date();
export const orgInput = z.object({
  name: text.max(200),
  website: url,
  country: text.max(100),
  kind: z.enum([
    "advisor",
    "acquirer",
    "search_fund",
    "private_equity",
    "corporate_ma",
    "directory",
    "partner",
  ]),
  relevance: text,
  sourceUrl: url,
  sourceNote: text,
  verified: z.boolean().default(false),
  contactChannel: z.string().max(500).optional(),
});
export const contactInput = z.object({
  organizationId: id,
  name: z.string().trim().max(200).optional(),
  role: z.string().trim().max(200).optional(),
  email: z
    .email()
    .max(254)
    .transform((v) => v.toLowerCase()),
  evidenceUrl: url,
  verified: z.literal(true),
});
export function normalizeDomain(value: string) {
  const u = new URL(url.parse(value));
  const domain = getDomain(u.hostname, { allowPrivateDomains: true });
  if (!domain) throw new Error("Use a public organization domain");
  return domain.toLowerCase();
}
export function normalizeName(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}
export class BusinessError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function ensure(value: unknown, message: string): asserts value {
  if (!value) throw new BusinessError(message);
}
