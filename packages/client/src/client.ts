import type {
  ForgeOpsClientOptions,
  ForgeOpsDispatchRequest,
  ForgeOpsDispatchResponse,
  ForgeOpsListTasksParams,
  ForgeOpsListTasksResponse,
} from "./types.js";

type JsonValue = Record<string, unknown>;

export class ForgeOpsApiError extends Error {
  status: number;
  details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ForgeOpsApiError";
    this.status = status;
    this.details = details;
  }
}

export class ForgeOpsClient {
  private readonly baseUrl: string;
  private readonly apiSecret: string;
  private readonly customFetch?: typeof fetch;
  private readonly headers?: Record<string, string>;

  constructor(options: ForgeOpsClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.apiSecret = options.apiSecret;
    this.customFetch = options.fetch;
    this.headers = options.headers;
  }

  async dispatchTask(
    request: ForgeOpsDispatchRequest
  ): Promise<ForgeOpsDispatchResponse> {
    return this.request<ForgeOpsDispatchResponse>("/api/agents/dispatch", {
      method: "POST",
      body: JSON.stringify({
        agent: request.agent,
        taskType: request.taskType,
        priority: request.priority ?? "p1",
        input: request.input ?? {},
        triggeredBy: request.triggeredBy ?? "manual",
      }),
    });
  }

  async listTasks(
    params: ForgeOpsListTasksParams = {}
  ): Promise<ForgeOpsListTasksResponse> {
    const searchParams = new URLSearchParams();

    if (params.agent) searchParams.set("agent", params.agent);
    if (params.status) searchParams.set("status", params.status);
    if (typeof params.hours === "number") searchParams.set("hours", String(params.hours));
    if (typeof params.limit === "number") searchParams.set("limit", String(params.limit));

    const suffix = searchParams.toString();
    const path = suffix
      ? `/api/agents/dispatch?${suffix}`
      : "/api/agents/dispatch";

    return this.request<ForgeOpsListTasksResponse>(path, { method: "GET" });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const runtimeFetch = this.customFetch ?? globalThis.fetch;

    if (!runtimeFetch) {
      throw new Error("Fetch API indisponível. Use Node.js 18+ ou injete options.fetch.");
    }

    const response = await runtimeFetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.apiSecret}`,
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...this.headers,
        ...(init.headers as Record<string, string> | undefined),
      },
    });

    const payload = (await this.parseJson(response)) as T | JsonValue;

    if (!response.ok) {
      const errorPayload = payload as { error?: string; details?: unknown };
      throw new ForgeOpsApiError(
        errorPayload.error ?? `Request failed with status ${response.status}`,
        response.status,
        errorPayload.details
      );
    }

    return payload as T;
  }

  private async parseJson(response: Response): Promise<unknown> {
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      const text = await response.text();
      return text ? { error: text } : {};
    }

    return response.json();
  }
}

export function createForgeOpsClient(options: ForgeOpsClientOptions) {
  return new ForgeOpsClient(options);
}