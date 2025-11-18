import { useIDEStore } from '@/store/ide-store';
import type { File } from '@/store/ide-store';
import { ToolResult } from '../types';
import { validateFilePath, validateFileContent } from '../validation';
import { executeTool } from '../middleware';
import { toolCache } from '../cache';
import { autoSyncIfNeeded, formatAutoSyncMessage } from './sync-helpers';

/**
 * Creates or updates a file
 */
export async function writeFile(path: string, content: string): Promise<ToolResult> {
  // Pre-flight validation
  const pathValidation = validateFilePath(path);
  if (!pathValidation.valid) {
    return {
      success: false,
      message: pathValidation.errors.join('; '),
      error: 'Path validation failed',
      warnings: pathValidation.warnings,
    };
  }

  const contentValidation = validateFileContent(content);
  if (!contentValidation.valid) {
    return {
      success: false,
      message: contentValidation.errors.join('; '),
      error: 'Content validation failed',
      warnings: contentValidation.warnings,
    };
  }

  if (content === undefined || content === null) {
    return {
      success: false,
      message: `❌ Missing required parameter: content`,
      error: 'The content parameter is required and must contain the file contents',
    };
  }

  return executeTool(
    'write_file',
    async () => {
      const { files, updateFile, addFile } = useIDEStore.getState();

      if (path.endsWith('__init__.py')) {
        return {
          success: false,
          message: `❌ Cannot create __init__.py files`,
          error:
            '__init__.py files are not needed for Hathor blueprints. Blueprint files should be standalone.',
        };
      }

      const validPrefixes = ['/blueprints/', '/contracts/', '/tests/', '/dapp/'];
      if (!validPrefixes.some((prefix) => path.startsWith(prefix))) {
        return {
          success: false,
          message: `Invalid path: ${path}`,
          error: `Files must start with: ${validPrefixes.join(', ')}`,
        };
      }

      const existingFile = files.find((f) => f.path === path);

      if (existingFile) {
        updateFile(existingFile.id, content);

        // Invalidate cache for file-dependent tools
        toolCache.invalidateOnFileChange(path);

        const autoSyncResult = await autoSyncIfNeeded(path);

        return {
          success: true,
          message: formatAutoSyncMessage(`✅ Updated ${path}`, autoSyncResult),
          data: { path, action: 'updated', autoDeploy: autoSyncResult ?? undefined },
        };
      }

      const fileName = path.split('/').pop() || 'untitled';
      const fileType = path.startsWith('/blueprints/') || path.startsWith('/contracts/')
        ? 'contract'
        : path.startsWith('/tests/')
        ? 'test'
        : 'component';

      const newFile: Omit<File, 'id'> = {
        name: fileName,
        path,
        content,
        type: fileType,
        language: path.endsWith('.py')
          ? 'python'
          : path.endsWith('.ts')
          ? 'typescript'
          : path.endsWith('.tsx')
          ? 'typescriptreact'
          : 'json',
      };

      addFile(newFile);

      // Invalidate cache for file-dependent tools
      toolCache.invalidateOnFileChange(path);

      const autoSyncResult = await autoSyncIfNeeded(path);

      return {
        success: true,
        message: formatAutoSyncMessage(`✅ Created ${path}`, autoSyncResult),
        data: { path, action: 'created', autoDeploy: autoSyncResult ?? undefined },
      };
    },
    {
      retries: 0, // File writes shouldn't be retried automatically
    }
  );
}

/**
 * Deletes a file by path
 */
export async function deleteFile(path: string): Promise<ToolResult> {
  // Pre-flight validation
  const pathValidation = validateFilePath(path);
  if (!pathValidation.valid) {
    return {
      success: false,
      message: pathValidation.errors.join('; '),
      error: 'Path validation failed',
      warnings: pathValidation.warnings,
    };
  }

  return executeTool(
    'delete_file',
    async () => {
      const { files, deleteFile: deleteFileFromStore } = useIDEStore.getState();
      const file = files.find((f) => f.path === path);

      if (!file) {
        return {
          success: false,
          message: `❌ File not found: ${path}`,
          error: `Cannot delete non-existent file. Available files: ${files.map((f) => f.path).join(', ')}`,
        };
      }

      deleteFileFromStore(file.id);

      // Invalidate cache for file-dependent tools
      toolCache.invalidateOnFileChange(path);

      return {
        success: true,
        message: `✅ Deleted ${path}`,
        data: { path, action: 'deleted' },
      };
    },
    {
      retries: 0,
    }
  );
}

