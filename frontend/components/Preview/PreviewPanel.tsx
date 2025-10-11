'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { ExternalLink, RotateCcw, Loader2 } from 'lucide-react';
import { useIDEStore } from '@/store/ide-store';

export const PreviewPanel: React.FC = () => {
  const { activeProjectId } = useIDEStore();
  const [iframeUrl, setIframeUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [iframeReady, setIframeReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Load sandbox URL for active project
  useEffect(() => {
    if (!activeProjectId) {
      setIframeUrl(null);
      return;
    }

    const loadSandbox = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/beam/sandbox/${activeProjectId}`);

        if (response.ok) {
          const data = await response.json();
          if (data && data.url) {
            setIframeUrl(data.url);
          } else {
            setIframeUrl(null);
          }
        } else {
          setIframeUrl(null);
        }
      } catch (err) {
        console.error('Failed to load sandbox:', err);
        setError(err instanceof Error ? err.message : 'Failed to load preview');
      } finally {
        setIsLoading(false);
      }
    };

    loadSandbox();

    // Subscribe to sandbox events (SSE) for real-time URL updates
    const eventSource = new EventSource(`/api/beam/sandbox/${activeProjectId}/events`);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'sandbox_ready' || data.type === 'sandbox_updated') {
          console.log('Sandbox URL updated:', data.url);
          setIframeUrl(data.url);
          setError(null);
        } else if (data.type === 'sandbox_removed') {
          console.log('Sandbox removed');
          setIframeUrl(null);
        }
      } catch (err) {
        console.error('Failed to parse SSE event:', err);
      }
    };

    eventSource.onerror = (err) => {
      console.error('SSE connection error:', err);
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, [activeProjectId]);

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
    return (
      <div className="h-full bg-gray-900 flex items-center justify-center p-8">
        <div className="text-center max-w-md">
          <p className="text-gray-400 mb-4">No preview available</p>
          <p className="text-gray-500 text-sm">
            Create files in the dapp/ folder to deploy your frontend
          </p>
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
