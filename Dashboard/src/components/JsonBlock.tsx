export function JsonBlock({ value, maxHeight = "24rem" }: { value: unknown; maxHeight?: string }) {
  const text =
    typeof value === "string"
      ? value
      : JSON.stringify(value, null, 2) ?? String(value);

  return (
    <pre
      className="overflow-auto rounded-lg border border-slate-200 bg-slate-950 p-4 font-mono text-xs leading-relaxed text-slate-100"
      style={{ maxHeight }}
    >
      {text}
    </pre>
  );
}
