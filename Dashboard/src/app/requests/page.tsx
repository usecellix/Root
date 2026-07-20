import { Suspense } from "react";
import { RequestsTable } from "@/components/RequestsTable";
import { getRequestLogView, listRequestLogsPage } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function RequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; id?: string }>;
}) {
  const sp = await searchParams;
  const page = Number(sp.page) || 1;
  const [result, initialSelected] = await Promise.all([
    listRequestLogsPage(page),
    sp.id ? getRequestLogView(sp.id) : Promise.resolve(null),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900">Request logs</h2>
        <p className="mt-1 text-sm text-slate-600">
          HTTP conversation traffic. Click a row for details. Logs auto-delete after 3 days.
        </p>
      </div>

      <Suspense fallback={<p className="text-sm text-slate-500">Loading table…</p>}>
        <RequestsTable result={result} initialSelected={initialSelected} />
      </Suspense>
    </div>
  );
}
