import { useIDEStore } from '@/store/ide-store';
import { ToolResult } from '../types';
import { validateFilePath, validateComponentPath } from '../validation';
import { executeTool } from '../middleware';

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Analyzes file dependencies - shows what a file imports and what files import it
 */
export async function getFileDependencies(filePath: string): Promise<ToolResult> {
  // Pre-flight validation
  const pathValidation = validateFilePath(filePath);
  if (!pathValidation.valid) {
    return {
      success: false,
      message: pathValidation.errors.join('; '),
      error: 'Path validation failed',
      warnings: pathValidation.warnings,
    };
  }

  return executeTool(
    'get_file_dependencies',
    async () => {
      const files = useIDEStore.getState().files;
      const targetFile = files.find((f) => f.path === filePath);

      if (!targetFile) {
        return {
          success: false,
          message: `File not found: ${filePath}`,
          error: 'Cannot analyze dependencies of non-existent file',
        };
      }

      const importRegex =
        /import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+\w+|\w+))*\s+from\s+)?['"]([^'"]+)['"]/g;
      const requireRegex = /require\(['"]([^'"]+)['"]\)/g;

      const imports: string[] = [];
      let match;

      while ((match = importRegex.exec(targetFile.content)) !== null) {
        imports.push(match[1]);
      }
      while ((match = requireRegex.exec(targetFile.content)) !== null) {
        imports.push(match[1]);
      }

      const resolveImport = (importPath: string): string | null => {
        if (importPath.startsWith('./') || importPath.startsWith('../')) {
          const dir = filePath.substring(0, filePath.lastIndexOf('/'));
          let resolved = importPath.substring(0);
          if (importPath.startsWith('./')) {
            resolved = `${dir}/${importPath.slice(2)}`;
          } else {
            let currentDir = dir;
            let remaining = importPath;
            while (remaining.startsWith('../')) {
              currentDir = currentDir.substring(0, currentDir.lastIndexOf('/'));
              remaining = remaining.slice(3);
            }
            resolved = `${currentDir}/${remaining}`;
          }

          for (const ext of ['', '.ts', '.tsx', '.js', '.jsx']) {
            const candidate = resolved + ext;
            if (files.some((f) => f.path === candidate)) {
              return candidate;
            }
          }
        }

        if (importPath.startsWith('/')) {
          if (files.some((f) => f.path === importPath)) {
            return importPath;
          }
          for (const ext of ['.ts', '.tsx', '.js', '.jsx']) {
            const candidate = importPath + ext;
            if (files.some((f) => f.path === candidate)) {
              return candidate;
            }
          }
        }

        if (importPath.startsWith('@/')) {
          const aliasPath = importPath.replace('@/', '/dapp/');
          for (const ext of ['', '.ts', '.tsx', '.js', '.jsx']) {
            const candidate = aliasPath + ext;
            if (files.some((f) => f.path === candidate)) {
              return candidate;
            }
          }
        }

        return null;
      };

      const resolvedImports = imports
        .map((imp) => ({ original: imp, resolved: resolveImport(imp) }))
        .filter((imp) => imp.resolved !== null);

      const fileImportsThis: string[] = [];
      const fileName = filePath.split('/').pop()?.replace(/\.(tsx?|jsx?)$/, '') || '';

      for (const file of files) {
        if (file.path === filePath) continue;

        const importPatterns = [
          new RegExp(
            `from\\s+['"]\\.\\.?/[^'"]*${escapeRegExp(fileName)}['"]`,
            'i',
          ),
          new RegExp(
            `require\\(['"]\\.\\.?/[^'"]*${escapeRegExp(fileName)}['"]\\)`,
            'i',
          ),
          new RegExp(
            `from\\s+['"]@/[^'"]*${escapeRegExp(fileName)}['"]`,
            'i',
          ),
        ];

        if (importPatterns.some((pattern) => pattern.test(file.content))) {
          fileImportsThis.push(file.path);
        }
      }

      const message = [
        `📦 Dependencies for ${filePath}:`,
        '',
        `📥 Imports (${resolvedImports.length}):`,
        ...resolvedImports.map((imp) => `  ${imp.original} → ${imp.resolved}`),
        '',
        `📤 Imported by (${fileImportsThis.length}):`,
        ...fileImportsThis.map((path) => `  ${path}`),
      ].join('\n');

      return {
        success: true,
        message,
        data: {
          imports: resolvedImports.map((imp) => imp.resolved!),
          importedBy: fileImportsThis,
        },
      };
    },
    {
      retries: 0,
    }
  );
}

/**
 * Analyzes a React component file - extracts component name, props, hooks usage, etc.
 */
export async function analyzeComponent(filePath?: string): Promise<ToolResult> {
  if (!filePath) {
    return {
      success: false,
      message: 'Missing required parameter: filePath',
      error: 'Provide the full path to the component, e.g. /dapp/components/Button.tsx',
    };
  }

  // Pre-flight validation
  const pathValidation = validateComponentPath(filePath);
  if (!pathValidation.valid) {
    return {
      success: false,
      message: pathValidation.errors.join('; '),
      error: 'Path validation failed',
      warnings: pathValidation.warnings,
    };
  }

  return executeTool(
    'analyze_component',
    async () => {
      const files = useIDEStore.getState().files;
      const componentFile = files.find((f) => f.path === filePath);

      if (!componentFile) {
        return {
          success: false,
          message: `Component not found: ${filePath}`,
          error: 'Cannot analyze non-existent component',
        };
      }

      if (!componentFile.path.endsWith('.tsx') && !componentFile.path.endsWith('.jsx')) {
        return {
          success: false,
          message: `File is not a component: ${filePath}`,
          error: 'Components must be .tsx or .jsx files',
        };
      }

      const content = componentFile.content;

      const componentNameMatch = content.match(
        /(?:export\s+(?:default\s+)?(?:function|const)\s+(\w+)|export\s+default\s+(\w+)|const\s+(\w+)\s*=\s*(?:\([^)]*\)\s*=>|function))/,
      );
      const componentName =
        componentNameMatch?.[1] ||
        componentNameMatch?.[2] ||
        componentNameMatch?.[3] ||
        filePath.split('/').pop()?.replace(/\.(tsx?|jsx?)$/, '') ||
        'Unknown';

      const hasUseClient = content.includes("'use client'") || content.includes('"use client"');

      const propsMatch = content.match(/(?:interface|type)\s+(\w+Props)\s*\{([^}]+)\}/);
      const props = propsMatch
        ? propsMatch[2].split('\n').map((l) => l.trim()).filter(Boolean)
        : [];

      const exports: string[] = [];
      const exportRegex = /export\s+(?:default\s+)?(?:function|const|class)\s+(\w+)/g;
      let exportMatch;
      while ((exportMatch = exportRegex.exec(content)) !== null) {
        exports.push(exportMatch[1]);
      }

      const usesHooks = /use(State|Effect|Context|Reducer|Ref|Memo|Callback)/.test(content);
      const hasEventHandlers = /on(Click|Change|Submit|KeyDown|MouseEnter|Focus|Blur)/.test(content);

      const usedIn: string[] = [];
      const componentImportPattern = new RegExp(
        `import\\s+.*\\b${escapeRegExp(componentName)}\\b.*from\\s+['"][^'"]*${escapeRegExp(
          filePath.split('/').pop()?.replace(/\.(tsx?|jsx?)$/, '') || ''
        )}['"]`,
        'i',
      );

      for (const file of files) {
        if (file.path === filePath) continue;
        if (componentImportPattern.test(file.content) || file.content.includes(componentName)) {
          usedIn.push(file.path);
        }
      }

      const analysis = {
        path: filePath,
        name: componentName,
        hasUseClient,
        needsUseClient: (usesHooks || hasEventHandlers) && !hasUseClient,
        usesHooks,
        hasEventHandlers,
        props: props.length > 0 ? props : null,
        exports,
        usedIn,
        isUsed: usedIn.length > 0,
        size: content.length,
      };

      const warnings: string[] = [];
      if (analysis.needsUseClient) {
        warnings.push('⚠️ Component needs "use client" directive (uses hooks or event handlers)');
      }
      if (!analysis.isUsed) {
        warnings.push('⚠️ Component is not used anywhere');
      }

      const message = [
        `🔍 Component Analysis: ${filePath}`,
        '',
        `📝 Name: ${componentName}`,
        `📦 Size: ${content.length} bytes`,
        `🎣 Uses hooks: ${usesHooks ? 'Yes' : 'No'}`,
        `🖱️ Has event handlers: ${hasEventHandlers ? 'Yes' : 'No'}`,
        `⚛️ "use client" directive: ${hasUseClient ? 'Present' : 'Missing'}`,
        props.length > 0 ? `📋 Props: ${props.length} properties` : '📋 Props: None',
        exports.length > 0 ? `📤 Exports: ${exports.join(', ')}` : '📤 Exports: default only',
        usedIn.length > 0
          ? `✅ Used in ${usedIn.length} file(s):\n  ${usedIn.join('\n  ')}`
          : '⚠️ Not used anywhere',
      ]
        .filter(Boolean)
        .join('\n');

      return {
        success: true,
        message,
        data: analysis,
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    },
    {
      retries: 0,
    }
  );
}

