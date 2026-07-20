import { redirect } from "next/navigation";

export default async function FrontendLogRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/frontend?id=${encodeURIComponent(id)}`);
}
