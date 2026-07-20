import { Badge } from "@/components/Badge";
import { JsonBlock } from "@/components/JsonBlock";
import { formatMs, formatTs } from "@/lib/format";
import type { RequestLogView } from "@/lib/serialize";

export function RequestDetailContent({ row }: { row: RequestLogView }) {
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <Meta label="Method" value={row.method} />
        <Meta
          label="Status"
          value={
            <Badge tone={row.statusCode < 400 ? "success" : "danger"}>{row.statusCode}</Badge>
          }
        />
        <Meta label="Latency" value={formatMs(row.responseTimeMs)} />
        <Meta label="Time" value={formatTs(row.ts)} />
        <Meta label="URL" value={row.url} mono />
        <Meta label="Trace" value={row.traceId || row.reqId || "—"} mono />
      </div>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-900">Response payload</h3>
        <JsonBlock value={row.response ?? null} maxHeight="28rem" />
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
