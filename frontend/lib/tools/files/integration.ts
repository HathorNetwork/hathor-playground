import { useIDEStore } from '@/store/ide-store';
import { ToolResult } from '../types';
import { validateComponentPath } from '../validation';
import { executeTool } from '../middleware';
import { toolCache } from '../cache';
import { autoSyncIfNeeded, formatAutoSyncMessage } from './sync-helpers';

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Automatically integrates a component into a page/route
 */
export async function integrateComponent(componentPath?: string, targetPage?: string): Promise<ToolResult> {
  return executeTool(
    'integrate_component',
    async () => {
      const files = useIDEStore.getState().files;
      const { updateFile } = useIDEStore.getState();

      // If componentPath is not provided, try to auto-detect recently created components
      if (!componentPath || componentPath.trim() === '') {
        // Find all component files in /dapp/components/
        const componentFiles = files.filter(
          (f) =>
            f.path.includes('/dapp/') &&
            f.path.includes('/components/') &&
            (f.path.endsWith('.tsx') || f.path.endsWith('.jsx')),
        );

        if (componentFiles.length === 0) {
          return {
            success: false,
            message: 'No component path provided and no components found in /dapp/components/',
            error:
              'Please provide componentPath parameter. Example: integrate_component({ componentPath: "/dapp/components/SimpleCounter.tsx" })',
          };
        }

        // If only one component exists, use it
        if (componentFiles.length === 1) {
          componentPath = componentFiles[0].path;
        } else {
          // Multiple components - suggest the most recently created one or list options
          const componentList = componentFiles
            .map((f) => `  - ${f.path}`)
            .slice(0, 5)
            .join('\n');
          return {
            success: false,
            message: `Multiple components found. Please specify componentPath:\n${componentList}`,
            error:
              'componentPath parameter is required when multiple components exist. Example: integrate_component({ componentPath: "/dapp/components/SimpleCounter.tsx" })',
          };
        }
      }

      // At this point, componentPath should be defined
      if (!componentPath) {
        return {
          success: false,
          message: 'Component path is required',
          error: 'Please provide componentPath parameter or ensure a component exists in /dapp/components/',
        };
      }

      // TypeScript type guard: ensure componentPath is a string
      const resolvedComponentPath: string = componentPath;

      // Validate component path
      const pathValidation = validateComponentPath(resolvedComponentPath);
      if (!pathValidation.valid) {
        return {
          success: false,
          message: pathValidation.errors.join('; '),
          error: 'Component path validation failed',
          warnings: pathValidation.warnings,
        };
      }

      const componentFile = files.find((f) => f.path === resolvedComponentPath);
      if (!componentFile) {
        // Try to find similar paths
        const similarFiles = files
          .filter((f) => f.path.includes(resolvedComponentPath.split('/').pop() || ''))
          .slice(0, 3)
          .map((f) => f.path);

        const suggestions = similarFiles.length > 0 ? `\n\nDid you mean one of these?\n${similarFiles.map((p) => `  - ${p}`).join('\n')}` : '';

        return {
          success: false,
          message: `Component not found: ${resolvedComponentPath}${suggestions}`,
          error: 'Cannot integrate non-existent component. Please check the file path.',
        };
      }

      const componentNameMatch = componentFile.content.match(
        /(?:export\s+(?:default\s+)?(?:function|const)\s+(\w+)|export\s+default\s+(\w+)|const\s+(\w+)\s*=\s*(?:\([^)]*\)\s*=>|function))/,
      );
      const componentName =
        componentNameMatch?.[1] ||
        componentNameMatch?.[2] ||
        componentNameMatch?.[3] ||
        resolvedComponentPath.split('/').pop()?.replace(/\.(tsx?|jsx?)$/, '') ||
        'Component';

      let targetPagePath = targetPage;
      if (!targetPagePath) {
        const dappPages = files.filter(
          (f) =>
            f.path.includes('/dapp/') && f.path.includes('/app/') && f.path.endsWith('page.tsx'),
        );

        if (dappPages.length > 0) {
          targetPagePath =
            dappPages.find((p) => p.path.includes('hathor-dapp/app/page.tsx'))?.path || dappPages[0].path;
        } else {
          return {
            success: false,
            message: `No target page found`,
            error: 'Could not find app/page.tsx. Please specify targetPage parameter.',
          };
        }
      }

      const targetPageFile = files.find((f) => f.path === targetPagePath);
      if (!targetPageFile) {
        return {
          success: false,
          message: `Target page not found: ${targetPagePath}`,
          error: 'Cannot integrate component into non-existent page',
        };
      }

      const componentDir = resolvedComponentPath.substring(0, resolvedComponentPath.lastIndexOf('/'));
      const targetDir = targetPagePath.substring(0, targetPagePath.lastIndexOf('/'));

      const getRelativePath = (from: string, to: string): string => {
        const fromParts = from.split('/').filter((p) => p);
        const toParts = to.split('/').filter((p) => p);

        let i = 0;
        while (i < fromParts.length && i < toParts.length && fromParts[i] === toParts[i]) {
          i++;
        }

        const upLevels = fromParts.length - i - 1;
        const downPath = toParts.slice(i).join('/');
        const componentFileName = resolvedComponentPath.split('/').pop()?.replace(/\.(tsx?|jsx?)$/, '') || '';

        if (upLevels === 0) {
          return `./${downPath}/${componentFileName}`;
        }

        const ups = '../'.repeat(upLevels);
        return `${ups}${downPath}/${componentFileName}`;
      };

      let importPath = getRelativePath(targetDir, componentDir);

      if (resolvedComponentPath.startsWith('/dapp/')) {
        importPath = resolvedComponentPath.replace('/dapp/', '@/').replace(/\.(tsx?|jsx?)$/, '');
      }

      const importPattern = new RegExp(
        `import\\s+.*\\b${escapeRegExp(componentName)}\\b.*from\\s+['"]${escapeRegExp(importPath)}['"]`,
        'i',
      );
      const hasImport = importPattern.test(targetPageFile.content);

      const isUsed =
        targetPageFile.content.includes(`<${componentName}`) ||
        targetPageFile.content.includes(`<${componentName} `);

      let updatedContent = targetPageFile.content;
      const changes: string[] = [];

      if (!hasImport) {
        const importRegex = /^import\s+.*from\s+['"][^'"]+['"];?$/gm;
        const imports = targetPageFile.content.match(importRegex) || [];

        if (imports.length > 0) {
          const lastImport = imports[imports.length - 1];
          const lastImportIndex = targetPageFile.content.lastIndexOf(lastImport);
          const insertIndex = lastImportIndex + lastImport.length;

          updatedContent =
            updatedContent.substring(0, insertIndex) +
            `\nimport ${componentName} from '${importPath}';` +
            updatedContent.substring(insertIndex);
        } else {
          const useClientMatch = updatedContent.match(/^['"]use\s+client['"];?\n?/m);
          if (useClientMatch) {
            const insertIndex = useClientMatch.index! + useClientMatch[0].length;
            updatedContent =
              updatedContent.substring(0, insertIndex) +
              `import ${componentName} from '${importPath}';\n` +
              updatedContent.substring(insertIndex);
          } else {
            updatedContent = `import ${componentName} from '${importPath}';\n${updatedContent}`;
          }
        }
        changes.push(`Added import: import ${componentName} from '${importPath}'`);
      }

      if (!isUsed) {
        const returnMatch = updatedContent.match(/(return\s*\([^)]*)(<[^>]+>)/);
        if (returnMatch) {
          const insertIndex = returnMatch.index! + returnMatch[1].length + returnMatch[2].length;
          updatedContent =
            updatedContent.substring(0, insertIndex) +
            `\n        <${componentName} />` +
            updatedContent.substring(insertIndex);
          changes.push(`Added component usage: <${componentName} />`);
        } else {
          const closingBraceMatch = updatedContent.match(/\n\s*\}\s*$/);
          if (closingBraceMatch) {
            const insertIndex = closingBraceMatch.index!;
            updatedContent =
              updatedContent.substring(0, insertIndex) +
              `\n  return <${componentName} />;\n` +
              updatedContent.substring(insertIndex);
            changes.push('Added component return statement');
          }
        }
      }

      updateFile(targetPageFile.id, updatedContent);

      // Invalidate cache for file-dependent tools
      toolCache.invalidateOnFileChange(targetPagePath);

      const autoSyncResult = await autoSyncIfNeeded(targetPagePath);

      const baseMessage = [
        `✅ Integrated ${componentName} into ${targetPagePath}`,
        '',
        ...changes,
        '',
        `📝 Component: ${resolvedComponentPath}`,
        `📄 Target page: ${targetPagePath}`,
        `🔗 Import path: ${importPath}`,
      ].join('\n');

      const message = formatAutoSyncMessage(baseMessage, autoSyncResult);

      return {
        success: true,
        message,
        data: {
          componentPath: resolvedComponentPath,
          targetPage: targetPagePath,
          componentName,
          importPath,
          changes,
          autoDeploy: autoSyncResult ?? undefined,
        },
      };
    },
    {
      retries: 0,
    }
  );
}

