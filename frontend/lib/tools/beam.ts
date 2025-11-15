import { beamClient } from '../beam-client';
import { useIDEStore } from '@/store/ide-store';
import { guardContractMetadata } from './contract-metadata';
import type { File } from '@/store/ide-store';

import { ToolResult } from './types';

let activeLogStream: EventSource | null = null;

function startSandboxLogStream(projectId: string, addConsoleMessage?: (type: 'info' | 'error' | 'warning' | 'success', message: string) => void) {
  if (typeof window === 'undefined') {
    return;
  }

  if (activeLogStream) {
    activeLogStream.close();
    activeLogStream = null;
  }

  try {
    activeLogStream = beamClient.streamLogs(
      projectId,
      (log) => addConsoleMessage?.('info', log),
      (error) => {
        console.warn('Sandbox log stream error:', error);
        activeLogStream?.close();
        activeLogStream = null;
      },
    );
  } catch (error) {
    console.warn('Failed to start sandbox log stream:', error);
  }
}

async function runCommand(command: string): Promise<ToolResult> {
  try {
    const { activeProjectId, addConsoleMessage } = useIDEStore.getState();

    if (!activeProjectId) {
      return {
        success: false,
        message: 'No active project',
        error: 'Select or create a project first',
      };
    }

    addConsoleMessage?.('info', `$ ${command}`);

    if (typeof window === 'undefined') {
      const response = await fetch(`/api/beam/sandbox/${activeProjectId}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command }),
      });
      if (!response.ok) {
        const error = await response.json();
        return {
          success: false,
          message: '❌ Command failed',
          error: error.error || response.statusText,
        };
      }
      const result = await response.json();
      return {
        success: true,
        message: `✅ Command executed successfully`,
        data: result,
      };
    }

    return await new Promise<ToolResult>((resolve, reject) => {
      const url = `/api/beam/sandbox/${activeProjectId}/command/stream?command=${encodeURIComponent(command)}`;
      const source = new EventSource(url);
      let stdout = '';
      let stderr = '';

      source.addEventListener('log', (event) => {
        const payload = JSON.parse((event as MessageEvent).data);
        if (payload.type === 'stdout') {
          stdout += payload.chunk;
          addConsoleMessage?.('info', payload.chunk);
        } else {
          stderr += payload.chunk;
          addConsoleMessage?.('error', payload.chunk);
        }
      });

      source.addEventListener('error', () => {
        source.close();
        reject({
          success: false,
          message: '❌ Command stream failed',
          error: 'Stream connection failed',
        });
      });

      source.addEventListener('done', (event) => {
        const payload = JSON.parse((event as MessageEvent).data);
        source.close();
        const exitCode = Number(payload.exitCode) || 0;
        resolve({
          success: exitCode === 0,
          message: `Command exited with code ${exitCode}`,
          data: {
            stdout,
            stderr,
            exit_code: exitCode,
          },
        });
      });
    });
  } catch (error) {
    return {
      success: false,
      message: '❌ Failed to run command',
      error: String(error),
    };
  }
}

async function purgeSandbox(): Promise<ToolResult> {
  try {
    const { activeProjectId, addConsoleMessage, setSandboxUrl } = useIDEStore.getState();

    if (!activeProjectId) {
      return {
        success: false,
        message: 'No active project',
        error: 'Select or create a project first',
      };
    }

    addConsoleMessage?.('warning', '🧹 Purging sandbox /app directory...');

    const purgeResult = await runCommand('find . -mindepth 1 -maxdepth 1 -exec rm -rf {} +');
    if (!purgeResult.success) {
      return {
        success: false,
        message: '❌ Failed to purge sandbox files',
        error: purgeResult.error || purgeResult.message,
      };
    }

    setSandboxUrl(activeProjectId, null);
    addConsoleMessage?.('success', '✅ Sandbox files removed. Re-deploy to recreate the app.');

    return {
      success: true,
      message: 'Sandbox purged successfully',
      data: {},
    };
  } catch (error) {
    return {
      success: false,
      message: '❌ Failed to purge sandbox',
      error: String(error),
    };
  }
}

async function createHathorDapp(
  appName?: string,
  walletConnectId?: string,
  network?: 'mainnet' | 'testnet',
): Promise<ToolResult> {
  try {
    const { activeProjectId, addConsoleMessage } = useIDEStore.getState();

    if (!activeProjectId) {
      return {
        success: false,
        message: 'No active project',
        error: 'Select or create a project first',
      };
    }

    const resolvedAppName = (appName && String(appName).trim()) || 'hathor-dapp';
    const resolvedNetwork = (network as string) || 'testnet';
    const resolvedWC =
      (walletConnectId && String(walletConnectId).trim()) || '8264fff563181da658ce64ee80e80458';

    addConsoleMessage?.('info', `🚀 Scaffolding Hathor dApp: ${resolvedAppName} (${resolvedNetwork})`);

    const checkDirCmd = `cd /app && test -d ${resolvedAppName} && echo "exists" || echo "not_exists"`;
    const checkResult = await runCommand(checkDirCmd);

    if (checkResult.data?.stdout?.includes('exists')) {
      addConsoleMessage?.('warning', `⚠️ /app already contains ${resolvedAppName}. Remove it first or purge the sandbox.`);
      return {
        success: false,
        message: `❌ ${resolvedAppName} already exists in /app. Run purgeSandbox() or remove it manually, then retry.`,
        error: 'Existing scaffold detected',
      };
    }

    addConsoleMessage?.('info', '🧹 Purging /app before scaffolding...');
    const purgeResult = await runCommand('cd /app && rm -rf * && rm -rf .* 2>/dev/null || true');
    if (!purgeResult.success) {
      return {
        success: false,
        message: '❌ Failed to purge /app before scaffolding',
        error: purgeResult.error || purgeResult.message,
      };
    }

    const cmd = `cd /app && npx create-hathor-dapp@latest ${resolvedAppName} --yes --wallet-connect-id=${resolvedWC} --network=${resolvedNetwork} --skip-git`;
    const execResult = await runCommand(cmd);

    const exitCode = execResult.data?.exit_code;
    const hasErrors = exitCode !== '0' && exitCode !== 0;
    const hasStderr = execResult.data?.stderr && execResult.data?.stderr.trim().length > 0;

    if (hasErrors && hasStderr && !execResult.data?.stderr?.includes('Failed to initialize git repository')) {
      const errorMsg = execResult.data?.stderr || execResult.data?.stdout || 'Unknown error';
      return {
        success: false,
        message: `❌ Failed to scaffold dApp: ${resolvedAppName}\nError: ${errorMsg}`,
        error: errorMsg,
      };
    }

    const checkPackageCmd = `cd /app && ls -la ${resolvedAppName}/package.json 2>/dev/null || echo "missing"`;
    const checkPackageResult = await runCommand(checkPackageCmd);
    const packageExists = checkPackageResult.data?.stdout && !checkPackageResult.data?.stdout.includes('missing');

    if (!packageExists) {
      const stdout = execResult.data?.stdout || '';
      const stderr = execResult.data?.stderr || '';
      return {
        success: false,
        message: `❌ Failed to scaffold dApp: ${resolvedAppName}\nDirectory or package.json not found\nstdout:\n${stdout}\nstderr:\n${stderr}`,
        error: 'Package.json not found after scaffolding',
      };
    }

  // Move generated files into /app root so BEAM dev server sees package.json at /app/package.json
  const moveResult = await runCommand(
    `cd /app && cp -a ${resolvedAppName}/. ./ && rm -rf ${resolvedAppName}`,
  );
  if (!moveResult.success) {
    return {
      success: false,
      message: `❌ Failed to flatten dApp directory`,
      error: moveResult.error || 'Could not move scaffolded files to /app',
    };
  }

  // Ensure package.json now exists directly under /app
  const verifyRootPackage = await runCommand(`cd /app && ls -la package.json 2>/dev/null || echo "missing"`);
  if (verifyRootPackage.data?.stdout?.includes('missing')) {
    return {
      success: false,
      message: '❌ package.json not found at /app after moving files',
      error: 'Flattening step failed; dev server cannot run',
    };
  }

    const nextSteps = [
      `✅ Scaffolded with create-hathor-dapp in /app/${resolvedAppName}`,
      `🔄 Run sync_dapp() to sync files back to IDE`,
      `▶️ To run in sandbox: use restart_dev_server()`,
      `🌐 To get URL: use get_sandbox_url()`,
    ].join('\n');

    return {
      success: true,
      message: nextSteps,
      data: {
        app_name: resolvedAppName,
        network: resolvedNetwork,
        wallet_connect_id: resolvedWC,
        scaffold: execResult.data,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: '❌ Failed to create Hathor dApp',
      error: String(error),
    };
  }
}

async function deployDApp(): Promise<ToolResult> {
  try {
    const { activeProjectId, addConsoleMessage, setSandboxUrl } = useIDEStore.getState();

    if (!activeProjectId) {
      return {
        success: false,
        message: 'No active project',
        error: 'Select or create a project first',
      };
    }

    const metadataGuard = guardContractMetadata('deploy the dApp or restart the sandbox wallet');
    if (metadataGuard) {
      addConsoleMessage?.('warning', metadataGuard.message);
      return metadataGuard;
    }

    addConsoleMessage?.('info', '🚀 Deploying dApp to BEAM sandbox...');

    let buildLogStream: EventSource | null = null;
    try {
      buildLogStream = beamClient.streamBuildLogs(
        activeProjectId,
        (log) => addConsoleMessage?.('info', log),
        (error) => {
          console.error('Build log stream error:', error);
        },
        () => {
          console.log('Build log stream completed');
        },
      );
    } catch (streamError) {
      console.warn('Failed to start build log stream:', streamError);
    }

    let syncResult: ToolResult | null = null;
    try {
      const { syncDApp } = await import('./sync');
      syncResult = await syncDApp('ide-to-sandbox', undefined, { forceFullUpload: true });
      if (!syncResult.success) {
        console.warn('File sync failed during deployment, continuing anyway:', syncResult.error);
        addConsoleMessage?.('warning', '⚠️ File sync failed, but continuing with deployment');
      }
    } catch (syncError) {
      console.warn('File sync error during deployment:', syncError);
      addConsoleMessage?.('warning', '⚠️ File sync encountered an error, but continuing with deployment');
    }

    let devServerResult: ToolResult | null = null;
    try {
      devServerResult = await restartDevServer();
      if (devServerResult.success) {
        addConsoleMessage?.('success', `🌐 Dev server running at: ${devServerResult.data.url}`);
        if (devServerResult.data?.url) {
          setSandboxUrl(activeProjectId, devServerResult.data.url);
          startSandboxLogStream(activeProjectId, addConsoleMessage);
        }
      }
    } catch (devError) {
      console.warn('Failed to start dev server:', devError);
    }

    let verifiedStatus: ToolResult | null = null;
    try {
      const status = await beamClient.getSandbox(activeProjectId);
      verifiedStatus = status
        ? {
            success: true,
            message: status.dev_server_running
              ? 'Dev server confirmed running'
              : 'Dev server is not running after deployment',
            data: status,
          }
        : {
            success: false,
            message: 'No sandbox status returned after deployment',
            error: 'Sandbox lookup returned empty response',
          };
      if (!verifiedStatus.success || !verifiedStatus.data?.dev_server_running) {
        addConsoleMessage?.(
          'warning',
          '⚠️ Sandbox did not report a running dev server after deployment. Check logs before continuing.',
        );
      }
    } catch (statusError) {
      console.warn('Failed to verify sandbox status:', statusError);
      verifiedStatus = {
        success: false,
        message: '⚠️ Unable to verify dev server status',
        error: String(statusError),
      };
    }

    if (buildLogStream) {
      buildLogStream.close();
    }

    let deploymentMessage = syncResult?.success
      ? `✅ dApp deployed with proper sync!\n\n${syncResult.message}`
      : '✅ dApp deployed (sync had issues but deployment continued)';

    if (
      verifiedStatus &&
      (!verifiedStatus.success || (verifiedStatus.data && !verifiedStatus.data.dev_server_running))
    ) {
      deploymentMessage += `\n\n${verifiedStatus.message}\nUse get_sandbox_logs() to inspect why the dev server is down.`;
    }

    return {
      success: true,
      message: deploymentMessage,
      data: {
        syncResult,
        devServerResult,
        url: devServerResult?.data?.url || null,
        status: verifiedStatus?.data ?? null,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: '❌ Failed to deploy dApp',
      error: String(error),
    };
  }
}

type UploadInput = string | string[] | Record<string, string>;

function normalizePath(path: string): string {
  if (!path.startsWith('/')) {
    return `/dapp/${path.replace(/^\/+/, '')}`;
  }

  if (path.startsWith('/dapp/') || path.startsWith('/app/')) {
    return path;
  }

  return `/dapp${path}`;
}

async function uploadFiles(input: UploadInput): Promise<ToolResult> {
  try {
    const { files, activeProjectId, addConsoleMessage } = useIDEStore.getState();

    if (!activeProjectId) {
      return {
        success: false,
        message: 'No active project',
        error: 'Select or create a project first',
      };
    }

    const filesMap: Record<string, string> = {};

    if (typeof input === 'string') {
      input = [input];
    }

    if (Array.isArray(input)) {
      const normalizedPaths = Array.from(
        new Set(
          input
            .map((path) => normalizePath(path.trim()))
            .filter((path) => path.length > 1),
        ),
      );

      const filesToUpload = files.filter((f) => normalizedPaths.includes(f.path));

      if (filesToUpload.length === 0) {
        return {
          success: false,
          message: `No files found for paths: ${normalizedPaths.join(', ')}`,
          error: 'Check file paths under /dapp/',
        };
      }

      filesToUpload.forEach((f) => {
        filesMap[f.path] = f.content;
      });
    } else if (input && typeof input === 'object') {
      for (const [rawPath, rawContent] of Object.entries(input)) {
        const normalizedPath = normalizePath(rawPath);
        if (typeof rawContent === 'string') {
          filesMap[normalizedPath] = rawContent;
        } else if (rawContent !== undefined && rawContent !== null) {
          filesMap[normalizedPath] = String(rawContent);
        }
      }
    }

    if (Object.keys(filesMap).length === 0) {
      return {
        success: false,
        message: 'No files to upload',
        error: 'Provide at least one valid file path or { path: content } entry',
      };
    }

    const uploadCount = Object.keys(filesMap).length;
    addConsoleMessage?.('info', `📤 Uploading ${uploadCount} file(s) to sandbox...`);

    await beamClient.uploadFiles(activeProjectId, filesMap);

    return {
      success: true,
      message: `✅ Uploaded ${uploadCount} file(s) to sandbox`,
      data: {
        files: Object.keys(filesMap),
      },
    };
  } catch (error) {
    return {
      success: false,
      message: '❌ Failed to upload files',
      error: String(error),
    };
  }
}

async function getSandboxUrl(): Promise<ToolResult> {
  try {
    const { activeProjectId, setSandboxUrl } = useIDEStore.getState();

    if (!activeProjectId) {
      return {
        success: false,
        message: 'No active project',
        error: 'Select or create a project first',
      };
    }

    const sandbox = await beamClient.getSandbox(activeProjectId);

    if (!sandbox) {
      return {
        success: false,
        message: 'No sandbox found for this project',
        error: 'Deploy the dApp first using deploy_dapp()',
      };
    }

    setSandboxUrl(activeProjectId, sandbox.url);

    return {
      success: true,
      message: `🌐 Sandbox URL: ${sandbox.url}`,
      data: {
        url: sandbox.url,
        sandbox_id: sandbox.sandbox_id,
        project_id: sandbox.project_id,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: '❌ Failed to get sandbox URL',
      error: String(error),
    };
  }
}

async function restartDevServer(): Promise<ToolResult> {
  try {
    const { activeProjectId, addConsoleMessage, setSandboxUrl } = useIDEStore.getState();

    if (!activeProjectId) {
      return {
        success: false,
        message: 'No active project',
        error: 'Select or create a project first',
      };
    }

    const metadataGuard = guardContractMetadata('start or restart the dev server');
    if (metadataGuard) {
      addConsoleMessage?.('warning', metadataGuard.message);
      return metadataGuard;
    }

    addConsoleMessage?.('info', '🔄 Syncing files before restart...');

    try {
      const { syncDApp } = await import('./sync');
      const syncResult = await syncDApp('ide-to-sandbox', undefined, { forceFullUpload: true });
      if (!syncResult.success) {
        addConsoleMessage?.('warning', `⚠️ Sync failed: ${syncResult.error || syncResult.message}`);
      }
    } catch (syncError) {
      addConsoleMessage?.('warning', `⚠️ Sync error before restart: ${String(syncError)}`);
    }

    addConsoleMessage?.('info', '🔄 Restarting dev server...');

    const result = await beamClient.startDevServer(activeProjectId);

    result.logs?.forEach((line: string) => {
      addConsoleMessage?.('info', line);
    });

    if (result.url) {
      setSandboxUrl(activeProjectId, result.url);
      startSandboxLogStream(activeProjectId, addConsoleMessage);
    }

    const sandboxStatus = await beamClient.getSandbox(activeProjectId);
    const running = sandboxStatus?.dev_server_running;

    return {
      success: Boolean(running),
      message: running
        ? `✅ Dev server restarted!\n\nURL: ${result.url}`
        : '⚠️ Dev server command returned but the sandbox is still stopped. Check logs before continuing.',
      data: {
        ...result,
        status: sandboxStatus || null,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: '❌ Failed to restart dev server',
      error: String(error),
    };
  }
}

async function stopDevServer(): Promise<ToolResult> {
  try {
    const { activeProjectId, addConsoleMessage, setSandboxUrl } = useIDEStore.getState();

    if (!activeProjectId) {
      return {
        success: false,
        message: 'No active project',
        error: 'Select or create a project first',
      };
    }

    addConsoleMessage?.('info', '🛑 Stopping dev server...');

    const result = await beamClient.stopDevServer(activeProjectId);

    if (result.status === 'stopped') {
      setSandboxUrl(activeProjectId, null);
      if (activeLogStream) {
        activeLogStream.close();
        activeLogStream = null;
      }
      return {
        success: true,
        message: '✅ Dev server stopped',
        data: result,
      };
    }

    return {
      success: true,
      message: 'ℹ️ Dev server was not running',
      data: result,
    };
  } catch (error) {
    return {
      success: false,
      message: '❌ Failed to stop dev server',
      error: String(error),
    };
  }
}

async function bootstrapNextJS(useTypeScript: boolean = true, useTailwind: boolean = true): Promise<ToolResult> {
  try {
    const { addFile, activeProjectId } = useIDEStore.getState();

    if (!activeProjectId) {
      return {
        success: false,
        message: 'No active project',
        error: 'Select or create a project first',
      };
    }

    const files: Array<Omit<File, 'id'>> = [];

    files.push({
      name: 'package.json',
      path: '/dapp/package.json',
      content: JSON.stringify(
        {
          name: 'hathor-dapp',
          version: '0.1.0',
          private: true,
          scripts: {
            dev: 'next dev',
            build: 'next build',
            start: 'next start',
            lint: 'next lint',
          },
          dependencies: {
            next: '15.1.6',
            react: '19.0.0',
            'react-dom': '19.0.0',
            ...(useTailwind && {
              tailwindcss: '^3.4.1',
              autoprefixer: '^10.4.17',
              postcss: '^8.4.33',
            }),
          },
          ...(useTypeScript && {
            devDependencies: {
              '@types/node': '^20',
              '@types/react': '^19',
              '@types/react-dom': '^19',
              typescript: '^5',
            },
          }),
        },
        null,
        2,
      ),
      type: 'config',
      language: 'json',
    });

    const ext = useTypeScript ? 'tsx' : 'jsx';

    files.push({
      name: useTypeScript ? 'next.config.ts' : 'next.config.js',
      path: `/dapp/next.config.${useTypeScript ? 'ts' : 'js'}`,
      content: useTypeScript
        ? `import type { NextConfig } from 'next';\n\nconst nextConfig: NextConfig = {};\n\nexport default nextConfig;`
        : `/** @type {import('next').NextConfig} */\nconst nextConfig = {};\n\nmodule.exports = nextConfig;`,
      type: 'config',
      language: useTypeScript ? 'typescript' : 'javascript',
    });

    files.push({
      name: `page.${ext}`,
      path: `/dapp/app/page.${ext}`,
      content: `export default function Home() {
  return (
    <div${useTailwind ? ' className="min-h-screen p-8"' : ''}>
      <h1${useTailwind ? ' className="text-4xl font-bold"' : ''}>Welcome to Hathor dApp</h1>
      <p${useTailwind ? ' className="mt-4"' : ''}>Start building your decentralized application!</p>
    </div>
  );
}`,
      type: 'component',
      language: useTypeScript ? 'typescriptreact' : 'javascript',
    });

    files.push({
      name: `layout.${ext}`,
      path: `/dapp/app/layout.${ext}`,
      content: `${useTypeScript ? 'import type { Metadata } from "next";\n' : ''}${
        useTailwind ? 'import "./globals.css";\n' : ''
      }
${useTypeScript ? 'export const metadata: Metadata = {\n  title: "Hathor dApp",\n  description: "Built with Hathor Playground",\n};\n\n' : ''}export default function RootLayout({
  children,
}${useTypeScript ? ': { children: React.ReactNode }' : ''}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}`,
      type: 'component',
      language: useTypeScript ? 'typescriptreact' : 'javascript',
    });

    if (useTailwind) {
      files.push({
        name: 'tailwind.config.ts',
        path: '/dapp/tailwind.config.ts',
        content: `import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
export default config;`,
        type: 'config',
        language: 'typescript',
      });

      files.push({
        name: 'globals.css',
        path: '/dapp/app/globals.css',
        content: `@tailwind base;
@tailwind components;
@tailwind utilities;`,
        type: 'style',
        language: 'css',
      });
    }

    if (useTypeScript) {
      files.push({
        name: 'tsconfig.json',
        path: '/dapp/tsconfig.json',
        content: JSON.stringify(
          {
            compilerOptions: {
              target: 'ES2017',
              lib: ['dom', 'dom.iterable', 'esnext'],
              allowJs: true,
              skipLibCheck: true,
              strict: true,
              noEmit: true,
              esModuleInterop: true,
              module: 'esnext',
              moduleResolution: 'bundler',
              resolveJsonModule: true,
              isolatedModules: true,
              jsx: 'preserve',
              incremental: true,
              plugins: [{ name: 'next' }],
              paths: { '@/*': ['./*'] },
            },
            include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts'],
            exclude: ['node_modules'],
          },
          null,
          2,
        ),
        type: 'config',
        language: 'json',
      });
    }

    files.forEach((file) => addFile(file));

    return {
      success: true,
      message: `✅ Created Next.js project with ${files.length} files\n\nFiles created:\n${files
        .map((f) => `  ${f.path}`)
        .join('\n')}\n\nNext steps:\n1. Deploy with deploy_dapp()\n2. Open the sandbox URL to see your app`,
      data: {
        files_created: files.length,
        typescript: useTypeScript,
        tailwind: useTailwind,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: '❌ Failed to bootstrap Next.js project',
      error: String(error),
    };
  }
}

async function readSandboxFiles(path?: string): Promise<ToolResult> {
  try {
    const { activeProjectId, updateFile, addFile, addConsoleMessage } = useIDEStore.getState();

    if (!activeProjectId) {
      return {
        success: false,
        message: 'No active project',
        error: 'Select or create a project first',
      };
    }

    addConsoleMessage?.('info', `📥 Reading files from sandbox${path ? ` (${path})` : ''}...`);

    const queryParams = path ? `?path=${encodeURIComponent(path)}` : '';
    const response = await fetch(`/api/beam/sandbox/${activeProjectId}/files${queryParams}`);

    if (!response.ok) {
      const error = await response.json();
      return {
        success: false,
        message: '❌ Failed to read files',
        error: error.error || response.statusText,
      };
    }

    const result = await response.json();
    const files = result.files || {};
    const fileCount = Object.keys(files).length;

    if (fileCount === 0) {
      return {
        success: true,
        message: '📁 No files found in sandbox',
        data: { files },
      };
    }

    for (const [filePath, content] of Object.entries(files)) {
      const existingFile = useIDEStore.getState().files.find((f) => f.path === filePath);

      if (existingFile) {
        updateFile?.(existingFile.id, content as string);
      } else {
        const fileName = filePath.split('/').pop() || 'unknown';
        const fileExt = fileName.split('.').pop() || '';

        let language: any = 'plaintext';
        let type: any = 'component';

        if (fileExt === 'tsx' || fileExt === 'jsx') {
          language = fileExt === 'tsx' ? 'typescriptreact' : 'javascriptreact';
          type = 'component';
        } else if (fileExt === 'ts' || fileExt === 'js') {
          language = fileExt === 'ts' ? 'typescript' : 'javascript';
          type = 'component';
        } else if (fileExt === 'json') {
          language = 'json';
          type = 'config';
        } else if (fileExt === 'css') {
          language = 'css';
          type = 'style';
        }

        addFile?.({
          name: fileName,
          path: filePath,
          content: content as string,
          language,
          type,
        });
      }
    }

    addConsoleMessage?.('success', `✅ Synced ${fileCount} files from sandbox`);

    return {
      success: true,
      message: `✅ Read ${fileCount} files from sandbox and synced to IDE`,
      data: { files, count: fileCount },
    };
  } catch (error) {
    return {
      success: false,
      message: '❌ Failed to read sandbox files',
      error: String(error),
    };
  }
}

async function getSandboxLogs(lines: number = 50): Promise<ToolResult> {
  try {
    const { activeProjectId, addConsoleMessage } = useIDEStore.getState();

    if (!activeProjectId) {
      return {
        success: false,
        message: 'No active project',
        error: 'Select or create a project first',
      };
    }

    addConsoleMessage?.('info', `📋 Fetching last ${lines} log lines...`);

    const response = await fetch(`/api/beam/sandbox/${activeProjectId}/recent-logs?lines=${lines}`);

    if (!response.ok) {
      const error = await response.json();
      return {
        success: false,
        message: '❌ Failed to get logs',
        error: error.error || response.statusText,
      };
    }

    const result = await response.json();
    const logs = result.logs || '';

    if (logs) {
      addConsoleMessage?.('info', logs);
    }

    return {
      success: true,
      message: `✅ Retrieved ${lines} log lines`,
      data: { logs },
    };
  } catch (error) {
    return {
      success: false,
      message: '❌ Failed to get sandbox logs',
      error: String(error),
    };
  }
}

async function getSandboxStatus(): Promise<ToolResult> {
  try {
    const { activeProjectId } = useIDEStore.getState();

    if (!activeProjectId) {
      return {
        success: false,
        message: 'No active project',
        error: 'Select or create a project first',
      };
    }

    const sandbox = await beamClient.getSandbox(activeProjectId);

    if (!sandbox) {
      return {
        success: false,
        message: 'No sandbox found for this project',
        error: 'Create or deploy to a sandbox first',
      };
    }

    return {
      success: true,
      message: sandbox.dev_server_running ? 'Dev server running' : 'Dev server stopped',
      data: sandbox,
    };
  } catch (error) {
    return {
      success: false,
      message: '❌ Failed to get sandbox status',
      error: String(error),
    };
  }
}

async function terminateSandbox(): Promise<ToolResult> {
  try {
    const { activeProjectId, addConsoleMessage, setSandboxUrl } = useIDEStore.getState();

    if (!activeProjectId) {
      return {
        success: false,
        message: 'No active project',
        error: 'Select or create a project first',
      };
    }

    addConsoleMessage?.('warning', '⚠️ Terminating sandbox...');
    const result = await beamClient.terminateSandbox(activeProjectId);
    setSandboxUrl(activeProjectId, null);
    if (activeLogStream) {
      activeLogStream.close();
      activeLogStream = null;
    }

    return {
      success: true,
      message: '🗑️ Sandbox terminated and reset',
      data: result,
    };
  } catch (error) {
    return {
      success: false,
      message: '❌ Failed to terminate sandbox',
      error: String(error),
    };
  }
}

async function runHeavyTask(command: string, cwd?: string): Promise<ToolResult> {
  try {
    if (!command || !command.trim()) {
      return {
        success: false,
        message: 'Command required',
        error: 'Provide a shell command to run inside the pod',
      };
    }

    const result = await beamClient.runHeavyTask(command, cwd);
    return {
      success: true,
      message: `🚀 Pod task completed${result.url ? `\nURL: ${result.url}` : ''}`,
      data: result,
    };
  } catch (error) {
    return {
      success: false,
      message: '❌ Heavy task failed',
      error: String(error),
    };
  }
}

export const beamTools = {
  createHathorDapp,
  deployDApp,
  uploadFiles,
  getSandboxUrl,
  restartDevServer,
  stopDevServer,
  getSandboxStatus,
  terminateSandbox,
  bootstrapNextJS,
  runCommand,
  runHeavyTask,
  purgeSandbox,
  readSandboxFiles,
  getSandboxLogs,
};

export type BeamTools = typeof beamTools;

