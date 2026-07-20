import { Badge } from "@/components/Badge";
import { JsonBlock } from "@/components/JsonBlock";
import { formatTs } from "@/lib/format";
import type { FrontendLogView } from "@/lib/serialize";

function levelTone(level: string): "success" | "danger" | "warn" | "neutral" {
  if (level === "error") return "danger";
  if (level === "warn") return "warn";
  if (level === "action") return "success";
  return "neutral";
}

export function FrontendDetailContent({ row }: { row: FrontendLogView }) {
  const details = row.details as Record<string, unknown> | undefined;
  const actions = details?.types ?? details?.first;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <Meta
          label="Level"
          value={<Badge tone={levelTone(row.level)}>{row.level}</Badge>}
        />
        <Meta label="Category" value={row.category} />
        <Meta label="Event" value={row.event} mono />
        <Meta label="Time" value={formatTs(row.ts)} />
        <Meta label="Conversation" value={row.conversationId || "—"} mono />
        <Meta label="Change set" value={row.changeSetId || "—"} mono />
        <Meta label="Session" value={row.sessionId || "—"} mono />
        <Meta label="Workbook" value={row.workbookKey || "—"} mono />
      </div>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-900">Message</h3>
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 whitespace-pre-wrap">
          {row.message}
        </p>
      </section>

      {actions !== undefined && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-900">Actions summary</h3>
          <JsonBlock
            value={{
              actionCount: details?.actionCount,
              types: details?.types,
              first: details?.first,
              source: details?.source,
              changeCount: details?.changeCount,
            }}
            maxHeight="12rem"
          />
        </section>
      )}

      {details?.error !== undefined && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-rose-800">Error</h3>
          <JsonBlock value={details.error} maxHeight="14rem" />
        </section>
      )}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-900">Full details</h3>
        <JsonBlock value={row.details ?? null} maxHeight="22rem" />
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-900">Client context</h3>
        <div className="grid gap-3 sm:grid-cols-1">
          <Meta label="Page URL" value={row.pageUrl || "—"} mono />
          <Meta label="User agent" value={row.userAgent || "—"} mono />
        </div>
      </section>
    </div>
  );
}

function Meta({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
      <div className={`mt-1 text-sm text-slate-900 ${mono ? "break-all font-mono text-xs" : ""}`}>
        {value}
      </div>
    </div>
  );
}
