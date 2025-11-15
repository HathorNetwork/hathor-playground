import { useIDEStore } from '@/store/ide-store';
import type { File } from '@/store/ide-store';

import { ToolResult } from './types';
import { beamTools } from './beam';
import { syncDApp } from './sync';

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function listFiles(path: string = '/'): Promise<ToolResult> {
  try {
    const files = useIDEStore.getState().files;

    const filteredFiles = files
      .filter((f) => f.path.startsWith(path))
      .map((f) => ({
        path: f.path,
        name: f.name,
        type: f.type,
        size: f.content.length,
      }));

    const fileList = filteredFiles
      .map((f) => `  ${f.path} (${f.type}, ${f.size} bytes)`)
      .join('\n');

    const message =
      filteredFiles.length > 0
        ? `Found ${filteredFiles.length} files in ${path}:\n${fileList}`
        : `No files found in ${path}`;

    return {
      success: true,
      message,
      data: filteredFiles,
    };
  } catch (error) {
    return {
      success: false,
      message: 'Failed to list files',
      error: String(error),
    };
  }
}

async function readFile(path: string): Promise<ToolResult> {
  try {
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
  } catch (error) {
    return {
      success: false,
      message: `Failed to read file: ${path}`,
      error: String(error),
    };
  }
}

async function writeFile(path: string, content: string): Promise<ToolResult> {
  try {
    if (!path || path === 'undefined') {
      return {
        success: false,
        message: `❌ Missing required parameter: path`,
        error:
          'The path parameter is required and must be a valid file path (e.g., /contracts/MyContract.py)',
      };
    }

    if (content === undefined || content === null) {
      return {
        success: false,
        message: `❌ Missing required parameter: content`,
        error: 'The content parameter is required and must contain the file contents',
      };
    }

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

    const autoSyncResult = await autoSyncIfNeeded(path);

    return {
      success: true,
      message: formatAutoSyncMessage(`✅ Created ${path}`, autoSyncResult),
      data: { path, action: 'created', autoDeploy: autoSyncResult ?? undefined },
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to write file: ${path}`,
      error: String(error),
    };
  }
}

let queuedAutoSync: Promise<ToolResult> | null = null;
let resolveQueuedAutoSync: ((value: ToolResult) => void) | null = null;
const AUTO_SYNC_DEBOUNCE_MS = 5000;
let autoSyncTimer: ReturnType<typeof setTimeout> | null = null;

async function autoSyncIfNeeded(path: string): Promise<ToolResult | null> {
  if (!path.startsWith('/dapp/')) {
    return null;
  }

  const { activeProjectId } = useIDEStore.getState();
  if (!activeProjectId) {
    return {
      success: false,
      message: '⚠️ Auto-deploy skipped: no active project selected',
      error: 'Auto-deploy skipped',
    };
  }

  if (!queuedAutoSync) {
    queuedAutoSync = new Promise<ToolResult>((resolve) => {
      resolveQueuedAutoSync = resolve;
    });
  }

  if (autoSyncTimer) {
    clearTimeout(autoSyncTimer);
  }

  autoSyncTimer = setTimeout(() => {
    autoSyncTimer = null;
    performAutoSync()
      .then((result) => resolveQueuedAutoSync?.(result))
      .catch((error: any) =>
        resolveQueuedAutoSync?.({
          success: false,
          message: error?.message || 'Auto-sync failed',
          error: String(error),
        }),
      )
      .finally(() => {
        queuedAutoSync = null;
        resolveQueuedAutoSync = null;
      });
  }, AUTO_SYNC_DEBOUNCE_MS);

  return queuedAutoSync;
}

async function performAutoSync(): Promise<ToolResult> {
  try {
    const syncResult = await syncDApp('ide-to-sandbox');
    if (syncResult.success) {
      return {
        ...syncResult,
        data: {
          ...syncResult.data,
          autoSyncType: 'sync',
        },
      };
    }

    const fallback = await beamTools.deployDApp();
    return {
      ...fallback,
      message: `Auto-sync failed, fallback deployment triggered.\n${fallback.message}`,
      data: {
        ...fallback.data,
        autoSyncType: 'deploy-fallback',
      },
    };
  } catch (error: any) {
    return {
      success: false,
      message: error?.message || 'Auto-sync failed',
      error: String(error),
    };
  }
}

function formatAutoSyncMessage(baseMessage: string, autoSyncResult: ToolResult | null): string {
  if (!autoSyncResult) {
    return baseMessage;
  }

  if (autoSyncResult.success) {
    const url =
      autoSyncResult.data?.url ||
      autoSyncResult.data?.devServerResult?.data?.url ||
      autoSyncResult.data?.status?.url;

    const isFallback =
      autoSyncResult.data && 'autoSyncType' in autoSyncResult.data
        ? (autoSyncResult.data as any).autoSyncType === 'deploy-fallback'
        : false;

    const suffix = isFallback
      ? url
        ? `\n🚀 Auto-deployed to BEAM sandbox (${url})`
        : '\n🚀 Auto-deployed to BEAM sandbox'
      : '\n🔄 Auto-synced to BEAM sandbox';

    return `${baseMessage}${suffix}`;
  }

  return `${baseMessage}\n⚠️ Auto-sync error: ${autoSyncResult.message}`;
}

async function deleteFile(path: string): Promise<ToolResult> {
  try {
    const { files, deleteFile } = useIDEStore.getState();
    const file = files.find((f) => f.path === path);

    if (!file) {
      return {
        success: false,
        message: `❌ File not found: ${path}`,
        error: `Cannot delete non-existent file. Available files: ${files.map((f) => f.path).join(', ')}`,
      };
    }

    deleteFile(file.id);

    return {
      success: true,
      message: `✅ Deleted ${path}`,
      data: { path, action: 'deleted' },
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to delete file: ${path}`,
      error: String(error),
    };
  }
}

async function getProjectStructure(
  filterByType?: 'blueprints' | 'tests' | 'dapp' | 'components' | 'pages' | 'configs',
): Promise<ToolResult> {
  try {
    const files = useIDEStore.getState().files;

    const buildTree = (fileList: typeof files) => {
      const tree: Record<string, any> = {};

      for (const file of fileList) {
        const parts = file.path.split('/').filter((p) => p);
        let current = tree;

        for (let i = 0; i < parts.length; i++) {
          const part = parts[i];
          const isLast = i === parts.length - 1;

          if (!current[part]) {
            current[part] = isLast
              ? { type: 'file', path: file.path, size: file.content.length, language: file.language }
              : { type: 'directory', children: {} };
          }

          if (!isLast) {
            current = current[part].children;
          }
        }
      }

      return tree;
    };

    let filteredFiles = files;
    if (filterByType) {
      switch (filterByType) {
        case 'blueprints':
          filteredFiles = files.filter(
            (f) => f.path.startsWith('/blueprints/') || f.path.startsWith('/contracts/'),
          );
          break;
        case 'tests':
          filteredFiles = files.filter((f) => f.path.startsWith('/tests/'));
          break;
        case 'dapp':
          filteredFiles = files.filter((f) => f.path.startsWith('/dapp/'));
          break;
        case 'components':
          filteredFiles = files.filter((f) => f.path.includes('/components/') && f.path.endsWith('.tsx'));
          break;
        case 'pages':
          filteredFiles = files.filter(
            (f) =>
              f.path.includes('/app/') &&
              (f.path.endsWith('page.tsx') || f.path.endsWith('layout.tsx')),
          );
          break;
        case 'configs':
          filteredFiles = files.filter(
            (f) =>
              f.path.endsWith('.json') ||
              f.path.endsWith('.config.js') ||
              f.path.endsWith('tsconfig.json') ||
              f.path.endsWith('package.json'),
          );
          break;
      }
    }

    const blueprints = files.filter(
      (f) => f.path.startsWith('/blueprints/') || f.path.startsWith('/contracts/'),
    );
    const tests = files.filter((f) => f.path.startsWith('/tests/'));
    const dapps = files.filter((f) => f.path.startsWith('/dapp/'));
    const components = files.filter(
      (f) => f.path.includes('/components/') && f.path.endsWith('.tsx'),
    );
    const pages = files.filter(
      (f) => f.path.includes('/app/') && (f.path.endsWith('page.tsx') || f.path.endsWith('layout.tsx')),
    );

    const tree = buildTree(filteredFiles);

    const structure = {
      tree,
      blueprints: blueprints.map((f) => ({ path: f.path, size: f.content.length, type: f.type })),
      tests: tests.map((f) => ({ path: f.path, size: f.content.length, type: f.type })),
      dapps: dapps.map((f) => ({ path: f.path, size: f.content.length, type: f.type })),
      components: components.map((f) => ({ path: f.path, size: f.content.length, type: f.type })),
      pages: pages.map((f) => ({ path: f.path, size: f.content.length, type: f.type })),
      total: files.length,
    };

    const message = [
      '📁 Project Structure:',
      '',
      `📜 Blueprints (${blueprints.length}):`,
      ...blueprints.map((f) => `  ${f.path} (${f.content.length} bytes)`),
      '',
      `🧪 Tests (${tests.length}):`,
      ...tests.map((f) => `  ${f.path} (${f.content.length} bytes)`),
      '',
      `🌐 dApp Files (${dapps.length}):`,
      ...dapps.map((f) => `  ${f.path} (${f.content.length} bytes)`),
      '',
      `⚛️ Components (${components.length}):`,
      ...components.map((f) => `  ${f.path} (${f.content.length} bytes)`),
      '',
      `📄 Pages (${pages.length}):`,
      ...pages.map((f) => `  ${f.path} (${f.content.length} bytes)`),
    ].join('\n');

    return {
      success: true,
      message,
      data: structure,
    };
  } catch (error) {
    return {
      success: false,
      message: 'Failed to get project structure',
      error: String(error),
    };
  }
}

async function findFile(pattern: string, searchPath?: string): Promise<ToolResult> {
  try {
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
      size: m.file.content.length,
      score: m.score,
    }));

    const message = [
      `🔍 Found ${matches.length} file(s) matching "${pattern}":`,
      '',
      ...matches.map(
        (m) =>
          `  ${m.file.path} (${m.file.type}, ${m.file.content.length} bytes, match score: ${m.score})`,
      ),
    ].join('\n');

    return {
      success: true,
      message,
      data: { matches: matchList },
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to find files matching "${pattern}"`,
      error: String(error),
    };
  }
}

async function getFileDependencies(filePath: string): Promise<ToolResult> {
  try {
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
          `from\\s+['"]\\.\\.?/[^'"]*${fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`,
          'i',
        ),
        new RegExp(
          `require\\(['"]\\.\\.?/[^'"]*${fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]\\)`,
          'i',
        ),
        new RegExp(
          `from\\s+['"]@/[^'"]*${fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`,
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
  } catch (error) {
    return {
      success: false,
      message: `Failed to analyze dependencies for ${filePath}`,
      error: String(error),
    };
  }
}

async function analyzeComponent(filePath?: string): Promise<ToolResult> {
  try {
    if (!filePath) {
      return {
        success: false,
        message: 'Missing required parameter: filePath',
        error: 'Provide the full path to the component, e.g. /dapp/components/Button.tsx',
      };
    }

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
      `import\\s+.*\\b${componentName}\\b.*from\\s+['"][^'"]*${filePath
        .split('/')
        .pop()
        ?.replace(/\.(tsx?|jsx?)$/, '')}['"]`,
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

    const message = [
      `🔍 Component Analysis: ${filePath}`,
      '',
      `📝 Name: ${componentName}`,
      `📦 Size: ${content.length} bytes`,
      `🎣 Uses hooks: ${usesHooks ? 'Yes' : 'No'}`,
      `🖱️ Has event handlers: ${hasEventHandlers ? 'Yes' : 'No'}`,
      `⚛️ "use client" directive: ${hasUseClient ? 'Present' : 'Missing'}`,
      hasUseClient === false && (usesHooks || hasEventHandlers)
        ? `⚠️ WARNING: Component needs "use client" directive!`
        : '',
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
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to analyze component: ${filePath}`,
      error: String(error),
    };
  }
}

async function integrateComponent(componentPath: string, targetPage?: string): Promise<ToolResult> {
  try {
    const files = useIDEStore.getState().files;
    const { updateFile } = useIDEStore.getState();

    const componentFile = files.find((f) => f.path === componentPath);
    if (!componentFile) {
      return {
        success: false,
        message: `Component not found: ${componentPath}`,
        error: 'Cannot integrate non-existent component',
      };
    }

    const componentNameMatch = componentFile.content.match(
      /(?:export\s+(?:default\s+)?(?:function|const)\s+(\w+)|export\s+default\s+(\w+)|const\s+(\w+)\s*=\s*(?:\([^)]*\)\s*=>|function))/,
    );
    const componentName =
      componentNameMatch?.[1] ||
      componentNameMatch?.[2] ||
      componentNameMatch?.[3] ||
      componentPath.split('/').pop()?.replace(/\.(tsx?|jsx?)$/, '') ||
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

    const componentDir = componentPath.substring(0, componentPath.lastIndexOf('/'));
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
      const componentFileName = componentPath.split('/').pop()?.replace(/\.(tsx?|jsx?)$/, '') || '';

      if (upLevels === 0) {
        return `./${downPath}/${componentFileName}`;
      }

      const ups = '../'.repeat(upLevels);
      return `${ups}${downPath}/${componentFileName}`;
    };

    let importPath = getRelativePath(targetDir, componentDir);

    if (componentPath.startsWith('/dapp/')) {
      importPath = componentPath.replace('/dapp/', '@/').replace(/\.(tsx?|jsx?)$/, '');
    }

    const importPattern = new RegExp(
      `import\\s+.*\\b${componentName}\\b.*from\\s+['"]${importPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`,
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

  const autoSyncResult = await autoSyncIfNeeded(targetPagePath);

  const baseMessage = [
    `✅ Integrated ${componentName} into ${targetPagePath}`,
    '',
    ...changes,
    '',
    `📝 Component: ${componentPath}`,
    `📄 Target page: ${targetPagePath}`,
    `🔗 Import path: ${importPath}`,
  ].join('\n');

  const message = formatAutoSyncMessage(baseMessage, autoSyncResult);

  return {
    success: true,
    message,
    data: {
      componentPath,
      targetPage: targetPagePath,
      componentName,
      importPath,
      changes,
      autoDeploy: autoSyncResult ?? undefined,
    },
  };
} catch (error) {
  return {
    success: false,
    message: `Failed to integrate component: ${componentPath}`,
    error: String(error),
  };
}
}

async function listKeyFiles(): Promise<ToolResult> {
  try {
    const files = useIDEStore.getState().files;
    const blueprints = files.filter(
      (file) => file.path.startsWith('/contracts/') || file.path.startsWith('/blueprints/'),
    );
    const tests = files.filter((file) => file.path.startsWith('/tests/'));
    const dappFiles = files.filter((file) => file.path.startsWith('/dapp/'));

    const formatTopFiles = (list: File[], limit = 5) =>
      list
        .slice(0, limit)
        .map((file) => `  • ${file.path} (${file.content.length} bytes)`)
        .join('\n');

    const message = [
      '📦 Project Overview',
      '',
      `🧱 Blueprints (${blueprints.length})`,
      blueprints.length ? formatTopFiles(blueprints) : '  • None found',
      '',
      `🧪 Tests (${tests.length})`,
      tests.length ? formatTopFiles(tests) : '  • None found',
      '',
      `🌐 dApp Files (${dappFiles.length})`,
      dappFiles.length ? formatTopFiles(dappFiles) : '  • None found',
      '',
      'Tip: Use summarize_file(path) for deeper insight into any file.',
    ].join('\n');

    return {
      success: true,
      message,
      data: {
        blueprints: blueprints.map((file) => ({ path: file.path, size: file.content.length })),
        tests: tests.map((file) => ({ path: file.path, size: file.content.length })),
        dapp: dappFiles.map((file) => ({ path: file.path, size: file.content.length })),
      },
    };
  } catch (error) {
    return {
      success: false,
      message: 'Failed to list key files',
      error: String(error),
    };
  }
}

async function searchSymbol(query: string, scope?: string): Promise<ToolResult> {
  try {
    if (!query || !query.trim()) {
      return {
        success: false,
        message: 'Missing search query',
        error: 'Provide a symbol, class name, or identifier to search for.',
      };
    }

    const files = useIDEStore.getState().files;
    const sanitizedQuery = query.trim();
    const regex = new RegExp(escapeRegExp(sanitizedQuery), 'gi');
    const matches: Array<{ path: string; line: number; snippet: string }> = [];

    files.forEach((file) => {
      if (scope && !file.path.startsWith(scope)) {
        return;
      }

      const lines = file.content.split('\n');
      lines.forEach((line, index) => {
        if (regex.test(line)) {
          matches.push({
            path: file.path,
            line: index + 1,
            snippet: line.trim().slice(0, 160),
          });
        }
        regex.lastIndex = 0;
      });
    });

    const limit = 25;
    const trimmedMatches = matches.slice(0, limit);
    const header = `🔎 Found ${matches.length} match${matches.length === 1 ? '' : 'es'} for "${sanitizedQuery}"${
      scope ? ` under ${scope}` : ''
    }`;
    const body = trimmedMatches
      .map((match) => `  • ${match.path}:${match.line} — ${match.snippet}`)
      .join('\n');

    return {
      success: true,
      message: matches.length ? `${header}\n${body}` : `${header}\n  • None found`,
      data: {
        totalMatches: matches.length,
        matches: trimmedMatches,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to search for "${query}"`,
      error: String(error),
    };
  }
}

async function summarizeFile(path: string): Promise<ToolResult> {
  try {
    if (!path || !path.trim()) {
      return {
        success: false,
        message: 'Missing file path to summarize',
        error: 'Provide a /contracts/, /tests/, or /dapp/ path.',
      };
    }

    const files = useIDEStore.getState().files;
    const file = files.find((f) => f.path === path);

    if (!file) {
      return {
        success: false,
        message: `File not found: ${path}`,
        error: 'Use list_files() to see available paths.',
      };
    }

    const lines = file.content.split('\n');
    const nonEmptyLines = lines.filter((line) => line.trim().length > 0).length;
    const preview = lines.slice(0, Math.min(12, lines.length)).join('\n');

    const decorators = (file.content.match(/@\w+/g) || []).length;
    const classes = (file.content.match(/class\s+\w+/g) || []).length;
    const functions = (file.content.match(/def\s+\w+/g) || file.content.match(/function\s+\w+/g) || []).length;

    const message = [
      `📄 ${file.name}`,
      '',
      `Path: ${file.path}`,
      `Language: ${file.language}`,
      `Type: ${file.type}`,
      `Lines: ${lines.length} (${nonEmptyLines} with content)`,
      `Classes: ${classes} | Functions: ${functions} | Decorators: ${decorators}`,
      '',
      'Snippet:',
      '```',
      preview || '(file is empty)',
      '```',
    ].join('\n');

    return {
      success: true,
      message,
      data: {
        path: file.path,
        language: file.language,
        type: file.type,
        lines: lines.length,
        nonEmptyLines,
        classes,
        functions,
        decorators,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to summarize ${path}`,
      error: String(error),
    };
  }
}

export const fileTools = {
  listFiles,
  readFile,
  writeFile,
  deleteFile,
  getProjectStructure,
  findFile,
  getFileDependencies,
  analyzeComponent,
  integrateComponent,
  listKeyFiles,
  searchSymbol,
  summarizeFile,
};

export type FileTools = typeof fileTools;
