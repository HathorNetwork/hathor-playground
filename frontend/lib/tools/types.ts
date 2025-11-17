import type { File } from '@/store/ide-store';

/**
 * Standardized tool result format for all tools.
 * Ensures consistent error handling and metadata across the system.
 */
export interface ToolResult<T = any> {
  success: boolean;
  message: string;
  data?: T;
  error?: string;
  warnings?: string[];
  metadata?: {
    executionTime?: number;
    toolVersion?: string;
    retryCount?: number;
    cached?: boolean;
    timestamp?: number;
  };
}

export type HathorFile = Omit<File, 'id'>;

/**
 * Error types for classification and recovery
 */
export enum ErrorType {
  RECOVERABLE = 'recoverable', // Can retry with different approach
  PERMANENT = 'permanent', // Won't work, need user help
  TRANSIENT = 'transient', // Might work if retried later
  VALIDATION = 'validation', // Wrong input, fix and retry
}

/**
 * Custom error class for tool errors with classification
 */
export class ToolError extends Error {
  constructor(
    message: string,
    public code: string,
    public type: ErrorType,
    public recoverable: boolean = false,
    public suggestions?: string[],
    public originalError?: Error
  ) {
    super(message);
    this.name = 'ToolError';
  }

  toToolResult(): ToolResult {
    return {
      success: false,
      message: this.message,
      error: this.message,
      warnings: this.suggestions,
      metadata: {
        timestamp: Date.now(),
      },
    };
  }
}

/**
 * Validation result for pre-flight checks
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings?: string[];
  suggestions?: string[];
}

