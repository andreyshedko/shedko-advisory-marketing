import { notFound } from "next/navigation";
import WorkspacePage from "../workspace-page";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  if (
    ![
      "organizations",
      "partners",
      "outreach",
      "ads",
      "spend",
      "tasks",
      "reports",
      "integrations",
      "activity",
    ].includes(section)
  )
    notFound();
  return <WorkspacePage section={section} />;
}
