import { Suspense } from "react";
import Link from "next/link";
import { FrontendTable } from "@/components/FrontendTable";
import { getFrontendLogView, listFrontendLogsPage } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function FrontendLogsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; id?: string; level?: string; category?: string }>;
}) {
  const sp = await searchParams;
  const page = Number(sp.page) || 1;
  const filter = {
    ...(sp.level ? { level: sp.level } : {}),
    ...(sp.category ? { category: sp.category } : {}),
  };
  const [result, initialSelected] = await Promise.all([
    listFrontendLogsPage(page, undefined, filter),
    sp.id ? getFrontendLogView(sp.id) : Promise.resolve(null),
  ]);

  const filters = [
    { label: "All", href: "/frontend" },
    { label: "Errors", href: "/frontend?level=error" },
    { label: "Accept", href: "/frontend?category=accept" },
    { label: "Preview", href: "/frontend?category=preview" },
    { label: "Reject", href: "/frontend?category=reject" },
    { label: "Console", href: "/frontend?category=console" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900">Frontend logs</h2>
        <p className="mt-1 text-sm text-slate-600">
          Excel add-in console errors, preview apply, Accept/Reject clicks, and action outcomes.
          Click a row for full details. Logs auto-delete after 3 days.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {filters.map((f) => {
          const active =
            (!sp.level && !sp.category && f.href === "/frontend") ||
            (sp.level && f.href.includes(`level=${sp.level}`)) ||
            (sp.category && f.href.includes(`category=${sp.category}`));
          return (
            <Link
              key={f.href}
              href={f.href}
              className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                active
                  ? "bg-teal-700 text-white"
                  : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
              }`}
            >
              {f.label}
            </Link>
          );
        })}
      </div>

      <Suspense fallback={<p className="text-sm text-slate-500">Loading table…</p>}>
        <FrontendTable result={result} initialSelected={initialSelected} filter={filter} />
      </Suspense>
    </div>
  );
}
