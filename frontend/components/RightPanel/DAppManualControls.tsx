'use client';

import React, { useState } from 'react';
import {
  Play,
  Terminal,
  RefreshCw,
  FileText,
  Globe,
  Trash2,
  Folder,
  ChevronDown,
  ChevronUp,
  Loader2,
  X,
  ArrowLeftRight,
} from 'lucide-react';
import { useIDEStore } from '@/store/ide-store';
import { AIToolsClient } from '@/lib/ai-tools-client';

export const DAppManualControls: React.FC = () => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [customCommand, setCustomCommand] = useState('');
  const [deleteTarget, setDeleteTarget] = useState('');
  const { activeProjectId, addConsoleMessage } = useIDEStore();

  const handleDeploy = async () => {
    if (!activeProjectId) {
      addConsoleMessage('error', 'No active project');
      return;
    }

    setLoading(true);
    try {
      const result = await AIToolsClient.deployDApp(activeProjectId);
      if (result.success) {
        addConsoleMessage('success', `✅ dApp deployed: ${result.url}`);
      } else {
        addConsoleMessage('error', `❌ Deploy failed: ${result.error}`);
      }
    } catch (error: any) {
      addConsoleMessage('error', `❌ Deploy error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleRunCommand = async () => {
    if (!activeProjectId) {
      addConsoleMessage('error', 'No active project');
      return;
    }

    if (!customCommand.trim()) {
      addConsoleMessage('error', 'Enter a command to run');
      return;
    }

    setLoading(true);
    try {
      const result = await AIToolsClient.runCommand(activeProjectId, customCommand);
      if (result.success) {
        addConsoleMessage('success', `✅ Command executed\n${result.output?.stdout || ''}`);
        if (result.output?.stderr) {
          addConsoleMessage('warning', `stderr: ${result.output.stderr}`);
        }
      } else {
        addConsoleMessage('error', `❌ Command failed: ${result.error}`);
      }
    } catch (error: any) {
      addConsoleMessage('error', `❌ Command error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleRestartServer = async () => {
    if (!activeProjectId) {
      addConsoleMessage('error', 'No active project');
      return;
    }

    setLoading(true);
    try {
      const result = await AIToolsClient.restartDevServer(activeProjectId);
      if (result.success) {
        addConsoleMessage('success', '✅ Dev server restarted');
      } else {
        addConsoleMessage('error', `❌ Restart failed: ${result.error}`);
      }
    } catch (error: any) {
      addConsoleMessage('error', `❌ Restart error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleGetLogs = async () => {
    if (!activeProjectId) {
      addConsoleMessage('error', 'No active project');
      return;
    }

    setLoading(true);
    try {
      const result = await AIToolsClient.getSandboxLogs(activeProjectId, 50);
      if (result.success) {
        addConsoleMessage('info', `📋 Recent logs:\n${result.logs || 'No logs available'}`);
      } else {
        addConsoleMessage('error', `❌ Get logs failed: ${result.error}`);
      }
    } catch (error: any) {
      addConsoleMessage('error', `❌ Get logs error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleGetURL = async () => {
    if (!activeProjectId) {
      addConsoleMessage('error', 'No active project');
      return;
    }

    setLoading(true);
    try {
      const result = await AIToolsClient.getSandboxUrl(activeProjectId);
      if (result.success) {
        addConsoleMessage('success', `🌐 Sandbox URL: ${result.url}`);
        // Copy to clipboard
        navigator.clipboard.writeText(result.url || '');
      } else {
        addConsoleMessage('error', `❌ Get URL failed: ${result.error}`);
      }
    } catch (error: any) {
      addConsoleMessage('error', `❌ Get URL error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSyncDApp = async (bidirectional = false) => {
    if (!activeProjectId) {
      addConsoleMessage('error', 'No active project');
      return;
    }

    setLoading(true);
    try {
      const direction = bidirectional ? 'bidirectional' : 'ide-to-sandbox';
      const result = await AIToolsClient.syncDApp(direction);
      if (result.success) {
        addConsoleMessage('success', `🔄 Sync completed: ${result.changes_applied} changes`);
      } else {
        addConsoleMessage('error', `❌ Sync failed: ${result.error}`);
      }
    } catch (error: any) {
      addConsoleMessage('error', `❌ Sync error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteFile = async () => {
    if (!activeProjectId) {
      addConsoleMessage('error', 'No active project');
      return;
    }

    if (!deleteTarget.trim()) {
      addConsoleMessage('error', 'Enter a file/folder path to delete');
      return;
    }

    if (!confirm(`Are you sure you want to delete: ${deleteTarget}?`)) {
      return;
    }

    setLoading(true);
    try {
      const result = await AIToolsClient.deleteFile(activeProjectId, deleteTarget);
      if (result.success) {
        addConsoleMessage('success', `✅ Deleted: ${deleteTarget}`);
        setDeleteTarget('');
      } else {
        addConsoleMessage('error', `❌ Delete failed: ${result.error}`);
      }
    } catch (error: any) {
      addConsoleMessage('error', `❌ Delete error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleClearDApp = async () => {
    if (!activeProjectId) {
      addConsoleMessage('error', 'No active project');
      return;
    }

    if (!confirm('⚠️ This will delete ALL files in /dapp/. Continue?')) {
      return;
    }

    setLoading(true);
    try {
      // List all files in /dapp/
      const listResult = await AIToolsClient.listFiles(activeProjectId, '/dapp/');
      if (!listResult.success) {
        addConsoleMessage('error', `❌ Failed to list files: ${listResult.error}`);
        return;
      }

      const files = listResult.files || [];
      let deletedCount = 0;

      for (const file of files) {
        const deleteResult = await AIToolsClient.deleteFile(activeProjectId, file);
        if (deleteResult.success) {
          deletedCount++;
        }
      }

      addConsoleMessage('success', `✅ Cleared /dapp/ - deleted ${deletedCount} files`);
    } catch (error: any) {
      addConsoleMessage('error', `❌ Clear error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="border-b border-gray-700 bg-gray-800">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-4 py-2 text-sm font-medium text-gray-200 hover:bg-gray-700 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Terminal size={16} />
          <span>dApp Manual Controls</span>
        </div>
        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>

      {/* Expanded Controls */}
      {isExpanded && (
        <div className="p-4 space-y-4 bg-gray-850">
          {/* Quick Actions Row */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={handleDeploy}
              disabled={loading}
              className="flex items-center justify-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white text-sm rounded transition-colors"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              Deploy
            </button>

            <button
              onClick={() => handleSyncDApp(false)}
              disabled={loading}
              className="flex items-center justify-center gap-2 px-3 py-2 bg-orange-600 hover:bg-orange-700 disabled:bg-gray-600 text-white text-sm rounded transition-colors"
              title="Sync IDE files to sandbox"
            >
              <ArrowLeftRight size={14} />
              Push to Sandbox
            </button>
          </div>

          {/* Sync Options */}
          <div className="grid grid-cols-1 gap-2">
            <button
              onClick={() => handleSyncDApp(true)}
              disabled={loading}
              className="flex items-center justify-center gap-2 px-3 py-2 bg-yellow-600 hover:bg-yellow-700 disabled:bg-gray-600 text-white text-sm rounded transition-colors"
              title="Bidirectional sync (merge both directions)"
            >
              <RefreshCw size={14} />
              Bidirectional Sync
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={handleRestartServer}
              disabled={loading}
              className="flex items-center justify-center gap-2 px-3 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white text-sm rounded transition-colors"
            >
              <RefreshCw size={14} />
              Restart
            </button>

            <button
              onClick={handleGetURL}
              disabled={loading}
              className="flex items-center justify-center gap-2 px-3 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white text-sm rounded transition-colors"
            >
              <Globe size={14} />
              Get URL
            </button>
          </div>

          <div className="grid grid-cols-1 gap-2">
            <button
              onClick={handleGetLogs}
              disabled={loading}
              className="flex items-center justify-center gap-2 px-3 py-2 bg-gray-600 hover:bg-gray-700 disabled:bg-gray-600 text-white text-sm rounded transition-colors"
            >
              <FileText size={14} />
              View Logs (50 lines)
            </button>
          </div>

          {/* Run Command Section */}
          <div className="space-y-2">
            <label className="text-xs text-gray-400">Run Custom Command:</label>
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
                className="px-4 py-2 bg-gray-600 hover:bg-gray-700 disabled:bg-gray-600 disabled:opacity-50 text-white text-sm rounded transition-colors"
              >
                Run
              </button>
            </div>
          </div>

          {/* Delete File Section */}
          <div className="space-y-2 pt-2 border-t border-gray-700">
            <label className="text-xs text-gray-400">Delete File/Folder:</label>
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

          {/* Danger Zone */}
          <div className="pt-2 border-t border-red-900">
            <button
              onClick={handleClearDApp}
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-600 text-white text-sm rounded transition-colors"
            >
              <X size={14} />
              Clear /dapp/ Directory
            </button>
          </div>

          {!activeProjectId && (
            <div className="text-xs text-yellow-400 text-center">
              ⚠️ No active project selected
            </div>
          )}
        </div>
      )}
    </div>
  );
};
