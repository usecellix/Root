import { ObjectId } from "mongodb";

export interface RequestLogDoc {
  _id: ObjectId;
  ts: Date;
  method: string;
  url: string;
  statusCode: number;
  responseTimeMs: number;
  reqId?: string;
  traceId?: string;
  message?: string;
  response?: unknown;
}

export interface PlannerSubtask {
  id?: string;
  description?: string;
  targetSheet?: string;
  dependsOn?: string[];
  estimatedActions?: number;
}

export interface PlannerParsed {
  subtasks?: PlannerSubtask[];
  clarificationsNeeded?: string[];
  confidence?: string;
  reasoning?: string;
}

export interface PlannerLogDoc {
  _id: ObjectId;
  ts: Date;
  correlationId: string;
  model: string;
  durationMs: number;
  success: boolean;
  error?: string;
  input: {
    prompt?: string;
    userMessage?: string;
    routerAssumption?: string;
    historyLength?: number;
    sheets?: string[];
    activeSheet?: string;
    hasPromptContext?: boolean;
    systemPrompt?: string;
    [key: string]: unknown;
  };
  output: {
    raw?: string;
    parsed?: PlannerParsed;
    fallback?: boolean;
    retried?: boolean;
    [key: string]: unknown;
  };
}

export interface OverviewStats {
  requestCount: number;
  plannerCount: number;
  frontendCount: number;
  frontendErrorCount: number;
  plannerSuccessRate: number;
  avgPlannerLatencyMs: number;
  recentRequests: RequestLogDoc[];
  recentPlanner: PlannerLogDoc[];
  recentFrontend: FrontendLogDoc[];
}

export type FrontendLogLevel = 'error' | 'warn' | 'info' | 'action';
export type FrontendLogCategory =
  | 'console'
  | 'preview'
  | 'accept'
  | 'reject'
  | 'apply'
  | 'sse'
  | 'navigation'
  | 'other';

export interface FrontendLogDoc {
  _id: ObjectId;
  ts: Date;
  level: FrontendLogLevel;
  category: FrontendLogCategory;
  event: string;
  message: string;
  conversationId?: string;
  changeSetId?: string;
  sessionId?: string;
  workbookKey?: string;
  userAgent?: string;
  pageUrl?: string;
  details?: unknown;
}
