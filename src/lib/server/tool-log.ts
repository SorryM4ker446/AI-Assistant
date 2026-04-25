import type { ApiErrorCode } from "@/lib/server/api-error";

export type ToolLogState = "input-available" | "output-available" | "output-error";

export function logToolExecution(params: {
  toolId: string;
  trigger: "manual" | "auto";
  state: ToolLogState;
  durationMs: number;
  userId: string;
  errorCode?: ApiErrorCode;
  requestId?: string;
}) {
  console.info("tool.execution", {
    toolId: params.toolId,
    trigger: params.trigger,
    state: params.state,
    durationMs: params.durationMs,
    userId: params.userId,
    ...(params.errorCode ? { errorCode: params.errorCode } : {}),
    ...(params.requestId ? { requestId: params.requestId } : {}),
  });
}
