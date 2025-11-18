import { ToolResult, ToolError, ErrorType } from './types';
import { ProgressCallback, ProgressUpdate } from './progress';

/**
 * Options for tool execution middleware
 */
export interface ToolExecutionOptions {
  retries?: number;
  timeout?: number;
  validate?: (result: ToolResult) => boolean;
  onRetry?: (attempt: number, error: Error) => void;
  onSuccess?: (result: ToolResult, executionTime: number) => void;
  onError?: (error: Error, executionTime: number) => void;
  onProgress?: ProgressCallback;
}

/**
 * Default execution options
 */
const DEFAULT_OPTIONS: Required<Omit<ToolExecutionOptions, 'validate' | 'onRetry' | 'onSuccess' | 'onError'>> = {
  retries: 0,
  timeout: 30000, // 30 seconds
};

/**
 * Error recovery strategies for common errors
 */
const ERROR_RECOVERY_STRATEGIES: Record<string, { action: string; message: string }> = {
  'File not found': {
    action: 'list_files',
    message: 'File not found. Try listing files to see what exists.',
  },
  'No sandbox found': {
    action: 'deploy_dapp',
    message: 'Sandbox not found. Try deploying the dApp first.',
  },
  'No active project': {
    action: 'create_project',
    message: 'No active project. Create or select a project first.',
  },
  'Directory already exists': {
    action: 'list_files',
    message: 'Directory already exists. Check what files are already present.',
  },
  'Validation failed': {
    action: 'validate_input',
    message: 'Input validation failed. Check the error message for details.',
  },
};

/**
 * Classifies error type based on error message
 */
function classifyError(error: Error | string): ErrorType {
  const message = typeof error === 'string' ? error : error.message;

  // Validation errors
  if (message.includes('validation') || message.includes('invalid') || message.includes('required')) {
    return ErrorType.VALIDATION;
  }

  // Transient errors (network, timeout)
  if (message.includes('timeout') || message.includes('network') || message.includes('connection')) {
    return ErrorType.TRANSIENT;
  }

  // Permanent errors (file not found, permission denied)
  if (message.includes('not found') || message.includes('permission') || message.includes('denied')) {
    return ErrorType.PERMANENT;
  }

  // Default to recoverable
  return ErrorType.RECOVERABLE;
}

/**
 * Gets recovery strategy for an error
 */
export function getRecoveryStrategy(error: Error | string): { action: string; message: string } | null {
  const message = typeof error === 'string' ? error : error.message;

  for (const [pattern, strategy] of Object.entries(ERROR_RECOVERY_STRATEGIES)) {
    if (message.includes(pattern)) {
      return strategy;
    }
  }

  return null;
}

/**
 * Executes a tool with middleware (retry, timeout, validation, logging)
 */
export async function executeTool(
  toolName: string,
  executor: () => Promise<ToolResult>,
  options: ToolExecutionOptions = {}
): Promise<ToolResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const startTime = Date.now();
  let lastError: Error | null = null;
  let attempt = 0;

  const executeWithTimeout = async (): Promise<ToolResult> => {
    if (opts.timeout > 0) {
      return Promise.race([
        executor(),
        new Promise<ToolResult>((_, reject) =>
          setTimeout(() => reject(new Error(`Tool execution timeout after ${opts.timeout}ms`)), opts.timeout)
        ),
      ]);
    }
    return executor();
  };

  while (attempt <= opts.retries) {
    try {
      const result = await executeWithTimeout();
      const executionTime = Date.now() - startTime;

      // Add metadata
      result.metadata = {
        ...result.metadata,
        executionTime,
        retryCount: attempt,
        timestamp: Date.now(),
      };

      // Validate result if validator provided
      if (opts.validate && !opts.validate(result)) {
        throw new ToolError(
          'Tool result validation failed',
          'VALIDATION_FAILED',
          ErrorType.VALIDATION,
          false,
        );
      }

      // Call success callback
      if (opts.onSuccess) {
        opts.onSuccess(result, executionTime);
      }

      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const executionTime = Date.now() - startTime;

      // Classify error
      const errorType = classifyError(lastError);

      // Check if we should retry
      if (attempt < opts.retries && (errorType === ErrorType.TRANSIENT || errorType === ErrorType.RECOVERABLE)) {
        attempt++;
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // Exponential backoff, max 5s

        if (opts.onRetry) {
          opts.onRetry(attempt, lastError);
        }

        // Wait before retry
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      // Not retrying - call error callback
      if (opts.onError) {
        opts.onError(lastError, executionTime);
      }

      // Convert to ToolResult
      if (lastError instanceof ToolError) {
        return lastError.toToolResult();
      }

      // Get recovery strategy
      const recovery = getRecoveryStrategy(lastError);

      return {
        success: false,
        message: lastError.message || 'Tool execution failed',
        error: lastError.message || String(lastError),
        warnings: recovery ? [recovery.message] : undefined,
        metadata: {
          executionTime,
          retryCount: attempt,
          timestamp: Date.now(),
        },
      };
    }
  }

  // Should never reach here, but TypeScript needs it
  return {
    success: false,
    message: lastError?.message || 'Tool execution failed after all retries',
    error: lastError?.message || 'Unknown error',
    metadata: {
      executionTime: Date.now() - startTime,
      retryCount: attempt,
      timestamp: Date.now(),
    },
  };
}

/**
 * Creates a cached version of a tool executor
 */
export function createCachedExecutor(
  executor: () => Promise<ToolResult>,
  ttl: number = 5000
): () => Promise<ToolResult> {
  const cache = new Map<string, { result: ToolResult; timestamp: number }>();

  return async (): Promise<ToolResult> => {
    const key = 'cached'; // For read-only tools, same args = same result
    const cached = cache.get(key);

    if (cached && Date.now() - cached.timestamp < ttl) {
      return {
        ...cached.result,
        metadata: {
          ...cached.result.metadata,
          cached: true,
        },
      };
    }

    const result = await executor();
    cache.set(key, { result, timestamp: Date.now() });
    return result;
  };
}

/**
 * Clears the cache for a cached executor
 */
export function clearToolCache(): void {
  // This would need to be implemented with a shared cache store
  // For now, individual executors manage their own cache
}

