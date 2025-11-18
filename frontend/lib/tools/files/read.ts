import { useIDEStore } from '@/store/ide-store';
import { ToolResult } from '../types';
import { validateFilePath } from '../validation';
import { executeTool } from '../middleware';
import { withCache } from '../cache';

/**
 * Reads a file's content by path
 */
export async function readFile(path: string): Promise<ToolResult> {
  // Validate path first
  const pathValidation = validateFilePath(path);
  if (!pathValidation.valid) {
    return {
      success: false,
      message: pathValidation.errors.join('; '),
      error: 'Path validation failed',
      warnings: pathValidation.warnings,
    };
  }

  // Use cached version for read operations
  const cachedExecutor = withCache(
    async () => {
      const files = useIDEStore.getState().files;
      const file = files.find((f) => f.path === path);

      if (!file) {
        const filename = path.split('/').pop();
        const fuzzyMatch = files.find((f) => f.name === filename);

        if (fuzzyMatch) {
          return {
            success: true,
            message: `Found file at ${fuzzyMatch.path}`,
            data: {
              path: fuzzyMatch.path,
              content: fuzzyMatch.content,
            },
          };
        }

        return {
          success: false,
          message: `File not found: ${path}`,
          error: `Available files: ${files.map((f) => f.path).join(', ')}`,
        };
      }

      return {
        success: true,
        message: `Read ${path} (${file.content.length} bytes)`,
        data: {
          path: file.path,
          content: file.content,
        },
      };
    },
    5000 // 5 second cache TTL
  );

  return executeTool('read_file', cachedExecutor, { retries: 0 });
}

/**
 * Finds files by name pattern using fuzzy matching
 */
export async function findFile(pattern: string, searchPath?: string): Promise<ToolResult> {
  return executeTool(
    'find_file',
    async () => {
      const files = useIDEStore.getState().files;

      const normalizedPattern = pattern.toLowerCase().replace(/\.(tsx?|jsx?|json|css|md)$/, '');

      let searchFiles = files;
      if (searchPath) {
        searchFiles = files.filter((f) => f.path.startsWith(searchPath));
      }

      const matches = searchFiles
        .map((file) => {
          const fileName = file.name.toLowerCase().replace(/\.(tsx?|jsx?|json|css|md)$/, '');
          const filePath = file.path.toLowerCase();

          let score = 0;
          if (fileName === normalizedPattern) {
            score = 100;
          } else if (fileName.startsWith(normalizedPattern)) {
            score = 80;
          } else if (fileName.includes(normalizedPattern)) {
            score = 60;
          } else if (filePath.includes(normalizedPattern)) {
            score = 40;
          }

          return { file, score };
        })
        .filter((m) => m.score > 0)
        .sort((a, b) => b.score - a.score);

      if (matches.length === 0) {
        return {
          success: false,
          message: `No files found matching "${pattern}"`,
          error: `Searched ${searchFiles.length} files. Try using list_files() to see available files.`,
          data: { matches: [] },
        };
      }

      const matchList = matches.map((m) => ({
        path: m.file.path,
        name: m.file.name,
        type: m.file.type,
        score: m.score,
      }));

      const message = `Found ${matches.length} file(s) matching "${pattern}":\n${matchList
        .map((m) => `  ${m.path} (score: ${m.score})`)
        .join('\n')}`;

      return {
        success: true,
        message,
        data: { matches: matchList },
      };
    },
    {
      retries: 0,
    }
  );
}

/**
 * Searches for a symbol, class, or function name across the entire project
 */
export async function searchSymbol(query: string, scope?: string): Promise<ToolResult> {
  return executeTool(
    'search_symbol',
    async () => {
      const files = useIDEStore.getState().files;

      const normalizedQuery = query.toLowerCase();
      const results: Array<{ path: string; line: number; content: string }> = [];

      let searchFiles = files;
      if (scope) {
        searchFiles = files.filter((f) => f.path.startsWith(scope));
      }

      for (const file of searchFiles) {
        const lines = file.content.split('\n');
        lines.forEach((line, index) => {
          const normalizedLine = line.toLowerCase();
          if (normalizedLine.includes(normalizedQuery)) {
            results.push({
              path: file.path,
              line: index + 1,
              content: line.trim(),
            });
          }
        });
      }

      if (results.length === 0) {
        return {
          success: false,
          message: `No occurrences of "${query}" found`,
          error: `Searched ${searchFiles.length} files`,
          data: { results: [] },
        };
      }

      const message = `Found "${query}" in ${results.length} location(s):\n${results
        .slice(0, 20)
        .map((r) => `  ${r.path}:${r.line} - ${r.content.slice(0, 60)}`)
        .join('\n')}${results.length > 20 ? `\n  ... and ${results.length - 20} more` : ''}`;

      return {
        success: true,
        message,
        data: { results: results.slice(0, 50) }, // Limit to 50 results
      };
    },
    {
      retries: 0,
    }
  );
}

/**
 * Summarizes a file, including language, size, number of classes/functions, and a short snippet
 */
export async function summarizeFile(path: string): Promise<ToolResult> {
  return executeTool(
    'summarize_file',
    async () => {
      const files = useIDEStore.getState().files;
      const file = files.find((f) => f.path === path);

      if (!file) {
        return {
          success: false,
          message: `File not found: ${path}`,
          error: 'Cannot summarize non-existent file',
        };
      }

      const content = file.content;
      const size = content.length;
      const lines = content.split('\n').length;

      // Count classes and functions
      const classMatches = content.match(/class\s+\w+/g) || [];
      const functionMatches = content.match(/(?:def|function|const|export\s+(?:async\s+)?function)\s+\w+/g) || [];

      const snippet = content.split('\n').slice(0, 10).join('\n');

      const summary = {
        path: file.path,
        name: file.name,
        language: file.language,
        size,
        lines,
        classes: classMatches.length,
        functions: functionMatches.length,
        snippet,
      };

      const message = [
        `📄 ${file.name}`,
        `   Path: ${file.path}`,
        `   Language: ${file.language}`,
        `   Size: ${size} bytes (${lines} lines)`,
        `   Classes: ${classMatches.length}`,
        `   Functions: ${functionMatches.length}`,
        '',
        'Preview:',
        snippet,
      ].join('\n');

      return {
        success: true,
        message,
        data: summary,
      };
    },
    {
      retries: 0,
    }
  );
}

