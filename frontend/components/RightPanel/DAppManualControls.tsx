'use client';

import React, { useEffect, useState } from 'react';
import {
  Play,
  Terminal,
  RefreshCw,
  FileText,
  Globe,
  Trash2,
  Loader2,
  X,
  ArrowLeftRight,
  Rocket,
  Upload,
  Download,
} from 'lucide-react';
import { useIDEStore } from '@/store/ide-store';
import { beamTools, fileTools, syncDApp } from '@/lib/tools';

interface SectionProps {
  title: string;
  children: React.ReactNode;
  description?: string;
}

const Section: React.FC<SectionProps> = ({ title, children, description }) => (
  <div className="space-y-2">
    <div>
      <p className="text-xs font-semibold tracking-wide uppercase text-gray-400">{title}</p>
      {description && <p className="text-[11px] text-gray-500">{description}</p>}
    </div>
    <div className="space-y-3">{children}</div>
  </div>
);

type SyncDirectionOption = 'ide-to-sandbox' | 'sandbox-to-ide' | 'bidirectional';
const DEFAULT_WALLET_CONNECT_ID = '8264fff563181da658ce64ee80e80458';

export const DAppManualControls: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const [sandboxStatus, setSandboxStatus] = useState<{
    running: boolean;
    url: string | null;
    sandboxId: string | null;
  } | null>(null);
  const [customCommand, setCustomCommand] = useState('');
  const [deleteTarget, setDeleteTarget] = useState('');
  const [isPurging, setIsPurging] = useState(false);
  const [appName, setAppName] = useState('hathor-dapp');
  const [walletConnectId, setWalletConnectId] = useState(DEFAULT_WALLET_CONNECT_ID);
  const [network, setNetwork] = useState<'mainnet' | 'testnet'>('testnet');
  const [uploadTargets, setUploadTargets] = useState('');
  const [readTarget, setReadTarget] = useState('');
  const [logLineCount, setLogLineCount] = useState('50');
  const [podCommand, setPodCommand] = useState('');
  const { activeProjectId, addConsoleMessage } = useIDEStore();

  const ensureProjectSelected = () => {
    if (!activeProjectId) {
      addConsoleMessage('error', 'No active project');
      return false;
    }
    return true;
  };

  const refreshSandboxStatus = async () => {
    if (!activeProjectId) {
      setSandboxStatus(null);
      return;
    }

    setStatusLoading(true);
    try {
      const result = await beamTools.getSandboxStatus();
      if (result.success && result.data) {
        setSandboxStatus({
          running: Boolean(result.data.dev_server_running),
          url: result.data.url || null,
          sandboxId: result.data.sandbox_id || null,
        });
      } else {
        setSandboxStatus(null);
      }
    } catch (error) {
      console.warn('Failed to refresh sandbox status:', error);
      setSandboxStatus(null);
    } finally {
      setStatusLoading(false);
    }
  };

  useEffect(() => {
    refreshSandboxStatus();
  }, [activeProjectId]);

  const runWithLoading = async (callback: () => Promise<void>) => {
    if (loading) return;
    setLoading(true);
    try {
      await callback();
    } finally {
      setLoading(false);
    }
  };

  const handleDeploy = async () => {
    if (!ensureProjectSelected()) return;

    try {
      await runWithLoading(async () => {
        const result = await beamTools.deployDApp();
        if (result.success) {
          addConsoleMessage('success', result.message);
        } else {
          addConsoleMessage('error', `❌ Deploy failed: ${result.error}`);
        }
      });
      await refreshSandboxStatus();
    } catch (error: any) {
      addConsoleMessage('error', `❌ Deploy error: ${error.message}`);
    }
  };

  const handleRunCommand = async () => {
    if (!ensureProjectSelected()) return;

    if (!customCommand.trim()) {
      addConsoleMessage('error', 'Enter a command to run');
      return;
    }

    try {
      await runWithLoading(async () => {
        const result = await beamTools.runCommand(customCommand);
        if (result.success) {
          const stdout = result.data?.stdout || '';
          const stderr = result.data?.stderr;
          addConsoleMessage('success', `✅ Command executed\n${stdout}`);
          if (stderr) {
            addConsoleMessage('warning', `stderr: ${stderr}`);
          }
        } else {
          addConsoleMessage('error', `❌ Command failed: ${result.error}`);
        }
      });
      await refreshSandboxStatus();
    } catch (error: any) {
      addConsoleMessage('error', `❌ Command error: ${error.message}`);
    }
  };

  const handleRestartServer = async () => {
    if (!ensureProjectSelected()) return;

    try {
      await runWithLoading(async () => {
        const result = await beamTools.restartDevServer();
        if (result.success) {
          addConsoleMessage('success', '✅ Dev server restarted');
        } else {
          addConsoleMessage('error', `❌ Restart failed: ${result.error}`);
        }
      });
      await refreshSandboxStatus();
    } catch (error: any) {
      addConsoleMessage('error', `❌ Restart error: ${error.message}`);
    }
  };

  const handleStopServer = async () => {
    if (!ensureProjectSelected()) return;

    try {
      await runWithLoading(async () => {
        const result = await beamTools.stopDevServer();
        if (result.success) {
          addConsoleMessage('success', result.message);
        } else {
          addConsoleMessage('error', result.message || '❌ Failed to stop dev server');
        }
      });
      await refreshSandboxStatus();
    } catch (error: any) {
      addConsoleMessage('error', `❌ Stop error: ${error.message}`);
    }
  };

  const handleTerminateSandbox = async () => {
    if (!ensureProjectSelected()) return;
    const confirmed = confirm('This will terminate and recreate the entire sandbox. Continue?');
    if (!confirmed) return;

    try {
      await runWithLoading(async () => {
        const result = await beamTools.terminateSandbox();
        if (result.success) {
          addConsoleMessage('success', result.message);
        } else {
          addConsoleMessage('error', result.message || '❌ Failed to terminate sandbox');
        }
      });
      await refreshSandboxStatus();
    } catch (error: any) {
      addConsoleMessage('error', `❌ Terminate error: ${error.message}`);
    }
  };

  const handleGetLogs = async () => {
    if (!ensureProjectSelected()) return;

    const parsedLines = Number(logLineCount);
    const lines = Number.isFinite(parsedLines) ? Math.min(Math.max(parsedLines, 10), 500) : 50;

    try {
      await runWithLoading(async () => {
        const result = await beamTools.getSandboxLogs(lines);
        if (result.success) {
          addConsoleMessage('info', `📋 Recent logs (${lines} lines):\n${result.data?.logs || 'No logs available'}`);
        } else {
          addConsoleMessage('error', `❌ Get logs failed: ${result.error}`);
        }
      });
    } catch (error: any) {
      addConsoleMessage('error', `❌ Get logs error: ${error.message}`);
    }
  };

  const handleGetURL = async () => {
    if (!ensureProjectSelected()) return;

    try {
      await runWithLoading(async () => {
        const result = await beamTools.getSandboxUrl();
        if (result.success) {
          const url = result.data?.url || '';
          addConsoleMessage('success', `🌐 Sandbox URL: ${url}`);
          if (url && navigator?.clipboard) {
            try {
              await navigator.clipboard.writeText(url);
              addConsoleMessage('info', '📋 URL copied to clipboard');
            } catch {
              addConsoleMessage('warning', 'Could not copy URL to clipboard automatically');
            }
          }
        } else {
          addConsoleMessage('error', `❌ Get URL failed: ${result.error}`);
        }
      });
      await refreshSandboxStatus();
    } catch (error: any) {
      addConsoleMessage('error', `❌ Get URL error: ${error.message}`);
    }
  };

  const handleSyncDApp = async (direction: SyncDirectionOption = 'ide-to-sandbox') => {
    if (!ensureProjectSelected()) return;

    try {
      await runWithLoading(async () => {
        const result = await syncDApp(direction);
        if (result.success) {
          const stats = result.data || {};
          addConsoleMessage(
            'success',
            `🔄 Sync (${direction}) completed: ${stats.uploaded ?? 0} pushed, ${stats.downloaded ?? 0} pulled, ${stats.removed ?? 0} removed`,
          );
        } else {
          addConsoleMessage('error', `❌ Sync failed: ${result.error}`);
        }
      });
      await refreshSandboxStatus();
    } catch (error: any) {
      addConsoleMessage('error', `❌ Sync error: ${error.message}`);
    }
  };

  const handleDeleteFile = async () => {
    if (!ensureProjectSelected()) return;

    if (!deleteTarget.trim()) {
      addConsoleMessage('error', 'Enter a file/folder path to delete');
      return;
    }

    if (!confirm(`Are you sure you want to delete: ${deleteTarget}?`)) {
      return;
    }

    try {
      await runWithLoading(async () => {
        const result = await fileTools.deleteFile(deleteTarget);
        if (result.success) {
          addConsoleMessage('success', `✅ Deleted: ${deleteTarget}`);
          setDeleteTarget('');
        } else {
          addConsoleMessage('error', `❌ Delete failed: ${result.error}`);
        }
      });
    } catch (error: any) {
      addConsoleMessage('error', `❌ Delete error: ${error.message}`);
    }
  };

  const handleClearDApp = async () => {
    if (!ensureProjectSelected()) return;

    if (!confirm('⚠️ This will delete ALL files in /dapp/. Continue?')) {
      return;
    }

    try {
      await runWithLoading(async () => {
        const listResult = await fileTools.listFiles('/dapp/');
        if (!listResult.success) {
          addConsoleMessage('error', `❌ Failed to list files: ${listResult.error}`);
          return;
        }

        const files = (listResult.data as Array<{ path: string }>) || [];
        let deletedCount = 0;

        for (const file of files) {
          const deleteResult = await fileTools.deleteFile(file.path);
          if (deleteResult.success) {
            deletedCount++;
          }
        }

        addConsoleMessage('success', `✅ Cleared /dapp/ - deleted ${deletedCount} files`);
      });
    } catch (error: any) {
      addConsoleMessage('error', `❌ Clear error: ${error.message}`);
    }
  };

  const handleCreateHathorDapp = async () => {
    if (!ensureProjectSelected()) return;

    const resolvedName = appName.trim() || 'hathor-dapp';
    const resolvedWC = walletConnectId.trim() || DEFAULT_WALLET_CONNECT_ID;

    try {
      await runWithLoading(async () => {
        const result = await beamTools.createHathorDapp(resolvedName, resolvedWC, network);
        if (result.success) {
          addConsoleMessage('success', result.message);
        } else {
          addConsoleMessage('error', result.message || '❌ Failed to scaffold dApp');
        }
      });
      await refreshSandboxStatus();
    } catch (error: any) {
      addConsoleMessage('error', `❌ Scaffold error: ${error.message}`);
    }
  };

  const handleUploadFiles = async () => {
    if (!ensureProjectSelected()) return;

    const paths = uploadTargets
      .split(/[\n,]+/)
      .map((path) => path.trim())
      .filter(Boolean);

    if (paths.length === 0) {
      addConsoleMessage('error', 'Provide at least one /dapp/ file path to upload');
      return;
    }

    try {
      await runWithLoading(async () => {
        const result = await beamTools.uploadFiles(paths);
        if (result.success) {
          addConsoleMessage('success', result.message);
          setUploadTargets('');
        } else {
          addConsoleMessage('error', result.message || '❌ Upload failed');
        }
      });
    } catch (error: any) {
      addConsoleMessage('error', `❌ Upload error: ${error.message}`);
    }
  };

  const handleReadSandboxFiles = async () => {
    if (!ensureProjectSelected()) return;

    try {
      await runWithLoading(async () => {
        const result = await beamTools.readSandboxFiles(readTarget.trim() || undefined);
        if (result.success) {
          addConsoleMessage('success', result.message);
        } else {
          addConsoleMessage('error', result.message || '❌ Failed to read sandbox files');
        }
      });
    } catch (error: any) {
      addConsoleMessage('error', `❌ Read error: ${error.message}`);
    }
  };

  const handleRunPodTask = async () => {
    if (!podCommand.trim()) {
      addConsoleMessage('error', 'Enter a command to run');
      return;
    }

    try {
      await runWithLoading(async () => {
        const result = await beamTools.runHeavyTask(podCommand);
        if (result.success) {
          addConsoleMessage('success', result.message);
          if (result.data?.output) {
            addConsoleMessage('info', result.data.output);
          }
          setPodCommand('');
        } else {
          addConsoleMessage('error', result.message || '❌ Pod task failed');
        }
      });
    } catch (error: any) {
      addConsoleMessage('error', `❌ Pod task error: ${error.message}`);
    }
  };

  return (
    <div className="h-full bg-gray-900 flex flex-col">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-700 bg-gray-850">
        <Terminal size={16} className="text-green-400" />
        <div>
          <p className="text-sm font-semibold text-white">dApp Manual Controls</p>
          <p className="text-xs text-gray-400">Direct access to BEAM sandbox tools</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6 bg-gray-850 pr-3">
        <Section
          title="Sandbox Status"
          description="Monitor the current BEAM sandbox and dev server state."
        >
          <div className="flex items-center justify-between rounded-lg border border-gray-700 bg-gray-800 px-4 py-3">
            <div className="flex items-center gap-3">
              <span
                className={`inline-flex h-3 w-3 rounded-full ${
                  statusLoading
                    ? 'bg-yellow-400 animate-pulse'
                    : sandboxStatus?.running
                    ? 'bg-green-500'
                    : sandboxStatus
                    ? 'bg-red-500'
                    : 'bg-gray-500'
                }`}
              />
              <div>
                <p className="text-sm font-semibold text-white">
                  {statusLoading
                    ? 'Checking status...'
                    : !activeProjectId
                    ? 'No project selected'
                    : sandboxStatus
                    ? sandboxStatus.running
                      ? 'Dev server running'
                      : 'Dev server stopped'
                    : 'No sandbox detected'}
                </p>
                <p className="text-xs text-gray-400">
                  {sandboxStatus?.url
                    ? sandboxStatus.url
                    : statusLoading
                    ? 'Refreshing...'
                    : 'Deploy to create a sandbox'}
                </p>
              </div>
            </div>
            <button
              onClick={refreshSandboxStatus}
              disabled={statusLoading || !activeProjectId}
              className="px-3 py-1.5 text-xs rounded bg-gray-700 text-white hover:bg-gray-600 disabled:opacity-50"
            >
              Refresh
            </button>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <button
              onClick={handleRestartServer}
              disabled={loading}
              className="flex items-center justify-center gap-2 px-3 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white text-sm rounded transition-colors"
            >
              <RefreshCw size={14} />
              Start / Restart
            </button>
            <button
              onClick={handleStopServer}
              disabled={loading || !sandboxStatus?.running}
              className="flex items-center justify-center gap-2 px-3 py-2 bg-red-700 hover:bg-red-800 disabled:bg-gray-600 text-white text-sm rounded transition-colors"
            >
              <X size={14} />
              Stop Server
            </button>
            <button
              onClick={() => sandboxStatus?.url && window.open(sandboxStatus.url, '_blank')}
              disabled={!sandboxStatus?.url}
              className="flex items-center justify-center gap-2 px-3 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white text-sm rounded transition-colors"
            >
              <Globe size={14} />
              Open Sandbox
            </button>
          </div>
        </Section>

          <Section
            title="Scaffolding"
            description="Use create-hathor-dapp directly inside the BEAM sandbox."
          >
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs text-gray-300">
                <Rocket size={14} className="text-pink-400" />
                <span>create-hathor-dapp (runs in sandbox /app)</span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <input
                  type="text"
                  value={appName}
                  onChange={(e) => setAppName(e.target.value)}
                  placeholder="hathor-dapp"
                  className="px-3 py-2 bg-gray-700 border border-gray-600 rounded text-sm text-white placeholder-gray-400 focus:outline-none focus:border-purple-500"
                />
                <select
                  value={network}
                  onChange={(e) => setNetwork(e.target.value as 'mainnet' | 'testnet')}
                  className="px-3 py-2 bg-gray-700 border border-gray-600 rounded text-sm text-white focus:outline-none focus:border-purple-500"
                >
                  <option value="testnet">Testnet</option>
                  <option value="mainnet">Mainnet</option>
                </select>
              </div>
              <input
                type="text"
                value={walletConnectId}
                onChange={(e) => setWalletConnectId(e.target.value)}
                placeholder="WalletConnect Project ID"
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-sm text-white placeholder-gray-400 focus:outline-none focus:border-purple-500"
              />
              <button
                onClick={handleCreateHathorDapp}
                disabled={loading}
                className="flex items-center justify-center gap-2 px-3 py-2 bg-pink-600 hover:bg-pink-700 disabled:bg-gray-600 text-white text-sm rounded transition-colors"
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : <Rocket size={14} />}
                Scaffold dApp in Sandbox
              </button>
            </div>
          </Section>

          <Section
            title="Heavy Tasks (Pods)"
            description="Run long or resource-intensive commands in isolated Beam Pods."
          >
            <div className="space-y-2">
              <label className="text-xs text-gray-400">Command to run:</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={podCommand}
                  onChange={(e) => setPodCommand(e.target.value)}
                  placeholder="pnpm build"
                  className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded text-sm text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                />
                <button
                  onClick={handleRunPodTask}
                  disabled={loading || !podCommand.trim()}
                  className="px-4 py-2 bg-blue-700 hover:bg-blue-800 disabled:bg-gray-600 text-white text-sm rounded transition-colors flex items-center gap-2"
                >
                  <Play size={14} />
                  Run Pod
                </button>
              </div>
              <p className="text-[11px] text-gray-500">
                Uses Beam Pods with dedicated timeout/retry policies. Output streams back into the console.
              </p>
            </div>
          </Section>

          <Section
            title="Sync & Transfer"
            description="Keep the IDE and sandbox (/app) in sync."
          >
            <div className="grid gap-2 sm:grid-cols-3">
              <button
                onClick={() => handleSyncDApp('ide-to-sandbox')}
                disabled={loading}
                className="flex items-center justify-center gap-2 px-3 py-2 bg-orange-600 hover:bg-orange-700 disabled:bg-gray-600 text-white text-sm rounded transition-colors text-center"
              >
                <ArrowLeftRight size={14} className="rotate-90" />
                Push IDE → Sandbox
              </button>
              <button
                onClick={() => handleSyncDApp('sandbox-to-ide')}
                disabled={loading}
                className="flex items-center justify-center gap-2 px-3 py-2 bg-teal-600 hover:bg-teal-700 disabled:bg-gray-600 text-white text-sm rounded transition-colors text-center"
              >
                <ArrowLeftRight size={14} className="-rotate-90" />
                Pull Sandbox → IDE
              </button>
              <button
                onClick={() => handleSyncDApp('bidirectional')}
                disabled={loading}
                className="flex items-center justify-center gap-2 px-3 py-2 bg-yellow-600 hover:bg-yellow-700 disabled:bg-gray-600 text-white text-sm rounded transition-colors text-center"
              >
                <RefreshCw size={14} />
                Bidirectional Sync
              </button>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-gray-400">Read sandbox files (mirrors to /dapp)</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={readTarget}
                  onChange={(e) => setReadTarget(e.target.value)}
                  placeholder="/app"
                  className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded text-sm text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                />
                <button
                  onClick={handleReadSandboxFiles}
                  disabled={loading}
                  className="px-4 py-2 bg-gray-600 hover:bg-gray-700 disabled:bg-gray-600 disabled:opacity-50 text-white text-sm rounded transition-colors flex items-center gap-2"
                >
                  <Download size={14} />
                  Read
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-gray-400">Upload IDE files (one path per line)</label>
              <textarea
                value={uploadTargets}
                onChange={(e) => setUploadTargets(e.target.value)}
                placeholder={`/dapp/app/page.tsx
/dapp/package.json`}
                rows={3}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-sm text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
              />
              <button
                onClick={handleUploadFiles}
                disabled={loading || !uploadTargets.trim()}
                className="flex items-center justify-center gap-2 px-3 py-2 bg-gray-600 hover:bg-gray-700 disabled:bg-gray-600 disabled:opacity-50 text-white text-sm rounded transition-colors"
              >
                <Upload size={14} />
                Upload Selected Files
              </button>
            </div>
          </Section>

          <Section
            title="Runtime & Logs"
            description="Control deployments and inspect sandbox output."
          >
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                onClick={handleDeploy}
                disabled={loading}
                className="flex items-center justify-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white text-sm rounded transition-colors"
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                Deploy & Sync
              </button>
              <button
                onClick={handleGetURL}
                disabled={loading}
                className="flex items-center justify-center gap-2 px-3 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white text-sm rounded transition-colors"
              >
                <Globe size={14} />
                Get Sandbox URL
              </button>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <span>Log lines:</span>
                <input
                  type="number"
                  min={10}
                  max={500}
                  value={logLineCount}
                  onChange={(e) => setLogLineCount(e.target.value)}
                  className="w-20 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-sm text-white focus:outline-none focus:border-gray-400"
                />
              </div>
              <button
                onClick={handleGetLogs}
                disabled={loading}
                className="flex items-center justify-center gap-2 px-3 py-2 bg-gray-600 hover:bg-gray-700 disabled:bg-gray-600 text-white text-sm rounded transition-colors"
              >
                <FileText size={14} />
                Fetch Logs
              </button>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-gray-400">Run Custom Command (executes inside /app)</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={customCommand}
                  onChange={(e) => setCustomCommand(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !loading && handleRunCommand()}
                  placeholder="npm install package-name"
                  className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded text-sm text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                />
                <button
                  onClick={handleRunCommand}
                  disabled={loading || !customCommand.trim()}
                  className="px-4 py-2 bg-gray-600 hover:bg-gray-700 disabled:bg-gray-600 disabled:opacity-50 text-white text-sm rounded transition-colors flex items-center gap-2"
                >
                  <Terminal size={14} />
                  Run
                </button>
              </div>
            </div>
          </Section>

          <Section
            title="File Management"
            description="Delete IDE files or wipe sandbox directories."
          >
            <div className="space-y-2">
              <label className="text-xs text-gray-400">Delete File/Folder (IDE)</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={deleteTarget}
                  onChange={(e) => setDeleteTarget(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !loading && handleDeleteFile()}
                  placeholder="/dapp/components/MyComponent.tsx"
                  className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded text-sm text-white placeholder-gray-400 focus:outline-none focus:border-red-500"
                />
                <button
                  onClick={handleDeleteFile}
                  disabled={loading || !deleteTarget.trim()}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-600 disabled:opacity-50 text-white text-sm rounded transition-colors flex items-center gap-2"
                >
                  <Trash2 size={14} />
                  Delete
                </button>
              </div>
            </div>

            <div className="space-y-2 pt-2 border-t border-red-900">
              <button
                onClick={handleTerminateSandbox}
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-red-700 hover:bg-red-800 disabled:bg-gray-600 text-white text-sm rounded transition-colors"
              >
                <Trash2 size={14} />
                Terminate Sandbox
              </button>
              <button
                onClick={handleClearDApp}
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-600 text-white text-sm rounded transition-colors"
              >
                <X size={14} />
                Clear /dapp Directory
              </button>
              <button
                onClick={async () => {
                  if (!activeProjectId || isPurging) return;
                  const confirmed = confirm('This will delete ALL files inside the BEAM sandbox /app directory. Continue?');
                  if (!confirmed) return;
                  setIsPurging(true);
                  const result = await beamTools.purgeSandbox();
                  if (result.success) {
                    addConsoleMessage('success', result.message);
                  } else {
                    addConsoleMessage('error', result.message);
                  }
                  setIsPurging(false);
                }}
                disabled={isPurging || loading}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-red-800 hover:bg-red-900 disabled:bg-gray-600 text-white text-sm rounded transition-colors"
              >
                {isPurging ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Purging Sandbox...
                  </>
                ) : (
                  <>
                    <Trash2 size={14} />
                    Purge Sandbox (/app)
                  </>
                )}
              </button>
            </div>
          </Section>

        {!activeProjectId && (
          <div className="text-xs text-yellow-400 text-center">
            ⚠️ No active project selected
          </div>
        )}
      </div>
    </div>
  );
};
