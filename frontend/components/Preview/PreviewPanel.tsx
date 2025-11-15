'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { ExternalLink, RotateCcw, Loader2 } from 'lucide-react';
import { useIDEStore } from '@/store/ide-store';

export const PreviewPanel: React.FC = () => {
  const { activeProjectId, files, sandboxUrls, setSandboxUrl } = useIDEStore();
  const [iframeUrl, setIframeUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [iframeReady, setIframeReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDeploying, setIsDeploying] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const storedSandboxUrl = activeProjectId ? sandboxUrls[activeProjectId] || null : null;

  useEffect(() => {
    if (!activeProjectId) {
      setIframeUrl(null);
      return;
    }
    setIframeUrl(storedSandboxUrl);
  }, [activeProjectId, storedSandboxUrl]);

  // Load sandbox URL for active project if missing
  useEffect(() => {
    if (!activeProjectId) {
      return;
    }

    const loadSandbox = async () => {
      setError(null);

      try {
        const response = await fetch(`/api/beam/sandbox/${activeProjectId}`);

        if (response.ok) {
          const data = await response.json();
          if (data && data.url) {
            setSandboxUrl(activeProjectId, data.url);
          } else {
            setSandboxUrl(activeProjectId, null);
          }
        } else {
          setSandboxUrl(activeProjectId, null);
        }
      } catch (err) {
        console.error('Failed to load sandbox:', err);
        setError(err instanceof Error ? err.message : 'Failed to load preview');
      }
    };

    if (!storedSandboxUrl) {
      setIsLoading(true);
      loadSandbox().finally(() => setIsLoading(false));
    }
  }, [activeProjectId, storedSandboxUrl, setSandboxUrl]);

  // Subscribe to sandbox events (SSE) for real-time URL updates
  useEffect(() => {
    if (!activeProjectId) {
      return;
    }

    const events = new EventSource(`/api/beam/sandbox/${activeProjectId}/events`);

    events.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'sandbox_ready' || data.type === 'sandbox_updated') {
          setSandboxUrl(activeProjectId, data.url);
          setError(null);
        } else if (data.type === 'sandbox_removed') {
          setSandboxUrl(activeProjectId, null);
        }
      } catch (err) {
        console.error('Failed to parse sandbox event:', err);
      }
    };

    events.onerror = (err) => {
      console.warn('Sandbox event stream error:', err);
      events.close();
    };

    return () => {
      events.close();
    };
  }, [activeProjectId, setSandboxUrl]);

  const refreshIframe = useCallback(() => {
    if (iframeRef.current && iframeUrl) {
      setIframeReady(false);
      const currentSrc = iframeRef.current.src;
      iframeRef.current.src = '';

      setTimeout(() => {
        if (iframeRef.current) {
          iframeRef.current.src = currentSrc;
        }
      }, 300);
    }
  }, [iframeUrl]);

  const handleIframeLoad = () => {
    console.log('Iframe loaded successfully:', iframeUrl);
    setIframeReady(true);
  };

  const handleIframeError = () => {
    console.error('Iframe failed to load:', iframeUrl);
    setError('Failed to load preview');
  };

  const handleDeployProject = async () => {
    if (!activeProjectId || isDeploying) return;

    setIsDeploying(true);
    setError(null);

    try {
      // Get dApp files only
      const dappFiles: Record<string, string> = {};
      files.forEach((file) => {
        if (file.path.startsWith('/dapp/')) {
          dappFiles[file.path] = file.content;
        }
      });

      if (Object.keys(dappFiles).length === 0) {
        setError('No dApp files found. Create files in /dapp/ folder first.');
        setIsDeploying(false);
        return;
      }

      console.log(`Deploying ${Object.keys(dappFiles).length} files to sandbox...`);

      // Upload files and start dev server
      const response = await fetch('/api/beam/sandbox/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: activeProjectId,
          files: dappFiles,
          auto_start: true,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to deploy project');
      }

      // Wait a moment for server to start
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Fetch the new sandbox URL
      const sandboxResponse = await fetch(`/api/beam/sandbox/${activeProjectId}`);
      if (sandboxResponse.ok) {
        const data = await sandboxResponse.json();
        if (data && data.url) {
          setIframeUrl(data.url);
          console.log('Project deployed successfully:', data.url);
        }
      }
    } catch (err) {
      console.error('Deploy error:', err);
      setError(err instanceof Error ? err.message : 'Failed to deploy project');
    } finally {
      setIsDeploying(false);
    }
  };

  if (!activeProjectId) {
    return (
      <div className="h-full bg-gray-900 flex items-center justify-center p-8">
        <div className="text-center">
          <p className="text-gray-400">No project selected</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="h-full bg-gray-900 flex items-center justify-center p-8">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-blue-500 animate-spin mx-auto mb-4" />
          <p className="text-gray-400">Loading preview...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full bg-gray-900 flex items-center justify-center p-8">
        <div className="text-center">
          <p className="text-red-400 mb-4">{error}</p>
          <p className="text-gray-500 text-sm">
            Make sure you have dApp files and the server is running
          </p>
        </div>
      </div>
    );
  }

  if (!iframeUrl) {
    // Check if there are dApp files
    const hasDappFiles = files.some((f) => f.path.startsWith('/dapp/'));

    return (
      <div className="h-full bg-gray-900 flex items-center justify-center p-8">
        <div className="text-center max-w-md">
          <p className="text-gray-400 mb-4">No preview available</p>
          {hasDappFiles ? (
            <>
              <p className="text-gray-500 text-sm mb-6">
                {error
                  ? 'Deployment failed. Try again or check the console for details.'
                  : 'Your dApp files are ready. Deploy them to start the preview.'
                }
              </p>
              <button
                onClick={handleDeployProject}
                disabled={isDeploying}
                className="px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 mx-auto"
              >
                {isDeploying ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    <span>Deploying...</span>
                  </>
                ) : error ? (
                  <>
                    <RotateCcw size={18} />
                    <span>Retry Deploy</span>
                  </>
                ) : (
                  <>
                    <ExternalLink size={18} />
                    <span>Deploy Project</span>
                  </>
                )}
              </button>
              {error && (
                <div className="mt-4 p-3 bg-red-900/20 border border-red-700/30 rounded-lg">
                  <p className="text-red-400 text-sm font-medium mb-1">Deployment Error</p>
                  <p className="text-red-300 text-xs">{error}</p>
                </div>
              )}
            </>
          ) : (
            <>
              <p className="text-gray-500 text-sm mb-4">
                Create files in the /dapp/ folder to deploy your frontend.
              </p>
              <p className="text-xs text-gray-600">
                Tip: Use the AI Agent tab and say "create a Next.js app" or "bootstrap my project"
              </p>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full bg-gray-900 flex flex-col">
      {/* URL Bar */}
      <div className="flex items-center bg-gray-800 border-b border-gray-700 px-4 py-2 gap-2">
        <button
          onClick={refreshIframe}
          className="p-1.5 hover:bg-gray-700 rounded transition-colors"
          title="Refresh Preview"
        >
          <RotateCcw size={16} className="text-gray-400" />
        </button>

        <input
          type="text"
          value={iframeUrl}
          readOnly
          className="flex-1 bg-gray-700 text-gray-300 text-sm px-3 py-1.5 rounded border-none outline-none"
        />

        <a
          href={iframeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="p-1.5 hover:bg-gray-700 rounded transition-colors"
          title="Open in New Tab"
        >
          <ExternalLink size={16} className="text-gray-400" />
        </a>
      </div>

      {/* Preview Area */}
      <div className="flex-1 relative">
        {!iframeReady && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-900 z-10">
            <div className="text-center">
              <Loader2 className="w-8 h-8 text-blue-500 animate-spin mx-auto mb-2" />
              <p className="text-gray-400 text-sm">Loading preview...</p>
            </div>
          </div>
        )}

        <iframe
          ref={iframeRef}
          src={iframeUrl}
          className="w-full h-full border-none bg-white"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
          allow="fullscreen"
          onLoad={handleIframeLoad}
          onError={handleIframeError}
          style={{ visibility: iframeReady ? 'visible' : 'hidden' }}
        />
      </div>
    </div>
  );
};
