'use client';

import React, { useState, useEffect } from 'react';
import { 
  GitBranch, 
  GitCommit, 
  GitMerge, 
  History, 
  Plus, 
  RotateCcw,
  Upload,
  Download,
  Settings,
  ChevronDown,
  ChevronRight,
  FileText
} from 'lucide-react';
import { useIDEStore } from '@/store/ide-store';
import { pyodideRunner } from '@/lib/pyodide-runner';
import { clsx } from 'clsx';

interface GitStatus {
  currentBranch: string;
  branches: string[];
  commits: any[];
  hasChanges: boolean;
}

export const GitPanel: React.FC = () => {
  const store = useIDEStore();
  const { 
    files, 
    activeFileId
  } = store;
  
  // Destructure git methods separately to debug
  const {
    commitChanges, 
    getCommitHistory, 
    checkoutVersion, 
    listBranches, 
    createBranch, 
    switchBranch,
    pushToRemote,
    setGitRemote,
    initGit
  } = store;

  const [gitStatus, setGitStatus] = useState<GitStatus>({
    currentBranch: 'master',
    branches: ['master'],
    commits: [],
    hasChanges: true
  });
  
  const [isInitialized, setIsInitialized] = useState(false);
  const [isPyodideReady, setIsPyodideReady] = useState(false);

  const [isExpanded, setIsExpanded] = useState(true);
  const [commitMessage, setCommitMessage] = useState('');
  const [showBranchInput, setShowBranchInput] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [showRemoteInput, setShowRemoteInput] = useState(false);
  const [remoteUrl, setRemoteUrl] = useState('');
  const [showPushInput, setShowPushInput] = useState(false);
  const [pushCredentials, setPushCredentials] = useState({ username: '', password: '' });

  const activeFile = files.find(f => f.id === activeFileId);

  // Check Pyodide readiness
  useEffect(() => {
    const checkPyodideStatus = () => {
      const ready = pyodideRunner.isReady();
      console.log('Pyodide ready status:', ready);
      setIsPyodideReady(ready);
      
      if (ready && activeFile && !isInitialized) {
        console.log('Pyodide is ready, loading git status');
        loadGitStatus();
      }
    };
    
    checkPyodideStatus();
    
    // Poll for Pyodide readiness if not ready yet
    if (!isPyodideReady) {
      const interval = setInterval(checkPyodideStatus, 1000);
      return () => clearInterval(interval);
    }
  }, [activeFileId, isPyodideReady, isInitialized]);

  useEffect(() => {
    console.log('GitPanel mounted/updated', {
      activeFileId,
      filesLength: files.length,
      isPyodideReady,
      isInitialized,
      storeHookWorks: typeof commitChanges === 'function'
    });
  }, [activeFileId, isPyodideReady]);

  const loadGitStatus = async () => {
    if (!activeFile) return;
    
    // Wait for Pyodide to be ready before initializing git
    if (!isPyodideReady) {
      console.log('Waiting for Pyodide to be ready before loading git status');
      return;
    }
    
    try {
      // Initialize git first if not already done
      if (!isInitialized) {
        console.log('Initializing git after Pyodide is ready');
        await initGit();
        setIsInitialized(true);
      }
      
      const [branches, commits] = await Promise.all([
        listBranches(),
        getCommitHistory()
      ]);

      console.log('Git status loaded:', { branches, commits, branchesLength: branches?.length });

      // Ensure we have at least 'master' branch
      const availableBranches = branches && branches.length > 0 ? branches : ['master'];
      const currentBranch = availableBranches.includes('master') ? 'master' : availableBranches[0];
      
      console.log('Setting git status:', { currentBranch, availableBranches });

      setGitStatus({
        currentBranch,
        branches: availableBranches,
        commits: commits || [],
        hasChanges: true // Assume there are changes for now
      });
    } catch (error) {
      console.error('Failed to load git status:', error);
      // Set default values on error
      setGitStatus({
        currentBranch: 'master',
        branches: ['master'],
        commits: [],
        hasChanges: true
      });
    }
  };

  const handleCommit = async () => {
    console.log('handleCommit called', { commitMessage, activeFile, commitChanges });
    if (!commitMessage.trim() || !activeFile) {
      console.log('Early return - no message or no file');
      return;
    }

    try {
      console.log('About to call commitChanges with message:', commitMessage);
      console.log('commitChanges function exists:', typeof commitChanges === 'function');
      await commitChanges(commitMessage);
      setCommitMessage('');
      await loadGitStatus();
      console.log('Commit successful');
    } catch (error) {
      console.error('Commit failed:', error);
    }
  };

  const handleCreateBranch = async () => {
    if (!newBranchName.trim()) return;

    try {
      console.log('Creating branch:', newBranchName);
      await createBranch(newBranchName);
      
      // Optimistically update the UI with the new branch
      setGitStatus(prev => ({
        ...prev,
        branches: [...prev.branches, newBranchName],
        currentBranch: newBranchName
      }));
      
      setNewBranchName('');
      setShowBranchInput(false);
      
      // Reload git status after a short delay
      setTimeout(() => loadGitStatus(), 100);
      console.log('Branch created successfully');
    } catch (error) {
      console.error('Create branch failed:', error);
    }
  };

  const handleSwitchBranch = async (branchName: string) => {
    if (!activeFile) return;

    try {
      await switchBranch(branchName);
      await loadGitStatus();
    } catch (error) {
      console.error('Switch branch failed:', error);
    }
  };

  const handleSetRemote = async () => {
    if (!remoteUrl.trim()) return;

    try {
      await setGitRemote(remoteUrl);
      setRemoteUrl('');
      setShowRemoteInput(false);
    } catch (error) {
      console.error('Set remote failed:', error);
    }
  };

  const handlePush = async () => {
    try {
      await pushToRemote(pushCredentials.username, pushCredentials.password);
      setPushCredentials({ username: '', password: '' });
      setShowPushInput(false);
    } catch (error) {
      console.error('Push failed:', error);
    }
  };

  const formatCommitDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (!activeFile) {
    return (
      <div className="h-full bg-gray-900 text-gray-400 p-4">
        <div className="text-center text-sm">
          Select a file to view git status
        </div>
      </div>
    );
  }

  if (!isPyodideReady) {
    return (
      <div className="h-full bg-gray-900 text-gray-400 p-4">
        <div className="text-center text-sm">
          <div className="animate-pulse">⏳ Waiting for Python environment...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full bg-gray-900 text-gray-100 border-t border-gray-700">
      {/* Header */}
      <div className="p-3 border-b border-gray-700">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-2 w-full hover:text-blue-400 transition-colors"
        >
          {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <GitBranch size={16} />
          <span className="text-sm font-medium">Source Control</span>
        </button>
      </div>

      {isExpanded && (
        <div className="p-3 space-y-4">
          {/* Current Branch & Actions */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm">
                <GitBranch size={14} />
                <select
                  value={gitStatus.currentBranch || 'master'}
                  onChange={(e) => handleSwitchBranch(e.target.value)}
                  className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-500 min-w-[80px]"
                >
                  {(gitStatus.branches.length > 0 ? gitStatus.branches : ['master']).map((branch, index) => {
                    console.log(`Rendering branch option ${index}:`, branch);
                    return <option key={branch} value={branch}>{branch}</option>
                  })}
                </select>
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => setShowBranchInput(!showBranchInput)}
                  className="p-1 hover:bg-gray-800 rounded transition-colors"
                  title="New Branch"
                >
                  <Plus size={14} />
                </button>
                <button
                  onClick={() => setShowRemoteInput(!showRemoteInput)}
                  className="p-1 hover:bg-gray-800 rounded transition-colors"
                  title="Remote Settings"
                >
                  <Settings size={14} />
                </button>
              </div>
            </div>

            {showBranchInput && (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newBranchName}
                  onChange={(e) => setNewBranchName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateBranch();
                    if (e.key === 'Escape') setShowBranchInput(false);
                  }}
                  placeholder="branch-name"
                  className="flex-1 px-2 py-1 text-xs bg-gray-800 border border-gray-600 rounded focus:outline-none focus:border-blue-500"
                  autoFocus
                />
                <button
                  onClick={handleCreateBranch}
                  className="px-2 py-1 bg-blue-600 hover:bg-blue-700 rounded text-xs transition-colors"
                >
                  Create
                </button>
              </div>
            )}

            {showRemoteInput && (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={remoteUrl}
                  onChange={(e) => setRemoteUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSetRemote();
                    if (e.key === 'Escape') setShowRemoteInput(false);
                  }}
                  placeholder="https://github.com/user/repo.git"
                  className="flex-1 px-2 py-1 text-xs bg-gray-800 border border-gray-600 rounded focus:outline-none focus:border-blue-500"
                  autoFocus
                />
                <button
                  onClick={handleSetRemote}
                  className="px-2 py-1 bg-blue-600 hover:bg-blue-700 rounded text-xs transition-colors"
                >
                  Set
                </button>
              </div>
            )}
          </div>

          {/* Changes Section */}
          <div className="space-y-2">
            <div className="text-xs text-gray-400 uppercase tracking-wide">Changes</div>
            <div className="space-y-1">
              <div className="flex items-center gap-2 px-2 py-1 bg-gray-800 rounded text-sm">
                <FileText size={12} className="text-orange-400" />
                <span className="text-orange-400">M</span>
                <span className="truncate">{activeFile.name}</span>
              </div>
            </div>
          </div>

          {/* Commit Section */}
          <div className="space-y-2">
            <textarea
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              placeholder="Enter commit message..."
              className="w-full h-16 px-2 py-1 text-xs bg-gray-800 border border-gray-600 rounded resize-none focus:outline-none focus:border-blue-500"
            />
            <div className="flex gap-2">
              <button
                onClick={handleCommit}
                disabled={!commitMessage.trim()}
                className={clsx(
                  "flex-1 flex items-center justify-center gap-2 px-3 py-1.5 rounded text-xs font-medium transition-colors",
                  commitMessage.trim()
                    ? "bg-blue-600 hover:bg-blue-700 text-white"
                    : "bg-gray-700 text-gray-400 cursor-not-allowed"
                )}
              >
                <GitCommit size={14} />
                Commit
              </button>
              <button
                onClick={() => setShowPushInput(!showPushInput)}
                className="px-3 py-1.5 bg-green-600 hover:bg-green-700 rounded text-xs font-medium transition-colors flex items-center gap-1"
                title="Push to Remote"
              >
                <Upload size={14} />
                Push
              </button>
            </div>

            {showPushInput && (
              <div className="space-y-2 p-2 bg-gray-800 rounded">
                <input
                  type="text"
                  value={pushCredentials.username}
                  onChange={(e) => setPushCredentials(prev => ({ ...prev, username: e.target.value }))}
                  placeholder="Username"
                  className="w-full px-2 py-1 text-xs bg-gray-700 border border-gray-600 rounded focus:outline-none focus:border-blue-500"
                />
                <input
                  type="password"
                  value={pushCredentials.password}
                  onChange={(e) => setPushCredentials(prev => ({ ...prev, password: e.target.value }))}
                  placeholder="Password/Token"
                  className="w-full px-2 py-1 text-xs bg-gray-700 border border-gray-600 rounded focus:outline-none focus:border-blue-500"
                />
                <div className="flex gap-2">
                  <button
                    onClick={handlePush}
                    className="flex-1 px-2 py-1 bg-green-600 hover:bg-green-700 rounded text-xs transition-colors"
                  >
                    Push
                  </button>
                  <button
                    onClick={() => setShowPushInput(false)}
                    className="px-2 py-1 bg-gray-600 hover:bg-gray-700 rounded text-xs transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* History Section */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <History size={14} />
              <span className="text-xs text-gray-400 uppercase tracking-wide">History</span>
            </div>
            <div className="max-h-32 overflow-y-auto space-y-1">
              {gitStatus.commits.slice(0, 5).map((commit, index) => (
                <div
                  key={commit.oid}
                  className="px-2 py-1 bg-gray-800 rounded text-xs hover:bg-gray-700 cursor-pointer transition-colors"
                  onClick={() => checkoutVersion(commit.oid)}
                >
                  <div className="font-mono text-blue-400">
                    {commit.oid.substring(0, 7)}
                  </div>
                  <div className="truncate text-gray-300">
                    {commit.commit.message}
                  </div>
                  <div className="text-gray-500 text-xs">
                    {formatCommitDate(commit.commit.author.timestamp)}
                  </div>
                </div>
              ))}
              {gitStatus.commits.length === 0 && (
                <div className="text-xs text-gray-500 text-center py-2">
                  No commits yet
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};