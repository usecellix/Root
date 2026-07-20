import Link from "next/link";
import { Badge } from "@/components/Badge";
import { StatCard } from "@/components/StatCard";
import { formatMs, formatPercent, formatTs } from "@/lib/format";
import { getOverviewStats } from "@/lib/queries";

export const dynamic = "force-dynamic";

function frontendLevelTone(level: string): "success" | "danger" | "warn" | "neutral" {
  if (level === "error") return "danger";
  if (level === "warn") return "warn";
  if (level === "action") return "success";
  return "neutral";
}

export default async function OverviewPage() {
  let stats;
  let error: string | null = null;
  try {
    stats = await getOverviewStats();
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  if (error || !stats) {
    return (
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold text-slate-900">Overview</h2>
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
          Could not connect to MongoDB. Check <code>.env.local</code> (
          <code>MONGODB_URL</code> / <code>MONGODB_DB_NAME</code>).
          <pre className="mt-2 overflow-auto font-mono text-xs">{error}</pre>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900">Overview</h2>
        <p className="mt-1 text-sm text-slate-600">
          Live view of HTTP request logs, planner agent I/O, and Excel add-in frontend events.
          Mongo logs expire after 3 days.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Request logs" value={String(stats.requestCount)} />
        <StatCard label="Planner logs" value={String(stats.plannerCount)} />
        <StatCard label="Frontend events" value={String(stats.frontendCount)} />
        <StatCard label="Frontend errors" value={String(stats.frontendErrorCount)} />
        <StatCard
          label="Planner success"
          value={formatPercent(stats.plannerSuccessRate)}
        />
      </div>

      <section className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h3 className="text-sm font-semibold text-slate-900">Recent requests</h3>
            <Link href="/requests" className="text-xs font-medium text-teal-700 hover:underline">
              View all
            </Link>
          </div>
          <ul className="divide-y divide-slate-100">
            {stats.recentRequests.length === 0 ? (
              <li className="px-4 py-6 text-sm text-slate-500">No request logs yet.</li>
            ) : (
              stats.recentRequests.map((r) => (
                <li key={String(r._id)}>
                  <Link
                    href={`/requests?id=${r._id}`}
                    className="block px-4 py-3 hover:bg-slate-50"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-slate-900">
                        {r.message || r.url}
                      </span>
                      <Badge tone={r.statusCode < 400 ? "success" : "danger"}>
                        {r.statusCode}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {formatTs(r.ts)} · {formatMs(r.responseTimeMs)}
                    </p>
                  </Link>
                </li>
              ))
            )}
          </ul>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h3 className="text-sm font-semibold text-slate-900">Recent planner runs</h3>
            <Link href="/planner" className="text-xs font-medium text-teal-700 hover:underline">
              View all
            </Link>
          </div>
          <ul className="divide-y divide-slate-100">
            {stats.recentPlanner.length === 0 ? (
              <li className="px-4 py-6 text-sm text-slate-500">No planner logs yet.</li>
            ) : (
              stats.recentPlanner.map((p) => (
                <li key={String(p._id)}>
                  <Link
                    href={`/planner?id=${p._id}`}
                    className="block px-4 py-3 hover:bg-slate-50"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-slate-900">
                        {p.input?.prompt || p.correlationId}
                      </span>
                      <Badge tone={p.success ? "success" : "danger"}>
                        {p.success ? "ok" : "fail"}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {formatTs(p.ts)} · {formatMs(p.durationMs)} ·{" "}
                      {p.output?.parsed?.confidence ?? "—"}
                    </p>
                  </Link>
                </li>
              ))
            )}
          </ul>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h3 className="text-sm font-semibold text-slate-900">Recent frontend events</h3>
            <Link href="/frontend" className="text-xs font-medium text-teal-700 hover:underline">
              View all
            </Link>
          </div>
          <ul className="divide-y divide-slate-100">
            {stats.recentFrontend.length === 0 ? (
              <li className="px-4 py-6 text-sm text-slate-500">No frontend logs yet.</li>
            ) : (
              stats.recentFrontend.map((f) => (
                <li key={String(f._id)}>
                  <Link
                    href={`/frontend?id=${f._id}`}
                    className="block px-4 py-3 hover:bg-slate-50"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-slate-900">
                        {f.event}
                      </span>
                      <Badge tone={frontendLevelTone(f.level)}>{f.level}</Badge>
                    </div>
                    <p className="mt-1 truncate text-xs text-slate-500">
                      {formatTs(f.ts)} · {f.category} · {f.message}
                    </p>
                  </Link>
                </li>
              ))
            )}
          </ul>
        </div>
      </section>
    </div>
  );
}
