export class AuthError extends Error {
  constructor(message?: string, options?: { cause?: unknown }) {
    super(
      message || "Authentication failed",
      options as unknown as ErrorOptions,
    );
    this.name = "AuthError";
  }
}

export class SheetNotFoundError extends Error {
  constructor(sheetId?: string, options?: { cause?: unknown }) {
    super(
      `Sheet not found: ${sheetId || "unknown"}`,
      options as unknown as ErrorOptions,
    );
    this.name = "SheetNotFoundError";
  }
}

export class FetchError extends Error {
  constructor(message?: string, options?: { cause?: unknown }) {
    super(
      message || "Failed to fetch sheet values",
      options as unknown as ErrorOptions,
    );
    this.name = "FetchError";
  }
}

/** Thrown for caller misconfiguration (e.g. an unknown dedupe/match column key). */
export class SheetConfigError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options as unknown as ErrorOptions);
    this.name = "SheetConfigError";
  }
}
