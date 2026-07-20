import { Badge } from "@/components/Badge";
import { JsonBlock } from "@/components/JsonBlock";
import { formatMs, formatTs } from "@/lib/format";
import type { PlannerLogView } from "@/lib/serialize";

export function PlannerDetailContent({ row }: { row: PlannerLogView }) {
  const parsed = row.output?.parsed;
  const subtasks = parsed?.subtasks ?? [];
  const clarifications = parsed?.clarificationsNeeded ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        <Badge tone={row.success ? "success" : "danger"}>
          {row.success ? "success" : "failed"}
        </Badge>
        {parsed?.confidence ? (
          <Badge
            tone={
              parsed.confidence === "high"
                ? "success"
                : parsed.confidence === "low"
                  ? "warn"
                  : "neutral"
            }
          >
            confidence: {parsed.confidence}
          </Badge>
        ) : null}
        {row.output?.fallback ? <Badge tone="warn">fallback</Badge> : null}
        {row.output?.retried ? <Badge tone="warn">retried</Badge> : null}
        {row.input?.activeSheet ? (
          <Badge tone="neutral">sheet: {String(row.input.activeSheet)}</Badge>
        ) : null}
      </div>

      <p className="text-sm text-slate-600">
        {formatTs(row.ts)} · {row.model} · {formatMs(row.durationMs)}
      </p>

      {row.error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
          {row.error}
        </div>
      ) : null}

      {parsed?.reasoning ? (
        <section>
          <h3 className="text-sm font-semibold text-slate-900">Reasoning</h3>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
            {parsed.reasoning}
          </p>
        </section>
      ) : null}

      <section>
        <h3 className="text-sm font-semibold text-slate-900">
          Subtasks ({subtasks.length})
        </h3>
        {subtasks.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No subtasks in parsed output.</p>
        ) : (
          <ol className="mt-3 space-y-2">
            {subtasks.map((s, i) => (
              <li
                key={s.id || i}
                className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2.5"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-teal-800">{s.id || `s${i + 1}`}</span>
                  {s.targetSheet ? <Badge tone="neutral">{s.targetSheet}</Badge> : null}
                </div>
                <p className="mt-1.5 text-sm text-slate-800">{s.description}</p>
                {s.dependsOn && s.dependsOn.length > 0 ? (
                  <p className="mt-1 font-mono text-xs text-slate-500">
                    dependsOn: {s.dependsOn.join(", ")}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </section>

      {clarifications.length > 0 ? (
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <h3 className="text-sm font-semibold text-amber-950">Clarifications needed</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-950">
            {clarifications.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <details className="rounded-lg border border-slate-200">
        <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-slate-900">
          Raw input
        </summary>
        <div className="border-t border-slate-200 p-3">
          <JsonBlock value={row.input} maxHeight="16rem" />
        </div>
      </details>

      <details className="rounded-lg border border-slate-200">
        <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-slate-900">
          Raw output
        </summary>
        <div className="border-t border-slate-200 p-3">
          <JsonBlock value={row.output} maxHeight="16rem" />
        </div>
      </details>
    </div>
  );
}
