import { useIDEStore } from '@/store/ide-store';
import { ToolResult } from '../types';
import { executeTool } from '../middleware';

/**
 * Lists files and directories in the project
 */
export async function listFiles(path: string = '/'): Promise<ToolResult> {
  return executeTool(
    'list_files',
    async () => {
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
    },
    {
      retries: 0, // Read-only operation, no retry needed
    }
  );
}

/**
 * Gets hierarchical tree view of entire project with file types, sizes, and filtering
 */
export async function getProjectStructure(
  filterByType?: 'blueprints' | 'tests' | 'dapp' | 'components' | 'pages' | 'configs',
): Promise<ToolResult> {
  return executeTool(
    'get_project_structure',
    async () => {
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
    },
    {
      retries: 0,
    }
  );
}

/**
 * Lists high-impact files (blueprints, tests, dApp) for quick overview
 */
export async function listKeyFiles(): Promise<ToolResult> {
  return executeTool(
    'list_key_files',
    async () => {
      const files = useIDEStore.getState().files;

      const blueprints = files.filter(
        (f) => f.path.startsWith('/blueprints/') || f.path.startsWith('/contracts/'),
      );
      const tests = files.filter((f) => f.path.startsWith('/tests/'));
      const dapps = files.filter((f) => f.path.startsWith('/dapp/'));

      const message = [
        '📋 Key Files Summary:',
        '',
        `📜 Blueprints (${blueprints.length}):`,
        ...blueprints.map((f) => `  ${f.path}`),
        '',
        `🧪 Tests (${tests.length}):`,
        ...tests.map((f) => `  ${f.path}`),
        '',
        `🌐 dApp Files (${dapps.length}):`,
        ...dapps.slice(0, 10).map((f) => `  ${f.path}`),
        dapps.length > 10 ? `  ... and ${dapps.length - 10} more` : '',
      ]
        .filter(Boolean)
        .join('\n');

      return {
        success: true,
        message,
        data: {
          blueprints: blueprints.map((f) => ({ path: f.path, size: f.content.length })),
          tests: tests.map((f) => ({ path: f.path, size: f.content.length })),
          dapps: dapps.map((f) => ({ path: f.path, size: f.content.length })),
        },
      };
    },
    {
      retries: 0,
    }
  );
}

