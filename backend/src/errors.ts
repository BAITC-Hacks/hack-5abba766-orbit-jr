import type { ErrorCode } from './types';
export class AppError extends Error {
  constructor(public code: ErrorCode, message: string, public status = 400, public details?: Record<string, unknown>) { super(message); }
}
export function invariant(condition: unknown, code: ErrorCode, message: string, status = 400): asserts condition {
  if (!condition) throw new AppError(code, message, status);
}
