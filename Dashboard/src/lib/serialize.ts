import type { FrontendLogDoc, PlannerLogDoc, RequestLogDoc } from "./types";

export type RequestLogView = Omit<RequestLogDoc, "_id" | "ts"> & {
  _id: string;
  ts: string;
};

export type PlannerLogView = Omit<PlannerLogDoc, "_id" | "ts"> & {
  _id: string;
  ts: string;
};

export type FrontendLogView = Omit<FrontendLogDoc, "_id" | "ts"> & {
  _id: string;
  ts: string;
};

export function serializeRequestLog(doc: RequestLogDoc): RequestLogView {
  return {
    ...doc,
    _id: String(doc._id),
    ts: new Date(doc.ts).toISOString(),
  };
}

export function serializePlannerLog(doc: PlannerLogDoc): PlannerLogView {
  return {
    ...doc,
    _id: String(doc._id),
    ts: new Date(doc.ts).toISOString(),
  };
}

export function serializeFrontendLog(doc: FrontendLogDoc): FrontendLogView {
  return {
    ...doc,
    _id: String(doc._id),
    ts: new Date(doc.ts).toISOString(),
  };
}
