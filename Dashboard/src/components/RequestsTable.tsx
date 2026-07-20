"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Badge } from "@/components/Badge";
import { Pagination } from "@/components/Pagination";
import { RequestDetailContent } from "@/components/RequestDetailContent";
import { SideSheet } from "@/components/SideSheet";
import { formatMs, formatTs } from "@/lib/format";
import type { PageResult } from "@/lib/queries";
import type { RequestLogView } from "@/lib/serialize";

export function RequestsTable({
  result,
  initialSelected,
}: {
  result: PageResult<RequestLogView>;
  initialSelected: RequestLogView | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get("id");
  const [selected, setSelected] = useState<RequestLogView | null>(initialSelected);
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
    void fetch(`/api/requests/${selectedId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load (${res.status})`);
        return (await res.json()) as RequestLogView;
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
                <th className="px-4 py-3 font-medium">Method</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Latency</th>
                <th className="px-4 py-3 font-medium">Message</th>
                <th className="px-4 py-3 font-medium">URL</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {result.items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                    No request logs in the database yet.
                  </td>
                </tr>
              ) : (
                result.items.map((r) => {
                  const active = selectedId === r._id;
                  return (
                    <tr
                      key={r._id}
                      onClick={() => setIdParam(r._id)}
                      className={`cursor-pointer hover:bg-slate-50 ${
                        active ? "bg-teal-50/60" : ""
                      }`}
                    >
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                        {formatTs(r.ts)}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{r.method}</td>
                      <td className="px-4 py-3">
                        <Badge tone={r.statusCode < 400 ? "success" : "danger"}>
                          {r.statusCode}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 tabular-nums text-slate-700">
                        {formatMs(r.responseTimeMs)}
                      </td>
                      <td className="max-w-xs truncate px-4 py-3 text-slate-900">
                        {r.message || "—"}
                      </td>
                      <td className="max-w-xs truncate px-4 py-3 font-mono text-xs text-slate-500">
                        {r.url}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <Pagination
          basePath="/requests"
          page={result.page}
          totalPages={result.totalPages}
          total={result.total}
          pageSize={result.pageSize}
          selectedId={selectedId}
        />
      </div>

      <SideSheet
        open={Boolean(selectedId)}
        title={selected?.message || selected?.url || "Request detail"}
        subtitle={selected ? formatTs(selected.ts) : undefined}
        onClose={() => setIdParam(null)}
      >
        {loading && !selected ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : error ? (
          <p className="text-sm text-rose-700">{error}</p>
        ) : selected ? (
          <RequestDetailContent row={selected} />
        ) : (
          <p className="text-sm text-slate-500">Loading…</p>
        )}
      </SideSheet>
    </>
  );
}
