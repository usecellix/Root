"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/requests", label: "Requests" },
  { href: "/planner", label: "Planner" },
  { href: "/frontend", label: "Frontend" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-slate-200 bg-slate-50">
      <div className="border-b border-slate-200 px-5 py-5">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-teal-700">
          Cellix
        </p>
        <h1 className="mt-1 text-lg font-semibold text-slate-900">Agent Logs</h1>
      </div>
      <nav className="flex flex-col gap-1 p-3">
        {NAV.map((item) => {
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? "bg-teal-700 text-white"
                  : "text-slate-700 hover:bg-slate-200/80"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <p className="mt-auto px-5 py-4 text-xs text-slate-500">
        Reads <code className="font-mono">request_logs</code>,{" "}
        <code className="font-mono">planner_logs</code> &amp;{" "}
        <code className="font-mono">frontend_logs</code>
      </p>
    </aside>
  );
}
