import Link from "next/link";

export function Pagination({
  basePath,
  page,
  totalPages,
  total,
  pageSize,
  selectedId,
  extraParams,
}: {
  basePath: string;
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  selectedId?: string | null;
  extraParams?: Record<string, string | undefined>;
}) {
  if (total === 0) return null;

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  function hrefFor(p: number) {
    const params = new URLSearchParams();
    if (p > 1) params.set("page", String(p));
    if (selectedId) params.set("id", selectedId);
    if (extraParams) {
      for (const [key, value] of Object.entries(extraParams)) {
        if (value) params.set(key, value);
      }
    }
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  }

  const pages = visiblePages(page, totalPages);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3">
      <p className="text-xs text-slate-600">
        Showing <span className="font-medium text-slate-800">{from}–{to}</span> of{" "}
        <span className="font-medium text-slate-800">{total}</span>
      </p>
      <div className="flex items-center gap-1">
        <PageLink href={hrefFor(page - 1)} disabled={page <= 1}>
          Prev
        </PageLink>
        {pages.map((p, i) =>
          p === "…" ? (
            <span key={`e-${i}`} className="px-2 text-xs text-slate-400">
              …
            </span>
          ) : (
            <PageLink key={p} href={hrefFor(p as number)} active={p === page}>
              {p}
            </PageLink>
          ),
        )}
        <PageLink href={hrefFor(page + 1)} disabled={page >= totalPages}>
          Next
        </PageLink>
      </div>
    </div>
  );
}

function PageLink({
  href,
  children,
  disabled,
  active,
}: {
  href: string;
  children: React.ReactNode;
  disabled?: boolean;
  active?: boolean;
}) {
  if (disabled) {
    return (
      <span className="rounded-md px-2.5 py-1.5 text-xs text-slate-300">{children}</span>
    );
  }
  return (
    <Link
      href={href}
      className={`rounded-md px-2.5 py-1.5 text-xs font-medium ${
        active
          ? "bg-teal-700 text-white"
          : "text-slate-700 hover:bg-slate-200"
      }`}
      scroll={false}
    >
      {children}
    </Link>
  );
}

function visiblePages(current: number, total: number): Array<number | "…"> {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const set = new Set<number>([1, total, current, current - 1, current + 1]);
  const sorted = [...set].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const out: Array<number | "…"> = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) out.push("…");
    out.push(sorted[i]);
  }
  return out;
}
