"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Badge } from "@/components/Badge";
import { FrontendDetailContent } from "@/components/FrontendDetailContent";
import { Pagination } from "@/components/Pagination";
import { SideSheet } from "@/components/SideSheet";
import { formatTs } from "@/lib/format";
import type { PageResult } from "@/lib/queries";
import type { FrontendLogView } from "@/lib/serialize";

function levelTone(level: string): "success" | "danger" | "warn" | "neutral" {
  if (level === "error") return "danger";
  if (level === "warn") return "warn";
  if (level === "action") return "success";
  return "neutral";
}

export function FrontendTable({
  result,
  initialSelected,
  filter,
}: {
  result: PageResult<FrontendLogView>;
  initialSelected: FrontendLogView | null;
  filter?: { level?: string; category?: string };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get("id");
  const [selected, setSelected] = useState<FrontendLogView | null>(initialSelected);
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
    void fetch(`/api/frontend/${selectedId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load (${res.status})`);
        return (await res.json()) as FrontendLogView;
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
                <th className="px-4 py-3 font-medium">Level</th>
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium">Event</th>
                <th className="px-4 py-3 font-medium">Message</th>
                <th className="px-4 py-3 font-medium">Conversation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {result.items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                    No frontend logs yet. Use the Excel add-in (preview / Accept / console
                    errors) to generate events.
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
                      <td className="px-4 py-3">
                        <Badge tone={levelTone(r.level)}>{r.level}</Badge>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-700">
                        {r.category}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-700">{r.event}</td>
                      <td className="max-w-md truncate px-4 py-3 text-slate-900">{r.message}</td>
                      <td className="max-w-[10rem] truncate px-4 py-3 font-mono text-xs text-slate-500">
                        {r.conversationId || "—"}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <Pagination
          basePath="/frontend"
          page={result.page}
          totalPages={result.totalPages}
          total={result.total}
          pageSize={result.pageSize}
          selectedId={selectedId}
          extraParams={{ level: filter?.level, category: filter?.category }}
        />
      </div>

      <SideSheet
        open={Boolean(selectedId)}
        title={selected?.event || "Frontend event"}
        subtitle={selected ? formatTs(selected.ts) : undefined}
        onClose={() => setIdParam(null)}
      >
        {loading && !selected ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : error ? (
          <p className="text-sm text-rose-700">{error}</p>
        ) : selected ? (
          <FrontendDetailContent row={selected} />
        ) : (
          <p className="text-sm text-slate-500">Loading…</p>
        )}
      </SideSheet>
    </>
  );
}
