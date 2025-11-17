import { ToolResult, ErrorType } from './types';
import { getRecoveryStrategy } from './middleware';

/**
 * Error recovery context for tracking errors and recovery attempts
 */
export interface ErrorRecoveryContext {
  toolName: string;
  args: any;
  attempts: number;
  errors: string[];
  lastError: string;
  suggestedFix?: string;
  recoveryAttempted?: boolean;
}

/**
 * Creates a recovery context from a failed tool call
 */
export function createRecoveryContext(
  toolName: string,
  args: any,
  error: Error | string
): ErrorRecoveryContext {
  const errorMessage = typeof error === 'string' ? error : error.message;
  const recovery = getRecoveryStrategy(error);

  return {
    toolName,
    args,
    attempts: 1,
    errors: [errorMessage],
    lastError: errorMessage,
    suggestedFix: recovery?.message,
    recoveryAttempted: false,
  };
}

/**
 * Updates recovery context with a new error
 */
export function updateRecoveryContext(
  context: ErrorRecoveryContext,
  error: Error | string
): ErrorRecoveryContext {
  const errorMessage = typeof error === 'string' ? error : error.message;
  return {
    ...context,
    attempts: context.attempts + 1,
    errors: [...context.errors, errorMessage],
    lastError: errorMessage,
  };
}

/**
 * Enhances a tool result with recovery suggestions
 */
export function enhanceResultWithRecovery(
  result: ToolResult,
  context?: ErrorRecoveryContext
): ToolResult {
  if (result.success || !context) {
    return result;
  }

  const recovery = getRecoveryStrategy(context.lastError);

  return {
    ...result,
    warnings: [
      ...(result.warnings || []),
      ...(recovery ? [recovery.message] : []),
      ...(context.suggestedFix ? [context.suggestedFix] : []),
      `Previous attempts: ${context.attempts}`,
      `Previous errors: ${context.errors.slice(-2).join('; ')}`,
    ],
  };
}

/**
 * Determines if an error is recoverable
 */
export function isRecoverableError(error: Error | string): boolean {
  const message = typeof error === 'string' ? error : error.message;
  const recovery = getRecoveryStrategy(error);
  return recovery !== null;
}

/**
 * Gets suggested next action for an error
 */
export function getSuggestedAction(error: Error | string): string | null {
  const recovery = getRecoveryStrategy(error);
  return recovery?.action || null;
}

