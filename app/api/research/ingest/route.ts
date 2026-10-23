import { authorizedBearer, boundedJson } from "@/lib/security";
import { importResearch } from "@/lib/research";
import { errorResponse } from "@/lib/http";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  if (!authorizedBearer(request, process.env.RESEARCH_INGEST_SECRET))
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return Response.json(
      await importResearch(
        await boundedJson(request),
        "http",
        "research_ingest",
      ),
    );
  } catch (e) {
    return errorResponse(e);
  }
}
