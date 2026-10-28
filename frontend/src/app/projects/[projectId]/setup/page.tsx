import { redirect } from "next/navigation";

export default async function SetupIndex({ params }: { params: Promise<{ projectId: string }> }): Promise<never> {
  const { projectId } = await params;
  redirect(`/projects/${encodeURIComponent(projectId)}/setup/repositories`);
}
