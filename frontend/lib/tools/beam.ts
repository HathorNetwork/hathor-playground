import { beamClient } from '../beam-client';
import { useIDEStore } from '@/store/ide-store';
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
      addConsoleMessage?.('info', `🧹 Cleaning up existing ${resolvedAppName} directory...`);

      const cleanupCommands = [
        `cd /app && rm -rf ${resolvedAppName}`,
        `cd /app && chmod -R u+w ${resolvedAppName} 2>/dev/null; rm -rf ${resolvedAppName}`,
        `cd /app && find ${resolvedAppName} -delete 2>/dev/null; rm -rf ${resolvedAppName}`,
      ];

      let cleanupSuccess = false;
      for (const cleanupCmd of cleanupCommands) {
        await runCommand(cleanupCmd);
        const verifyCmd = `cd /app && test -d ${resolvedAppName} && echo "exists" || echo "not_exists"`;
        const verifyResult = await runCommand(verifyCmd);
        if (verifyResult.data?.stdout?.includes('not_exists')) {
          cleanupSuccess = true;
          break;
        }
      }

      if (!cleanupSuccess) {
        addConsoleMessage?.('warning', `⚠️ Could not fully remove ${resolvedAppName}, but continuing...`);
      }
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
      return {
        success: false,
        message: `❌ Failed to scaffold dApp: ${resolvedAppName}\nDirectory or package.json not found`,
        error: 'Package.json not found after scaffolding',
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
      syncResult = await syncDApp('ide-to-sandbox');
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

    if (buildLogStream) {
      buildLogStream.close();
    }

    const deploymentMessage = syncResult?.success
      ? `✅ dApp deployed with proper sync!\n\n${syncResult.message}`
      : '✅ dApp deployed (sync had issues but deployment continued)';

    return {
      success: true,
      message: deploymentMessage,
      data: {
        syncResult,
        devServerResult,
        url: devServerResult?.data?.url || null,
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

async function uploadFiles(paths: string[]): Promise<ToolResult> {
  try {
    const { files, activeProjectId, addConsoleMessage } = useIDEStore.getState();

    if (!activeProjectId) {
      return {
        success: false,
        message: 'No active project',
        error: 'Select or create a project first',
      };
    }

    const filesToUpload = files.filter((f) => paths.includes(f.path));

    if (filesToUpload.length === 0) {
      return {
        success: false,
        message: `No files found for paths: ${paths.join(', ')}`,
        error: 'Check file paths',
      };
    }

    const filesMap: Record<string, string> = {};
    filesToUpload.forEach((f) => {
      filesMap[f.path] = f.content;
    });

    addConsoleMessage?.('info', `📤 Uploading ${filesToUpload.length} files to sandbox...`);

    await beamClient.uploadFiles(activeProjectId, filesMap);

    return {
      success: true,
      message: `✅ Uploaded ${filesToUpload.length} files to sandbox`,
      data: {
        files: filesToUpload.map((f) => f.path),
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

    addConsoleMessage?.('info', '🔄 Restarting dev server...');

    const result = await beamClient.startDevServer(activeProjectId);

    if (result.url) {
      setSandboxUrl(activeProjectId, result.url);
      startSandboxLogStream(activeProjectId, addConsoleMessage);
    }

    return {
      success: true,
      message: `✅ Dev server restarted!\n\nURL: ${result.url}`,
      data: result,
    };
  } catch (error) {
    return {
      success: false,
      message: '❌ Failed to restart dev server',
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

export const beamTools = {
  createHathorDapp,
  deployDApp,
  uploadFiles,
  getSandboxUrl,
  restartDevServer,
  bootstrapNextJS,
  runCommand,
  readSandboxFiles,
  getSandboxLogs,
};

export type BeamTools = typeof beamTools;

