import { NextResponse } from "next/server";
import { getPlannerLogView } from "@/lib/queries";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const row = await getPlannerLogView(id);
  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(row);
}
