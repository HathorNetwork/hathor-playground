/**
 * Progress Tracking System for Long-Running Operations
 * 
 * Provides detailed progress updates for tools that take time to complete,
 * allowing users to see what's happening during long operations.
 */

import { ToolResult } from './types';

export type ProgressPhase = 'planning' | 'executing' | 'syncing' | 'deploying' | 'compiling' | 'testing' | 'uploading';

export interface ProgressUpdate {
  phase: ProgressPhase;
  currentStep: string;
  completed: number;
  total: number;
  estimatedTimeRemaining?: number; // in seconds
  details?: string;
}

export type ProgressCallback = (update: ProgressUpdate) => void;

/**
 * Progress tracker for long-running operations
 */
export class ProgressTracker {
  private phase: ProgressPhase;
  private currentStep: string;
  private completed: number;
  private total: number;
  private startTime: number;
  private callbacks: Set<ProgressCallback> = new Set();
  private stepStartTimes: Map<string, number> = new Map();

  constructor(
    phase: ProgressPhase,
    total: number,
    initialStep: string = 'Starting...'
  ) {
    this.phase = phase;
    this.currentStep = initialStep;
    this.completed = 0;
    this.total = total;
    this.startTime = Date.now();
  }

  /**
   * Register a callback to receive progress updates
   */
  onProgress(callback: ProgressCallback): () => void {
    this.callbacks.add(callback);
    // Return unsubscribe function
    return () => {
      this.callbacks.delete(callback);
    };
  }

  /**
   * Update progress with a new step
   */
  updateStep(step: string, details?: string): void {
    const now = Date.now();
    const elapsed = (now - this.startTime) / 1000; // seconds
    
    // Calculate estimated time remaining based on current progress
    let estimatedTimeRemaining: number | undefined;
    if (this.completed > 0 && this.total > 0) {
      const avgTimePerItem = elapsed / this.completed;
      const remaining = this.total - this.completed;
      estimatedTimeRemaining = Math.round(avgTimePerItem * remaining);
    }

    this.currentStep = step;
    const update: ProgressUpdate = {
      phase: this.phase,
      currentStep: step,
      completed: this.completed,
      total: this.total,
      estimatedTimeRemaining,
      details,
    };

    // Notify all callbacks
    this.callbacks.forEach((callback) => {
      try {
        callback(update);
      } catch (error) {
        console.error('Progress callback error:', error);
      }
    });
  }

  /**
   * Increment completed count
   */
  increment(step?: string, details?: string): void {
    this.completed = Math.min(this.completed + 1, this.total);
    if (step) {
      this.updateStep(step, details);
    } else {
      // Update with current step
      this.updateStep(this.currentStep, details);
    }
  }

  /**
   * Set completed count directly
   */
  setCompleted(count: number, step?: string, details?: string): void {
    this.completed = Math.min(Math.max(0, count), this.total);
    if (step) {
      this.updateStep(step, details);
    } else {
      this.updateStep(this.currentStep, details);
    }
  }

  /**
   * Mark as complete
   */
  complete(finalMessage?: string): void {
    this.completed = this.total;
    this.updateStep(finalMessage || 'Complete', undefined);
  }

  /**
   * Get current progress percentage
   */
  getProgress(): number {
    if (this.total === 0) return 0;
    return Math.round((this.completed / this.total) * 100);
  }

  /**
   * Get elapsed time in seconds
   */
  getElapsedTime(): number {
    return (Date.now() - this.startTime) / 1000;
  }
}

/**
 * Create a progress tracker for a specific operation
 */
export function createProgressTracker(
  phase: ProgressPhase,
  total: number,
  initialStep?: string
): ProgressTracker {
  return new ProgressTracker(phase, total, initialStep);
}

/**
 * Format progress update as a user-friendly message
 */
export function formatProgressMessage(update: ProgressUpdate): string {
  const percentage = update.total > 0 
    ? Math.round((update.completed / update.total) * 100) 
    : 0;
  
  let message = `[${update.phase}] ${update.currentStep}`;
  
  if (update.total > 0) {
    message += ` (${update.completed}/${update.total} - ${percentage}%)`;
  }
  
  if (update.estimatedTimeRemaining) {
    const minutes = Math.floor(update.estimatedTimeRemaining / 60);
    const seconds = update.estimatedTimeRemaining % 60;
    if (minutes > 0) {
      message += ` - ~${minutes}m ${seconds}s remaining`;
    } else {
      message += ` - ~${seconds}s remaining`;
    }
  }
  
  if (update.details) {
    message += ` - ${update.details}`;
  }
  
  return message;
}

/**
 * Enhanced ToolResult with progress information
 */
export interface ProgressToolResult extends ToolResult {
  progress?: ProgressUpdate;
}

