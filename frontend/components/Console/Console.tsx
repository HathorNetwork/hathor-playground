'use client';

import React, { useEffect, useRef } from 'react';
import { Terminal, Trash2, AlertCircle, CheckCircle, Info, AlertTriangle, TestTube } from 'lucide-react';
import { useIDEStore, ConsoleMessage, File } from '@/store/ide-store';
import { beamClient } from '@/lib/beam-client';
import { clsx } from 'clsx';

interface ConsoleProps {
  onRunTests: () => void;
}

export const Console: React.FC<ConsoleProps> = ({ onRunTests }) => {
  const { consoleMessages, clearConsole, files, activeFileId, isRunningTests, activeProjectId, addConsoleMessage } = useIDEStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const [isStreamingLogs, setIsStreamingLogs] = React.useState(false);

  const activeFile = files.find((f) => f.id === activeFileId);

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [consoleMessages]);

  // Stream Beam logs when project is active
  useEffect(() => {
    if (!activeProjectId) {
      setIsStreamingLogs(false);
      return;
    }

    // Connect to log stream
    console.log('Connecting to Beam log stream for project:', activeProjectId);
    setIsStreamingLogs(true);

    try {
      eventSourceRef.current = beamClient.streamLogs(
        activeProjectId,
        (log) => {
          // Add streamed log to console
          addConsoleMessage('info', log);
        },
        (error) => {
          console.error('Failed to stream logs:', error);
          setIsStreamingLogs(false);
          // Show user-friendly error message
          addConsoleMessage('warning', 'Log streaming disconnected. Logs will appear when dev server is running.');
        }
      );
    } catch (error) {
      console.error('Error setting up log stream:', error);
      setIsStreamingLogs(false);
      addConsoleMessage('error', `Failed to setup log stream: ${error}`);
    }

    // Cleanup on unmount or project change
    return () => {
      if (eventSourceRef.current) {
        console.log('Disconnecting from Beam log stream');
        eventSourceRef.current.close();
        eventSourceRef.current = null;
        setIsStreamingLogs(false);
      }
    };
  }, [activeProjectId, addConsoleMessage]);

  const getIcon = (type: string) => {
    switch (type) {
      case 'error':
        return <AlertCircle size={14} className="text-red-400" />;
      case 'warning':
        return <AlertTriangle size={14} className="text-yellow-400" />;
      case 'success':
        return <CheckCircle size={14} className="text-green-400" />;
      default:
        return <Info size={14} className="text-blue-400" />;
    }
  };

  const getMessageClass = (type: string) => {
    switch (type) {
      case 'error':
        return 'text-red-300';
      case 'warning':
        return 'text-yellow-300';
      case 'success':
        return 'text-green-300';
      default:
        return 'text-gray-300';
    }
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  return (
    <div className="h-full bg-gray-900 text-gray-100 flex flex-col">
      <div className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700 min-h-[42px]">
        <div className="flex items-center gap-2">
          <Terminal size={16} />
          <span className="text-sm font-medium">Console</span>
          {isStreamingLogs && (
            <span className="flex items-center gap-1.5 text-xs text-green-400">
              <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
              Streaming Beam Logs
            </span>
          )}
          {activeFile?.type === 'test' && (
            <button
              onClick={onRunTests}
              disabled={isRunningTests}
              className="flex items-center gap-1.5 ml-4 px-2 py-1 text-xs bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors disabled:bg-gray-600 disabled:cursor-not-allowed"
            >
              Run Tests
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={clearConsole}
            className="p-1 hover:bg-gray-700 rounded transition-colors"
            title="Clear Console"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 font-mono text-xs"
      >
        {consoleMessages.length === 0 ? (
          <div className="text-gray-500 italic">
            Console output will appear here...
          </div>
        ) : (
          <div className="space-y-1">
            {consoleMessages.map((msg: ConsoleMessage) => (
              <div
                key={msg.id}
                className="flex items-start gap-2 py-1"
              >
                <span className="text-gray-500">
                  [{formatTime(msg.timestamp)}]
                </span>
                {getIcon(msg.type)}
                <span className={clsx('flex-1 break-all whitespace-pre-wrap', getMessageClass(msg.type))}>
                  {msg.message}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
