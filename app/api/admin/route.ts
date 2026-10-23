import { requireAdmin } from "@/lib/auth";
import { dashboard } from "@/lib/dashboard";
import { operate } from "@/lib/operations";
import { boundedJson, requireSameOrigin } from "@/lib/security";
import { errorResponse } from "@/lib/http";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    await requireAdmin(request.headers);
    const q = new URL(request.url).searchParams;
    return Response.json(
      await dashboard({
        from: q.get("from"),
        to: q.get("to"),
        kind: q.get("kind") || "all",
      }),
    );
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const session = await requireAdmin(request.headers);
    return Response.json(
      await operate(await boundedJson(request), session.user.email),
    );
  } catch (e) {
    return errorResponse(e);
  }
}
