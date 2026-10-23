import { authorizedBearer } from "@/lib/security";
import { runJobs } from "@/lib/jobs";
import {
  githubResearchConfigured,
  syncGithubResearch,
} from "@/lib/research-github";
import { errorResponse } from "@/lib/http";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: Request) {
  if (!authorizedBearer(request, process.env.CRON_SECRET))
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const researchSync = githubResearchConfigured()
      ? await syncGithubResearch().catch(() => ({ error: true }))
      : null;
    return Response.json({
      researchSync,
      jobs: await runJobs(`daily:${new Date().toISOString().slice(0, 10)}`),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
