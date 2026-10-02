/**
 * HTTP client for PipeLedger API v1.
 * Thin wrapper around native fetch with auth header injection.
 */

import { requireConfig, type CliConfig } from "./config";
import {
  CUSTOMER_PROBLEM_CATALOG,
  CUSTOMER_PROBLEM_SAFE_CONTEXT_KEYS,
  CustomerProblemSchema,
  type CustomerProblem,
  type CustomerProblemCode,
  type CustomerRecovery,
} from "shared/src/public-client";
import { LocalCliError } from "./local-error";
import { PIPELEDGER_CLI_VERSION } from "./version";

export const PIPELEDGER_CLI_CLIENT = "cli";
export { PIPELEDGER_CLI_VERSION } from "./version";

const CORRELATION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_RETRY_AFTER_SECONDS = 86_400;

const HTTP_ERROR_FALLBACK_CODES: Readonly<
  Partial<Record<number, CustomerProblemCode>>
> = {
  400: "E_INVALID_INPUT",
  401: "E_CREDENTIAL_INVALID",
  402: "E_USAGE_BILLING_LIMIT_REACHED",
  403: "E_ACCESS_DENIED",
  404: "E_RESOURCE_NOT_FOUND",
  408: "E_OPERATION_TIMEOUT",
  409: "E_CONFLICT",
  422: "E_INVALID_INPUT",
  429: "E_RATE_LIMITED",
  500: "E_INTERNAL",
  502: "E_DEPENDENCY_UNAVAILABLE",
  503: "E_DEPENDENCY_UNAVAILABLE",
  504: "E_OPERATION_TIMEOUT",
};

interface ApiErrorResponse {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  instance?: string;
  error?: string;
  code?: string;
  correlation_id?: string;
  remediation?: string;
  recovery?: CustomerRecovery;
  retryable?: boolean;
  retry_after_seconds?: number;
}

export class ApiClientError extends Error {
  constructor(
    readonly customerDetail: string,
    readonly statusCode: number,
    readonly code?: string,
    readonly correlationId?: string,
    readonly remediation?: string,
    readonly retryable?: boolean,
    readonly problem?: CustomerProblem,
    readonly recovery?: CustomerRecovery,
    readonly retryAfterSeconds?: number,
  ) {
    const prefix = code ? `[${code}] ` : "";
    const context = [
      `HTTP ${statusCode}`,
      ...(correlationId ? [`correlation ${correlationId}`] : []),
    ].join("; ");
    super(
      `${prefix}${customerDetail} (${context})${
        remediation ? ` Remediation: ${remediation}` : ""
      }${recovery ? ` Recovery: ${recovery.replace(/_/g, " ")}.` : ""}`
    );
    this.name = "ApiClientError";
  }

  static fromProblem(problem: CustomerProblem): ApiClientError {
    return new ApiClientError(
      problem.detail,
      problem.status,
      problem.code,
      problem.correlation_id,
      undefined,
      problem.retryable,
      problem,
      problem.recovery,
      problem.retry_after_seconds,
    );
  }

  toJSON(): CustomerProblem | ApiErrorResponse {
    if (this.problem) return this.problem;
    return {
      error: this.customerDetail,
      status: this.statusCode,
      ...(this.code ? { code: this.code } : {}),
      ...(this.correlationId
        ? { correlation_id: this.correlationId }
        : {}),
      ...(this.remediation ? { remediation: this.remediation } : {}),
      ...(this.recovery ? { recovery: this.recovery } : {}),
      ...(this.retryable !== undefined ? { retryable: this.retryable } : {}),
      ...(this.retryAfterSeconds !== undefined
        ? { retry_after_seconds: this.retryAfterSeconds }
        : {}),
    };
  }
}

export class ApiClient {
  private readonly config: CliConfig;
  private organizationCheck?: Promise<void>;

  constructor(config?: CliConfig) {
    this.config = { ...(config ?? requireConfig()) };
  }

  get baseUrl(): string {
    return this.config.api_url.replace(/\/$/, "");
  }

  /** Undefined for an environment-sourced config; the server resolves it. */
  get orgId(): string | undefined {
    return this.config.org_id;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.credential_secret}`,
      "Content-Type": "application/json",
      "X-PipeLedger-Client": PIPELEDGER_CLI_CLIENT,
      "X-PipeLedger-Client-Version": PIPELEDGER_CLI_VERSION,
      ...extra,
    };
  }

  async get<T = unknown>(path: string): Promise<T> {
    await this.verifyOrganization();
    const res = await this.fetch(`${this.baseUrl}${path}`, {
      method: "GET",
      headers: this.headers(),
    });
    return this.handleResponse<T>(res);
  }

  async post<T = unknown>(path: string, body?: unknown): Promise<T> {
    if (path !== "/api/v1/auth/validate") await this.verifyOrganization();
    const res = await this.fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: this.headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await this.handleResponse<T>(res);
    if (path === "/api/v1/auth/validate") this.assertOrganization(result);
    return result;
  }

  async patch<T = unknown>(path: string, body?: unknown): Promise<T> {
    await this.verifyOrganization();
    const res = await this.fetch(`${this.baseUrl}${path}`, {
      method: "PATCH",
      headers: this.headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return this.handleResponse<T>(res);
  }

  /**
   * Open an SSE stream. Returns the raw Response for the caller to consume.
   */
  async stream(path: string): Promise<Response> {
    await this.verifyOrganization();
    const res = await this.fetch(`${this.baseUrl}${path}`, {
      method: "GET",
      headers: this.headers({ Accept: "text/event-stream" }),
    });
    if (!res.ok) {
      throw await this.buildError(res);
    }
    return res;
  }

  private assertOrganization(identity: unknown): void {
    if (!this.config.org_id) return;
    if (!identity || typeof identity !== "object" ||
        !("org_id" in identity) || identity.org_id !== this.config.org_id) {
      throw new LocalCliError(
        "The credential's authenticated organization does not match the selected profile. No financial request was sent. Run `pl login` with the correct organization's credential.",
        "E_CLI_AUTH_REQUIRED",
      );
    }
  }

  /** Pin this client's credential and verify its tenant before reads or writes. */
  private async verifyOrganization(): Promise<void> {
    if (!this.config.org_id) return;
    this.organizationCheck ??= this.post("/api/v1/auth/validate", {}).then(() => undefined);
    await this.organizationCheck;
  }

  private async fetch(input: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(input, { ...init, redirect: "error" });
    } catch {
      throw new LocalCliError(
        "Could not reach the PipeLedger API. Check the API URL and network connection.",
        "E_CLI_NETWORK",
      );
    }
  }

  private async handleResponse<T>(res: Response): Promise<T> {
    if (!res.ok) {
      throw await this.buildError(res);
    }
    return res.json() as Promise<T>;
  }

  private async buildError(res: Response): Promise<ApiClientError> {
    try {
      const parsed: unknown = await res.json();
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const problem = parseReviewedCustomerProblem(
          parsed,
          res.status,
          res.headers.get("x-correlation-id"),
        );
        if (problem) return ApiClientError.fromProblem(problem);
      }
    } catch {
      // Preserve the HTTP status even when an upstream response is not JSON.
    }

    // A response that does not satisfy the strict CustomerProblem contract is
    // unreviewed input. Use only code-owned copy selected from the HTTP status;
    // never project legacy body fields into CLI output.
    const code = HTTP_ERROR_FALLBACK_CODES[res.status] ?? "E_INTERNAL";
    const definition = CUSTOMER_PROBLEM_CATALOG[code];
    const correlationId = validatedCorrelationId(
      res.headers.get("x-correlation-id"),
    );
    const retryAfterSeconds = definition.retryable
      ? validatedRetryAfterSeconds(res.headers.get("retry-after"))
      : undefined;

    return new ApiClientError(
      definition.detail,
      res.status,
      code,
      correlationId,
      undefined,
      definition.retryable,
      undefined,
      definition.recovery,
      retryAfterSeconds,
    );
  }
}

export function parseReviewedCustomerProblem(
  value: unknown,
  responseStatus?: number,
  responseCorrelationId?: string | null,
): CustomerProblem | undefined {
  const parsed = CustomerProblemSchema.safeParse(value);
  if (!parsed.success) return undefined;

  const problem = parsed.data;
  if (
    !Object.prototype.hasOwnProperty.call(
      CUSTOMER_PROBLEM_CATALOG,
      problem.code,
    )
  ) {
    return undefined;
  }

  const code = problem.code as CustomerProblemCode;
  const definition = CUSTOMER_PROBLEM_CATALOG[code];
  const expectedSlug = code.slice(2).toLowerCase().replace(/_/g, "-");
  const responseCorrelation =
    typeof responseCorrelationId === "string"
      ? validatedCorrelationId(responseCorrelationId)
      : undefined;
  const safeContextKeys: ReadonlySet<string> = new Set(
    CUSTOMER_PROBLEM_SAFE_CONTEXT_KEYS[code],
  );
  if (
    (responseStatus !== undefined && problem.status !== responseStatus) ||
    (typeof responseCorrelationId === "string" &&
      responseCorrelation !== problem.correlation_id) ||
    problem.status !== definition.status ||
    problem.title !== definition.title ||
    problem.type !== `urn:pipeledger:problem:${expectedSlug}` ||
    problem.instance !== `urn:pipeledger:request:${problem.correlation_id}` ||
    problem.fault_domain !== definition.faultDomain ||
    problem.recovery !== definition.recovery ||
    problem.retryable !== definition.retryable ||
    Object.keys(problem.safe_context ?? {}).some(
      (key) => !safeContextKeys.has(key),
    )
  ) {
    return undefined;
  }

  return problem;
}

function validatedCorrelationId(value: string | null): string | undefined {
  const candidate = value?.trim();
  return candidate && CORRELATION_ID_PATTERN.test(candidate)
    ? candidate
    : undefined;
}

function validatedRetryAfterSeconds(value: string | null): number | undefined {
  const candidate = value?.trim();
  if (!candidate || !/^[1-9][0-9]*$/.test(candidate)) return undefined;

  const seconds = Number(candidate);
  return Number.isSafeInteger(seconds) && seconds <= MAX_RETRY_AFTER_SECONDS
    ? seconds
    : undefined;
}
