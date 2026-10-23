import { ZodError } from "zod";
import { BusinessError } from "./validation";
export function errorResponse(error: unknown) {
  if (error instanceof ZodError)
    return Response.json(
      {
        error: error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      },
      { status: 400 },
    );
  if (error instanceof BusinessError)
    return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof Error && error.message === "UNAUTHORIZED")
    return Response.json(
      { error: "Sign in as administrator" },
      { status: 401 },
    );
  const code = (error as { code?: string })?.code;
  if (code === "23505")
    return Response.json(
      {
        error:
          "Duplicate organization, domain, contact or message. Open the existing record.",
      },
      { status: 409 },
    );
  if (code === "23503" || code === "22007" || code === "22008")
    return Response.json(
      { error: "Invalid record reference or calendar date" },
      { status: 400 },
    );
  // Never return driver, transport or provider diagnostics containing credentials.
  console.error("Marketing operation failed", {
    type: error instanceof Error ? error.name : "unknown",
    code: code || "unknown",
  });
  return Response.json(
    {
      error:
        "Operation failed. Check configuration and the audit log; no automatic external retry will occur.",
    },
    { status: 500 },
  );
}
