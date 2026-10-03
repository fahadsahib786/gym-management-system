export type ErrorKind =
  | "validation"
  | "notFound"
  | "conflict"
  | "forbidden"
  | "unauthenticated"
  | "database"
  | "io"
  | "data"
  | "other";

/** Error returned by the backend (`{ kind, message, field }`) or raised locally. */
export class AppError extends Error {
  readonly kind: ErrorKind;
  readonly field: string | null;

  constructor(kind: ErrorKind, message: string, field: string | null = null) {
    super(message);
    this.name = "AppError";
    this.kind = kind;
    this.field = field;
  }
}

export function toAppError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  if (e && typeof e === "object" && "message" in e) {
    const o = e as { kind?: string; message?: unknown; field?: unknown };
    const kind = (typeof o.kind === "string" ? o.kind : "other") as ErrorKind;
    const field = typeof o.field === "string" ? o.field : null;
    return new AppError(kind, String(o.message ?? "Something went wrong"), field);
  }
  if (typeof e === "string") return new AppError("other", e);
  return new AppError("other", "Something went wrong. Please try again.");
}

export function errorMessage(e: unknown): string {
  return toAppError(e).message;
}
