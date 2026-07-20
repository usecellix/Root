import { Suspense } from "react";
import { PlannerTable } from "@/components/PlannerTable";
import { getPlannerLogView, listPlannerLogsPage } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function PlannerPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; id?: string }>;
}) {
  const sp = await searchParams;
  const page = Number(sp.page) || 1;
  const [result, initialSelected] = await Promise.all([
    listPlannerLogsPage(page),
    sp.id ? getPlannerLogView(sp.id) : Promise.resolve(null),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900">Planner logs</h2>
        <p className="mt-1 text-sm text-slate-600">
          Structured planner I/O. Click a row for details. Logs auto-delete after 3 days.
        </p>
      </div>

      <Suspense fallback={<p className="text-sm text-slate-500">Loading table…</p>}>
        <PlannerTable result={result} initialSelected={initialSelected} />
      </Suspense>
    </div>
  );
}
