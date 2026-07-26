export class RuntimeError extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "RuntimeError";
    this.code = code;
  }
}
