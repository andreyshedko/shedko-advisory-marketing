import { authorizedBearer, boundedJson } from "@/lib/security";
import { importAds } from "@/lib/ads";
import { errorResponse } from "@/lib/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!authorizedBearer(request, process.env.ADS_INGEST_SECRET))
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return Response.json(
      await importAds(
        await boundedJson(request),
        "scripts",
        "google_ads_scripts",
      ),
    );
  } catch (e) {
    return errorResponse(e);
  }
}
