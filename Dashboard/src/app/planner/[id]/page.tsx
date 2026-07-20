import { redirect } from "next/navigation";

export default async function PlannerDetailRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/planner?id=${encodeURIComponent(id)}`);
}
