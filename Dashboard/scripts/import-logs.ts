/**
 * One-shot import of NDJSON file logs into MongoDB.
 *
 * Usage (from Dashboard/):
 *   npx tsx scripts/import-logs.ts
 *
 * Reads ../cellix_backend/logs/requests.log, planner.log, and frontend.log by default.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URL ?? "mongodb://127.0.0.1:27017/Cellix";
const dbName = process.env.MONGODB_DB_NAME ?? "cellix";

const backendLogs = path.resolve(__dirname, "../../cellix_backend/logs");
const requestsPath =
  process.env.REQUESTS_LOG_PATH ?? path.join(backendLogs, "requests.log");
const plannerPath =
  process.env.PLANNER_LOG_PATH ?? path.join(backendLogs, "planner.log");
const frontendPath =
  process.env.FRONTEND_LOG_PATH ?? path.join(backendLogs, "frontend.log");

function parseNdjson(filePath: string): Record<string, unknown>[] {
  if (!existsSync(filePath)) {
    console.warn(`Skip (missing): ${filePath}`);
    return [];
  }
  const raw = readFileSync(filePath, "utf8");
  const rows: Record<string, unknown>[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed) as Record<string, unknown>);
    } catch {
      console.warn(`Bad JSON line in ${filePath}: ${trimmed.slice(0, 80)}…`);
    }
  }
  return rows;
}

function toDate(ts: unknown): Date {
  if (typeof ts === "string" || typeof ts === "number") {
    const d = new Date(ts);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  const requestRows = parseNdjson(requestsPath).map((r) => ({
    ts: toDate(r.ts),
    method: String(r.method ?? "UNKNOWN"),
    url: String(r.url ?? ""),
    statusCode: Number(r.statusCode ?? 0),
    responseTimeMs: Number(r.responseTimeMs ?? 0),
    ...(r.reqId ? { reqId: String(r.reqId) } : {}),
    ...(r.traceId ? { traceId: String(r.traceId) } : {}),
    ...(r.message ? { message: String(r.message) } : {}),
    ...(r.response !== undefined ? { response: r.response } : {}),
    importedFrom: "requests.log",
  }));

  const plannerRows = parseNdjson(plannerPath).map((r) => ({
    ts: toDate(r.ts),
    correlationId: String(r.correlationId ?? `import_${Date.now()}`),
    model: String(r.model ?? "unknown"),
    durationMs: Number(r.durationMs ?? 0),
    success: Boolean(r.success),
    ...(r.error ? { error: String(r.error) } : {}),
    input: (r.input as Record<string, unknown>) ?? {},
    output: (r.output as Record<string, unknown>) ?? {},
    importedFrom: "planner.log",
  }));

  const frontendRows = parseNdjson(frontendPath).map((r) => ({
    ts: toDate(r.ts),
    level: String(r.level ?? "info"),
    category: String(r.category ?? "other"),
    event: String(r.event ?? "unknown"),
    message: String(r.message ?? ""),
    ...(r.conversationId ? { conversationId: String(r.conversationId) } : {}),
    ...(r.changeSetId ? { changeSetId: String(r.changeSetId) } : {}),
    ...(r.sessionId ? { sessionId: String(r.sessionId) } : {}),
    ...(r.workbookKey ? { workbookKey: String(r.workbookKey) } : {}),
    ...(r.userAgent ? { userAgent: String(r.userAgent) } : {}),
    ...(r.pageUrl ? { pageUrl: String(r.pageUrl) } : {}),
    ...(r.details !== undefined ? { details: r.details } : {}),
    importedFrom: "frontend.log",
  }));

  let requestInserted = 0;
  let plannerInserted = 0;
  let frontendInserted = 0;

  if (requestRows.length > 0) {
    const result = await db.collection("request_logs").insertMany(requestRows, {
      ordered: false,
    });
    requestInserted = result.insertedCount;
  }

  if (plannerRows.length > 0) {
    const result = await db.collection("planner_logs").insertMany(plannerRows, {
      ordered: false,
    });
    plannerInserted = result.insertedCount;
  }

  if (frontendRows.length > 0) {
    const result = await db.collection("frontend_logs").insertMany(frontendRows, {
      ordered: false,
    });
    frontendInserted = result.insertedCount;
  }

  console.log(
    `Imported ${requestInserted} request_logs from ${requestsPath}\n` +
      `Imported ${plannerInserted} planner_logs from ${plannerPath}\n` +
      `Imported ${frontendInserted} frontend_logs from ${frontendPath}\n` +
      `DB: ${dbName} @ ${uri}`,
  );

  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
