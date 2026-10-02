import { z } from "zod";

export const CustomerFaultDomainSchema = z.enum([
  "request",
  "identity",
  "policy",
  "organization_configuration",
  "source_system",
  "billing",
  "platform",
]);

export type CustomerFaultDomain = z.infer<typeof CustomerFaultDomainSchema>;

export const CustomerRecoverySchema = z.enum([
  "correct_input",
  "retry",
  "wait",
  "reconnect",
  "request_access",
  "admin_action",
  "contact_support",
  "none",
]);

export type CustomerRecovery = z.infer<typeof CustomerRecoverySchema>;

export const CustomerFieldErrorSchema = z
  .object({
    path: z.array(z.union([z.string().max(100), z.number().int().nonnegative()])).max(12),
    message: z.string().min(1).max(300),
    code: z.string().min(1).max(100).optional(),
  })
  .strict();

export type CustomerFieldError = z.infer<typeof CustomerFieldErrorSchema>;

const CustomerSafeContextValueSchema = z.union([
  z.string().max(300),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

const CustomerSafeContextSchema = z
  .record(
    z.string().regex(/^[a-z][a-z0-9_]{0,99}$/),
    CustomerSafeContextValueSchema,
  )
  .superRefine((context, ctx) => {
    if (Object.keys(context).length > 20) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "safe_context is limited to 20 allowlisted fields",
      });
    }
  });

/**
 * The protocol-neutral customer problem contract. REST renders this as RFC 9457
 * Problem Details, MCP preserves it through its SDK-compatible tool-error
 * adapter, and the CLI preserves it in JSON mode. Diagnostic causes never
 * belong in this object.
 */
export const CustomerProblemSchema = z
  .object({
    type: z.string().min(1).max(300),
    title: z.string().min(1).max(160),
    status: z.number().int().min(400).max(599),
    detail: z.string().min(1).max(1_000),
    instance: z.string().min(1).max(300),
    code: z.string().regex(/^E_[A-Z0-9_]+$/),
    correlation_id: z.string().uuid(),
    fault_domain: CustomerFaultDomainSchema,
    recovery: CustomerRecoverySchema,
    retryable: z.boolean(),
    retry_after_seconds: z.number().int().positive().max(86_400).optional(),
    field_errors: z.array(CustomerFieldErrorSchema).max(50).optional(),
    safe_context: CustomerSafeContextSchema.optional(),
  })
  .strict()
  .superRefine((problem, ctx) => {
    if (problem.retry_after_seconds !== undefined && !problem.retryable) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["retry_after_seconds"],
        message: "retry_after_seconds requires retryable=true",
      });
    }
  });

export type CustomerProblem = z.infer<typeof CustomerProblemSchema>;

export const CustomerNoticeSchema = z
  .object({
    code: z.string().regex(/^N_[A-Z0-9_]+$/),
    level: z.enum(["info", "warning"]),
    title: z.string().min(1).max(160),
    detail: z.string().min(1).max(1_000),
  })
  .strict();

export type CustomerNotice = z.infer<typeof CustomerNoticeSchema>;

interface CustomerProblemDefinition {
  title: string;
  status: number;
  detail: string;
  faultDomain: CustomerFaultDomain;
  recovery: CustomerRecovery;
  retryable: boolean;
}

export const CUSTOMER_PROBLEM_CATALOG = {
  E_INVALID_JSON: {
    title: "Invalid request body",
    status: 400,
    detail: "The request body is not valid JSON. Correct the body and try again.",
    faultDomain: "request",
    recovery: "correct_input",
    retryable: false,
  },
  E_INVALID_INPUT: {
    title: "Invalid request",
    status: 400,
    detail: "One or more request fields are invalid. Correct the fields and try again.",
    faultDomain: "request",
    recovery: "correct_input",
    retryable: false,
  },
  E_AUTHENTICATION_REQUIRED: {
    title: "Authentication required",
    status: 401,
    detail: "Authenticate with a valid PipeLedger credential and try again.",
    faultDomain: "identity",
    recovery: "reconnect",
    retryable: false,
  },
  E_CREDENTIAL_INVALID: {
    title: "Credential not accepted",
    status: 401,
    detail: "The credential is invalid, expired, or revoked. Authenticate again with an active credential.",
    faultDomain: "identity",
    recovery: "reconnect",
    retryable: false,
  },
  E_CREDENTIAL_AUTH_UNAVAILABLE: {
    title: "Credential verification unavailable",
    status: 503,
    detail: "PipeLedger could not verify the credential because the authentication service is temporarily unavailable. Keep the existing credential and try again later.",
    faultDomain: "platform",
    recovery: "retry",
    retryable: true,
  },
  E_ACCESS_POLICY_UNAVAILABLE: {
    title: "Access policy verification unavailable",
    status: 503,
    detail:
      "PipeLedger authenticated the credential but could not verify its access policy because the policy service is temporarily unavailable. Keep the existing credential and try again later.",
    faultDomain: "platform",
    recovery: "retry",
    retryable: true,
  },
  E_ACCESS_DENIED: {
    title: "Access denied",
    status: 403,
    detail: "This credential does not have access to the requested operation.",
    faultDomain: "policy",
    recovery: "request_access",
    retryable: false,
  },
  E_REPORT_RECIPE_STALE: {
    title: "Saved recipe needs revision",
    status: 409,
    detail: "This saved recipe no longer matches the current tool contracts. Ask its owner to revise and save it before loading again.",
    faultDomain: "organization_configuration",
    recovery: "admin_action",
    retryable: false,
  },
  E_RESOURCE_NOT_FOUND: {
    title: "Resource not found",
    status: 404,
    detail: "The requested resource was not found or is not available to this credential.",
    faultDomain: "request",
    recovery: "correct_input",
    retryable: false,
  },
  E_CONFLICT: {
    title: "Request conflicts with current state",
    status: 409,
    detail: "The operation conflicts with the resource's current state. Refresh the resource before trying again.",
    faultDomain: "request",
    recovery: "correct_input",
    retryable: false,
  },
  E_OPERATION_IN_PROGRESS: {
    title: "Operation already in progress",
    status: 409,
    detail:
      "This operation is already in progress. Wait for the current request to finish before taking another action.",
    faultDomain: "platform",
    recovery: "wait",
    retryable: false,
  },
  E_MUTATION_OUTCOME_UNKNOWN: {
    title: "Operation outcome needs confirmation",
    status: 409,
    detail:
      "PipeLedger could not confirm whether the operation completed. Do not submit it again. Contact PipeLedger support with the reference shown.",
    faultDomain: "platform",
    recovery: "contact_support",
    retryable: false,
  },
  E_MART_NOT_PUBLISHED: {
    title: "Data source is not published",
    status: 409,
    detail: "The requested data source is not currently published. An administrator must review its publication status before this request can run.",
    faultDomain: "organization_configuration",
    recovery: "admin_action",
    retryable: false,
  },
  E_FIQ_CREDENTIAL_QUOTA_EXCEEDED: {
    title: "Credential usage quota reached",
    status: 429,
    detail:
      "This credential has reached its monthly Financial Intelligence Query quota. Ask an administrator to increase the credential quota or wait for the next billing cycle.",
    faultDomain: "billing",
    recovery: "admin_action",
    retryable: false,
  },
  E_FIQ_CREDENTIAL_QUOTA_UNAVAILABLE: {
    title: "Credential usage quota unavailable",
    status: 503,
    detail:
      "PipeLedger could not verify this credential's monthly Financial Intelligence Query quota because the billing service is temporarily unavailable. Keep the existing credential and try again later.",
    faultDomain: "platform",
    recovery: "retry",
    retryable: true,
  },
  E_USAGE_BILLING_LIMIT_REACHED: {
    title: "Usage limit reached",
    status: 402,
    detail:
      "The organization's usage limit was reached. Add prepaid credits, upgrade the plan, or contact billing to continue.",
    faultDomain: "billing",
    recovery: "admin_action",
    retryable: false,
  },
  E_USAGE_BILLING_UNAVAILABLE: {
    title: "Usage verification unavailable",
    status: 503,
    detail:
      "PipeLedger could not verify available usage capacity because the billing service is temporarily unavailable. Try again later.",
    faultDomain: "platform",
    recovery: "retry",
    retryable: true,
  },
  E_PRODUCT_ACCESS_REQUIRED: {
    title: "Product access required",
    status: 402,
    detail:
      "This organization does not have the product access required for this operation. Ask an administrator to activate it before trying again.",
    faultDomain: "billing",
    recovery: "admin_action",
    retryable: false,
  },
  E_BILLING_PAYMENT_REQUIRED: {
    title: "Payment could not be completed",
    status: 402,
    detail: "Update your payment method, then return to review and confirm the purchase again.",
    faultDomain: "billing",
    recovery: "correct_input",
    retryable: false,
  },
  E_BILLING_PORTAL_CONFIGURATION: {
    title: "Billing portal access unavailable",
    status: 409,
    detail:
      "Billing portal access is not enabled. Ask a PipeLedger administrator to review the billing portal configuration.",
    faultDomain: "platform",
    recovery: "admin_action",
    retryable: false,
  },
  E_RATE_LIMITED: {
    title: "Request rate limit reached",
    status: 429,
    detail: "The request rate limit was reached. Wait for the indicated interval before trying again.",
    faultDomain: "platform",
    recovery: "wait",
    retryable: true,
  },
  E_RATE_LIMIT_CONFIGURATION: {
    title: "Request safety configuration unavailable",
    status: 500,
    detail:
      "PipeLedger could not apply a required request safety control. Contact PipeLedger support with the reference shown.",
    faultDomain: "platform",
    recovery: "contact_support",
    retryable: false,
  },
  E_DEPENDENCY_UNAVAILABLE: {
    title: "Service temporarily unavailable",
    status: 503,
    detail: "A service required for this operation is temporarily unavailable. Try again later.",
    faultDomain: "platform",
    recovery: "retry",
    retryable: true,
  },
  E_OPERATION_TIMEOUT: {
    title: "Operation timed out",
    status: 504,
    detail: "The operation did not finish within its time limit. Try again with a narrower request.",
    faultDomain: "platform",
    recovery: "retry",
    retryable: true,
  },
  E_INTERNAL: {
    title: "PipeLedger could not complete the request",
    status: 500,
    detail: "An internal error prevented the request from completing. Contact PipeLedger support with the reference shown.",
    faultDomain: "platform",
    recovery: "contact_support",
    retryable: false,
  },
} as const satisfies Record<string, CustomerProblemDefinition>;

export type CustomerProblemCode = keyof typeof CUSTOMER_PROBLEM_CATALOG;

const MAX_PUBLIC_DETAIL_LENGTH = 1_000;
const MAX_FIELD_ERRORS = 50;
const MAX_FIELD_PATH_SEGMENTS = 12;
const MAX_FIELD_PATH_STRING_LENGTH = 100;
const MAX_FIELD_MESSAGE_LENGTH = 300;
const MAX_FIELD_CODE_LENGTH = 100;
const MAX_SAFE_CONTEXT_STRING_LENGTH = 300;

function clampString(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

function boundedPublicDetail(
  publicDetail: string | undefined,
  fallback: string,
): string {
  if (typeof publicDetail !== "string" || publicDetail.trim().length === 0) {
    return fallback;
  }
  return clampString(publicDetail, MAX_PUBLIC_DETAIL_LENGTH);
}

function boundedRetryAfterSeconds(
  retryable: boolean,
  value: number | undefined,
): number | undefined {
  if (
    !retryable ||
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value <= 0
  ) {
    return undefined;
  }
  return Math.min(86_400, Math.max(1, Math.ceil(value)));
}

function boundedFieldErrors(
  fieldErrors: readonly CustomerFieldError[] | undefined,
): CustomerFieldError[] | undefined {
  if (!Array.isArray(fieldErrors)) return undefined;

  const bounded = fieldErrors.slice(0, MAX_FIELD_ERRORS).map((fieldError) => {
    const path = Array.isArray(fieldError?.path)
      ? fieldError.path
          .slice(0, MAX_FIELD_PATH_SEGMENTS)
          .flatMap((segment: string | number) => {
            if (typeof segment === "string") {
              return [clampString(segment, MAX_FIELD_PATH_STRING_LENGTH)];
            }
            if (
              typeof segment === "number" &&
              Number.isInteger(segment) &&
              segment >= 0
            ) {
              return [segment];
            }
            return [];
          })
      : [];
    const message =
      typeof fieldError?.message === "string" &&
      fieldError.message.trim().length > 0
        ? clampString(fieldError.message, MAX_FIELD_MESSAGE_LENGTH)
        : "Invalid value.";
    const code =
      typeof fieldError?.code === "string" && fieldError.code.trim().length > 0
        ? clampString(fieldError.code, MAX_FIELD_CODE_LENGTH)
        : undefined;

    return {
      path,
      message,
      ...(code ? { code } : {}),
    };
  });

  return bounded.length > 0 ? bounded : undefined;
}

/**
 * Customer context is code-owned. A syntactically harmless key is not enough:
 * callers may only emit the bounded fields reviewed for that exact problem.
 * Unknown keys are removed at the shared boundary instead of being trusted as
 * arbitrary exception context.
 */
export const CUSTOMER_PROBLEM_SAFE_CONTEXT_KEYS = {
  E_INVALID_JSON: [],
  E_INVALID_INPUT: [
    "operation",
    "field",
    "mart",
    "missing_column_count",
    "pipeline_state",
    "connector_state",
    "failure_code",
    "coverage_failure",
    "verified_through",
    "required_through",
    "recovery_tool",
    "recovery_stage",
    "recovery_sync_mode",
    "recovery_marts",
    "requires_operator_approval",
    "transformation_only_sufficient",
  ],
  E_AUTHENTICATION_REQUIRED: [],
  E_CREDENTIAL_INVALID: [],
  E_CREDENTIAL_AUTH_UNAVAILABLE: ["operation"],
  E_ACCESS_POLICY_UNAVAILABLE: ["operation"],
  E_ACCESS_DENIED: [
    "operation",
    "required_tool",
    "required_role",
    "mart",
    "excluded_column_count",
    "missing_mart_count",
    "your_clearance",
    "period_label",
    "fiscal_year",
    "fiscal_quarter",
    "failure_code",
  ],
  E_REPORT_RECIPE_STALE: ["report_id", "step_id"],
  E_RESOURCE_NOT_FOUND: ["operation", "failure_code"],
  E_CONFLICT: ["operation", "failure_code", "pipeline_state", "connector_state"],
  E_OPERATION_IN_PROGRESS: ["operation", "failure_code"],
  E_MUTATION_OUTCOME_UNKNOWN: ["operation", "failure_code"],
  E_MART_NOT_PUBLISHED: ["operation", "mart", "missing_mart_count", "failure_code"],
  E_FIQ_CREDENTIAL_QUOTA_EXCEEDED: ["current", "limit", "projected"],
  E_FIQ_CREDENTIAL_QUOTA_UNAVAILABLE: [],
  E_USAGE_BILLING_LIMIT_REACHED: [
    "current",
    "limit",
    "projected",
    "postpaid_cap_cents",
    "postpaid_exposure_cents",
    "projected_postpaid_exposure_cents",
  ],
  E_USAGE_BILLING_UNAVAILABLE: [],
  E_PRODUCT_ACCESS_REQUIRED: ["operation", "feature"],
  E_BILLING_PAYMENT_REQUIRED: ["operation", "failure_code"],
  E_BILLING_PORTAL_CONFIGURATION: ["operation", "failure_code"],
  E_RATE_LIMITED: ["limit"],
  E_RATE_LIMIT_CONFIGURATION: ["operation", "failure_code"],
  E_DEPENDENCY_UNAVAILABLE: ["operation", "failure_code"],
  E_OPERATION_TIMEOUT: ["operation", "failure_code"],
  E_INTERNAL: ["operation", "failure_code"],
} as const satisfies Record<CustomerProblemCode, readonly string[]>;

function projectCustomerSafeContext(
  code: CustomerProblemCode,
  context: Record<string, string | number | boolean | null>,
): Record<string, string | number | boolean | null> | undefined {
  if (context === null || typeof context !== "object" || Array.isArray(context)) {
    return undefined;
  }

  const projected: Record<string, string | number | boolean | null> = {};
  for (const key of CUSTOMER_PROBLEM_SAFE_CONTEXT_KEYS[code]) {
    if (!Object.prototype.hasOwnProperty.call(context, key)) continue;
    const value = context[key];
    if (typeof value === "string") {
      projected[key] = clampString(value, MAX_SAFE_CONTEXT_STRING_LENGTH);
    } else if (typeof value === "number" && Number.isFinite(value)) {
      projected[key] = Math.min(
        Number.MAX_SAFE_INTEGER,
        Math.max(Number.MIN_SAFE_INTEGER, value),
      );
    } else if (typeof value === "boolean" || value === null) {
      projected[key] = value;
    }
  }

  // Keep the schema parse as an executable assertion that this projection and
  // its allowlist remain within the public contract as the catalog evolves.
  CustomerSafeContextSchema.parse(projected);
  return Object.keys(projected).length > 0 ? projected : undefined;
}

export interface CreateCustomerProblemOptions {
  /** Internal request UUID. Invalid values are a programming invariant breach. */
  correlationId: string;
  publicDetail?: string;
  retryAfterSeconds?: number;
  fieldErrors?: CustomerFieldError[];
  safeContext?: Record<string, string | number | boolean | null>;
}

export function createCustomerProblem(
  code: CustomerProblemCode,
  options: CreateCustomerProblemOptions,
): CustomerProblem {
  const definition = CUSTOMER_PROBLEM_CATALOG[code];
  const slug = code.slice(2).toLowerCase().replace(/_/g, "-");
  const safeContext = options.safeContext
    ? projectCustomerSafeContext(code, options.safeContext)
    : undefined;
  const fieldErrors = boundedFieldErrors(options.fieldErrors);
  const retryAfterSeconds = boundedRetryAfterSeconds(
    definition.retryable,
    options.retryAfterSeconds,
  );

  return CustomerProblemSchema.parse({
    type: `urn:pipeledger:problem:${slug}`,
    title: definition.title,
    status: definition.status,
    detail: boundedPublicDetail(options.publicDetail, definition.detail),
    instance: `urn:pipeledger:request:${options.correlationId}`,
    code,
    correlation_id: options.correlationId,
    fault_domain: definition.faultDomain,
    recovery: definition.recovery,
    retryable: definition.retryable,
    ...(retryAfterSeconds !== undefined
      ? { retry_after_seconds: retryAfterSeconds }
      : {}),
    ...(fieldErrors ? { field_errors: fieldErrors } : {}),
    ...(safeContext ? { safe_context: safeContext } : {}),
  });
}
