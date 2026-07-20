"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Badge } from "@/components/Badge";
import { Pagination } from "@/components/Pagination";
import { PlannerDetailContent } from "@/components/PlannerDetailContent";
import { SideSheet } from "@/components/SideSheet";
import { formatMs, formatTs } from "@/lib/format";
import type { PageResult } from "@/lib/queries";
import type { PlannerLogView } from "@/lib/serialize";

export function PlannerTable({
  result,
  initialSelected,
}: {
  result: PageResult<PlannerLogView>;
  initialSelected: PlannerLogView | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get("id");
  const [selected, setSelected] = useState<PlannerLogView | null>(initialSelected);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const setIdParam = useCallback(
    (id: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (id) params.set("id", id);
      else params.delete("id");
      const qs = params.toString();
      startTransition(() => {
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      });
    },
    [pathname, router, searchParams],
  );

  useEffect(() => {
    setSelected(initialSelected);
  }, [initialSelected]);

  useEffect(() => {
    if (!selectedId) {
      setSelected(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const cached = result.items.find((r) => r._id === selectedId) ?? null;
    if (cached) setSelected(cached);

    setLoading(true);
    setError(null);
    void fetch(`/api/planner/${selectedId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load (${res.status})`);
        return (await res.json()) as PlannerLogView;
      })
      .then((data) => {
        if (!cancelled) setSelected(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedId, result.items]);

  return (
    <>
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Time</th>
                <th className="px-4 py-3 font-medium">Prompt</th>
                <th className="px-4 py-3 font-medium">Model</th>
                <th className="px-4 py-3 font-medium">Latency</th>
                <th className="px-4 py-3 font-medium">Success</th>
                <th className="px-4 py-3 font-medium">Confidence</th>
                <th className="px-4 py-3 font-medium">Subtasks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {result.items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    No planner logs yet.
                  </td>
                </tr>
              ) : (
                result.items.map((p) => {
                  const subtasks = p.output?.parsed?.subtasks?.length ?? 0;
                  const confidence = p.output?.parsed?.confidence ?? "—";
                  const active = selectedId === p._id;
                  return (
                    <tr
                      key={p._id}
                      onClick={() => setIdParam(p._id)}
                      className={`cursor-pointer hover:bg-slate-50 ${
                        active ? "bg-teal-50/60" : ""
                      }`}
                    >
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                        {formatTs(p.ts)}
                      </td>
                      <td className="max-w-sm truncate px-4 py-3 font-medium text-slate-900">
                        {p.input?.prompt || "—"}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600">{p.model}</td>
                      <td className="px-4 py-3 tabular-nums">{formatMs(p.durationMs)}</td>
                      <td className="px-4 py-3">
                        <Badge tone={p.success ? "success" : "danger"}>
                          {p.success ? "ok" : "fail"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          tone={
                            confidence === "high"
                              ? "success"
                              : confidence === "low"
                                ? "warn"
                                : "neutral"
                          }
                        >
                          {confidence}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 tabular-nums">{subtasks}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <Pagination
          basePath="/planner"
          page={result.page}
          totalPages={result.totalPages}
          total={result.total}
          pageSize={result.pageSize}
          selectedId={selectedId}
        />
      </div>

      <SideSheet
        open={Boolean(selectedId)}
        title={selected?.input?.prompt || selected?.correlationId || "Planner detail"}
        subtitle={selected ? `${formatTs(selected.ts)} · ${selected.model}` : undefined}
        onClose={() => setIdParam(null)}
      >
        {loading && !selected ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : error ? (
          <p className="text-sm text-rose-700">{error}</p>
        ) : selected ? (
          <PlannerDetailContent row={selected} />
        ) : (
          <p className="text-sm text-slate-500">Loading…</p>
        )}
      </SideSheet>
    </>
  );
}
