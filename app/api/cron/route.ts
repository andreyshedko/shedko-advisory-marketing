import { authorizedBearer } from "@/lib/security";
import { runJobs } from "@/lib/jobs";
import { errorResponse } from "@/lib/http";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: Request) {
  if (!authorizedBearer(request, process.env.CRON_SECRET))
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return Response.json(
      await runJobs(`daily:${new Date().toISOString().slice(0, 10)}`),
    );
  } catch (e) {
    return errorResponse(e);
  }
}
