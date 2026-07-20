import { ObjectId } from "mongodb";
import { getDb } from "./mongodb";
import {
  serializeFrontendLog,
  serializePlannerLog,
  serializeRequestLog,
  type FrontendLogView,
  type PlannerLogView,
  type RequestLogView,
} from "./serialize";
import type {
  FrontendLogDoc,
  OverviewStats,
  PlannerLogDoc,
  RequestLogDoc,
} from "./types";

const REQUESTS = "request_logs";
const PLANNER = "planner_logs";
const FRONTEND = "frontend_logs";

export const DEFAULT_PAGE_SIZE = 25;

export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

function normalizePage(page: number, pageSize: number): { page: number; skip: number } {
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const skip = (safePage - 1) * pageSize;
  return { page: safePage, skip };
}

export async function getOverviewStats(): Promise<OverviewStats> {
  const db = await getDb();
  const requestCol = db.collection<RequestLogDoc>(REQUESTS);
  const plannerCol = db.collection<PlannerLogDoc>(PLANNER);
  const frontendCol = db.collection<FrontendLogDoc>(FRONTEND);

  const [
    requestCount,
    plannerCount,
    frontendCount,
    frontendErrorCount,
    successCount,
    latencyAgg,
    recentRequests,
    recentPlanner,
    recentFrontend,
  ] = await Promise.all([
    requestCol.countDocuments(),
    plannerCol.countDocuments(),
    frontendCol.countDocuments(),
    frontendCol.countDocuments({ level: "error" }),
    plannerCol.countDocuments({ success: true }),
    plannerCol
      .aggregate<{ avg: number }>([{ $group: { _id: null, avg: { $avg: "$durationMs" } } }])
      .toArray(),
    requestCol.find().sort({ ts: -1 }).limit(8).toArray(),
    plannerCol.find().sort({ ts: -1 }).limit(8).toArray(),
    frontendCol.find().sort({ ts: -1 }).limit(8).toArray(),
  ]);

  return {
    requestCount,
    plannerCount,
    frontendCount,
    frontendErrorCount,
    plannerSuccessRate: plannerCount > 0 ? successCount / plannerCount : 0,
    avgPlannerLatencyMs: latencyAgg[0]?.avg ?? 0,
    recentRequests,
    recentPlanner,
    recentFrontend,
  };
}

export async function listRequestLogsPage(
  page = 1,
  pageSize = DEFAULT_PAGE_SIZE,
): Promise<PageResult<RequestLogView>> {
  const db = await getDb();
  const col = db.collection<RequestLogDoc>(REQUESTS);
  const { page: safePage, skip } = normalizePage(page, pageSize);
  const [total, docs] = await Promise.all([
    col.countDocuments(),
    col.find().sort({ ts: -1 }).skip(skip).limit(pageSize).toArray(),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return {
    items: docs.map(serializeRequestLog),
    total,
    page: safePage,
    pageSize,
    totalPages,
  };
}

export async function getRequestLog(id: string): Promise<RequestLogDoc | null> {
  if (!ObjectId.isValid(id)) return null;
  const db = await getDb();
  return db.collection<RequestLogDoc>(REQUESTS).findOne({ _id: new ObjectId(id) });
}

export async function getRequestLogView(id: string): Promise<RequestLogView | null> {
  const doc = await getRequestLog(id);
  return doc ? serializeRequestLog(doc) : null;
}

export async function listPlannerLogsPage(
  page = 1,
  pageSize = DEFAULT_PAGE_SIZE,
): Promise<PageResult<PlannerLogView>> {
  const db = await getDb();
  const col = db.collection<PlannerLogDoc>(PLANNER);
  const { page: safePage, skip } = normalizePage(page, pageSize);
  const [total, docs] = await Promise.all([
    col.countDocuments(),
    col.find().sort({ ts: -1 }).skip(skip).limit(pageSize).toArray(),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return {
    items: docs.map(serializePlannerLog),
    total,
    page: safePage,
    pageSize,
    totalPages,
  };
}

export async function getPlannerLog(id: string): Promise<PlannerLogDoc | null> {
  if (!ObjectId.isValid(id)) return null;
  const db = await getDb();
  return db.collection<PlannerLogDoc>(PLANNER).findOne({ _id: new ObjectId(id) });
}

export async function getPlannerLogView(id: string): Promise<PlannerLogView | null> {
  const doc = await getPlannerLog(id);
  return doc ? serializePlannerLog(doc) : null;
}

export async function listFrontendLogsPage(
  page = 1,
  pageSize = DEFAULT_PAGE_SIZE,
  filter?: { level?: string; category?: string },
): Promise<PageResult<FrontendLogView>> {
  const db = await getDb();
  const col = db.collection<FrontendLogDoc>(FRONTEND);
  const { page: safePage, skip } = normalizePage(page, pageSize);
  const query: Record<string, string> = {};
  if (filter?.level) query.level = filter.level;
  if (filter?.category) query.category = filter.category;
  const [total, docs] = await Promise.all([
    col.countDocuments(query),
    col.find(query).sort({ ts: -1 }).skip(skip).limit(pageSize).toArray(),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return {
    items: docs.map(serializeFrontendLog),
    total,
    page: safePage,
    pageSize,
    totalPages,
  };
}

export async function getFrontendLog(id: string): Promise<FrontendLogDoc | null> {
  if (!ObjectId.isValid(id)) return null;
  const db = await getDb();
  return db.collection<FrontendLogDoc>(FRONTEND).findOne({ _id: new ObjectId(id) });
}

export async function getFrontendLogView(id: string): Promise<FrontendLogView | null> {
  const doc = await getFrontendLog(id);
  return doc ? serializeFrontendLog(doc) : null;
}
