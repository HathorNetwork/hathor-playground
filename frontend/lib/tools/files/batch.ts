/**
 * Batch file operations for improved performance
 * 
 * Allows writing/reading multiple files in a single tool call,
 * with progress tracking and graceful error handling.
 */

import { ToolResult } from '../types';
import { validateFilePath, validateFileContent } from '../validation';
import { executeTool } from '../middleware';
import { createProgressTracker, formatProgressMessage, type ProgressUpdate } from '../progress';
import { writeFile } from './write';
import { readFile } from './read';
import { toolCache } from '../cache';

export interface BatchFileOperation {
  path: string;
  content?: string; // Required for writes, optional for reads
}

/**
 * Writes multiple files in a single operation
 * 
 * Benefits:
 * - Fewer tool calls (1 instead of N)
 * - Better progress tracking
 * - Single auto-sync trigger (debounced)
 * - Partial success handling
 */
export async function batchWriteFiles(
  files: BatchFileOperation[],
  onProgress?: (update: ProgressUpdate) => void
): Promise<ToolResult> {
  // Pre-flight validation
  if (!Array.isArray(files) || files.length === 0) {
    return {
      success: false,
      message: '❌ No files provided',
      error: 'Files array is required and must not be empty',
    };
  }

  if (files.length > 50) {
    return {
      success: false,
      message: '❌ Too many files',
      error: 'Maximum 50 files per batch operation',
      warnings: ['Consider splitting into smaller batches'],
    };
  }

  // Validate all files first
  const validationErrors: string[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    
    if (!file.path) {
      validationErrors.push(`File ${i + 1}: path is required`);
      continue;
    }

    if (!file.content) {
      validationErrors.push(`File ${i + 1} (${file.path}): content is required`);
      continue;
    }

    const pathValidation = validateFilePath(file.path);
    if (!pathValidation.valid) {
      validationErrors.push(`File ${i + 1} (${file.path}): ${pathValidation.errors.join('; ')}`);
      continue;
    }

    const contentValidation = validateFileContent(file.content, undefined, file.path);
    if (!contentValidation.valid) {
      validationErrors.push(`File ${i + 1} (${file.path}): ${contentValidation.errors.join('; ')}`);
      continue;
    }
  }

  if (validationErrors.length > 0) {
    return {
      success: false,
      message: `❌ Validation failed for ${validationErrors.length} file(s)`,
      error: validationErrors.join('; '),
      warnings: ['Fix validation errors before retrying'],
    };
  }

  return executeTool(
    'batch_write_files',
    async () => {
      const progressTracker = createProgressTracker('executing', files.length, 'Starting batch write...');
      
      if (onProgress) {
        progressTracker.onProgress(onProgress);
      }

      const results: Array<{ path: string; success: boolean; message: string; error?: string }> = [];
      let successCount = 0;
      let failureCount = 0;

      // Write files sequentially (to avoid race conditions with auto-sync)
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const fileNum = i + 1;

        progressTracker.updateStep(
          `Writing ${file.path}...`,
          `File ${fileNum}/${files.length}`
        );

        try {
          const result = await writeFile(file.path, file.content!);
          
          results.push({
            path: file.path,
            success: result.success,
            message: result.message || (result.success ? '✅ Written' : '❌ Failed'),
            error: result.error,
          });

          if (result.success) {
            successCount++;
          } else {
            failureCount++;
          }

          progressTracker.increment(
            result.success ? `✅ ${file.path}` : `❌ ${file.path}`,
            result.message
          );
        } catch (error: any) {
          failureCount++;
          results.push({
            path: file.path,
            success: false,
            message: `❌ Error: ${error?.message || String(error)}`,
            error: error?.message || String(error),
          });

          progressTracker.increment(
            `❌ ${file.path}`,
            error?.message || 'Unknown error'
          );
        }
      }

      // Invalidate cache for all changed files
      files.forEach(file => {
        toolCache.invalidateOnFileChange(file.path);
      });

      progressTracker.complete('Batch write complete');

      // Determine overall success
      const allSucceeded = failureCount === 0;
      const allFailed = successCount === 0;
      const partialSuccess = successCount > 0 && failureCount > 0;

      let message: string;
      if (allSucceeded) {
        message = `✅ Successfully wrote ${successCount} file(s)`;
      } else if (allFailed) {
        message = `❌ Failed to write all ${failureCount} file(s)`;
      } else {
        message = `⚠️ Partial success: ${successCount} succeeded, ${failureCount} failed`;
      }

      return {
        success: !allFailed, // Consider it successful if at least one file was written
        message,
        data: {
          total: files.length,
          succeeded: successCount,
          failed: failureCount,
          results,
        },
        warnings: partialSuccess ? [
          `${failureCount} file(s) failed. Check the results array for details.`,
        ] : undefined,
      };
    },
    {
      retries: 0, // Don't retry batch operations automatically
      timeout: 60000, // 60 seconds for batch operations
    }
  );
}

/**
 * Reads multiple files in a single operation
 * 
 * Benefits:
 * - Fewer tool calls (1 instead of N)
 * - Better progress tracking
 * - Can use caching for read operations
 */
export async function batchReadFiles(
  paths: string[],
  onProgress?: (update: ProgressUpdate) => void
): Promise<ToolResult> {
  // Pre-flight validation
  if (!Array.isArray(paths) || paths.length === 0) {
    return {
      success: false,
      message: '❌ No file paths provided',
      error: 'Paths array is required and must not be empty',
    };
  }

  if (paths.length > 100) {
    return {
      success: false,
      message: '❌ Too many files',
      error: 'Maximum 100 files per batch read operation',
      warnings: ['Consider splitting into smaller batches'],
    };
  }

  // Validate all paths first
  const validationErrors: string[] = [];
  for (let i = 0; i < paths.length; i++) {
    const path = paths[i];
    
    if (!path) {
      validationErrors.push(`Path ${i + 1}: path is required`);
      continue;
    }

    const pathValidation = validateFilePath(path);
    if (!pathValidation.valid) {
      validationErrors.push(`Path ${i + 1} (${path}): ${pathValidation.errors.join('; ')}`);
    }
  }

  if (validationErrors.length > 0) {
    return {
      success: false,
      message: `❌ Validation failed for ${validationErrors.length} path(s)`,
      error: validationErrors.join('; '),
      warnings: ['Fix validation errors before retrying'],
    };
  }

  return executeTool(
    'batch_read_files',
    async () => {
      const progressTracker = createProgressTracker('executing', paths.length, 'Starting batch read...');
      
      if (onProgress) {
        progressTracker.onProgress(onProgress);
      }

      const results: Array<{ path: string; success: boolean; content?: string; error?: string }> = [];
      let successCount = 0;
      let failureCount = 0;

      // Read files sequentially (to avoid overwhelming the store)
      for (let i = 0; i < paths.length; i++) {
        const path = paths[i];
        const fileNum = i + 1;

        progressTracker.updateStep(
          `Reading ${path}...`,
          `File ${fileNum}/${paths.length}`
        );

        try {
          const result = await readFile(path);
          
          results.push({
            path,
            success: result.success,
            content: result.data?.content as string | undefined,
            error: result.error,
          });

          if (result.success) {
            successCount++;
          } else {
            failureCount++;
          }

          progressTracker.increment(
            result.success ? `✅ ${path}` : `❌ ${path}`,
            result.message
          );
        } catch (error: any) {
          failureCount++;
          results.push({
            path,
            success: false,
            error: error?.message || String(error),
          });

          progressTracker.increment(
            `❌ ${path}`,
            error?.message || 'Unknown error'
          );
        }
      }

      progressTracker.complete('Batch read complete');

      // Determine overall success
      const allSucceeded = failureCount === 0;
      const allFailed = successCount === 0;
      const partialSuccess = successCount > 0 && failureCount > 0;

      let message: string;
      if (allSucceeded) {
        message = `✅ Successfully read ${successCount} file(s)`;
      } else if (allFailed) {
        message = `❌ Failed to read all ${failureCount} file(s)`;
      } else {
        message = `⚠️ Partial success: ${successCount} succeeded, ${failureCount} failed`;
      }

      return {
        success: !allFailed, // Consider it successful if at least one file was read
        message,
        data: {
          total: paths.length,
          succeeded: successCount,
          failed: failureCount,
          results,
        },
        warnings: partialSuccess ? [
          `${failureCount} file(s) failed. Check the results array for details.`,
        ] : undefined,
      };
    },
    {
      retries: 0,
      timeout: 30000, // 30 seconds for batch reads
    }
  );
}

