'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Sparkles, Send, Loader2, Trash2 } from 'lucide-react';
import { useIDEStore } from '@/store/ide-store';
import { aiApi, type ToolCall } from '@/lib/api';
import type { File } from '@/store/ide-store';
import { beamClient } from '@/lib/beam-client';
import { ChatMessage } from './ChatMessage';

// Feature flag: Use unified chat endpoint (supports both blueprints and dApps)
const USE_UNIFIED_CHAT = process.env.NEXT_PUBLIC_USE_UNIFIED_CHAT === 'true';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  tool_calls?: ToolCall[];
  timestamp: Date;
  environment?: string;  // For unified chat
  confidence?: number;    // For unified chat
}

export const AgenticChat: React.FC = () => {
  const { activeProjectId, files, addFile, updateFile, addConsoleMessage } = useIDEStore();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Get contract files from current project
  const contractFiles = files.filter((f) => f.type === 'contract');

  // Load messages from localStorage on mount
  useEffect(() => {
    if (activeProjectId) {
      const storageKey = `agentic-chat-${activeProjectId}`;
      const savedMessages = localStorage.getItem(storageKey);
      if (savedMessages) {
        try {
          const parsed = JSON.parse(savedMessages);
          // Convert timestamp strings back to Date objects
          const messagesWithDates = parsed.map((msg: any) => ({
            ...msg,
            timestamp: new Date(msg.timestamp),
          }));
          setMessages(messagesWithDates);
        } catch (error) {
          console.error('Failed to load chat history:', error);
        }
      }
    }
  }, [activeProjectId]);

  // Save messages to localStorage whenever they change
  useEffect(() => {
    if (activeProjectId && messages.length > 0) {
      const storageKey = `agentic-chat-${activeProjectId}`;
      localStorage.setItem(storageKey, JSON.stringify(messages));
    }
  }, [messages, activeProjectId]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSend = async () => {
    if (!input.trim() || !activeProjectId || isLoading) return;

    const userMessage: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: input,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      // Prepare files map (path -> content)
      const filesMap: Record<string, string> = {};
      files.forEach((file) => {
        filesMap[file.path] = file.content;
      });

      // Prepare conversation history (last 10 messages for context)
      const conversationHistory = messages.slice(-10).map((msg) => ({
        role: msg.role,
        content: msg.content,
      }));

      // Call unified chat API or agentic chat based on feature flag
      const response = USE_UNIFIED_CHAT
        ? await aiApi.unifiedChat({
            message: input,
            project_id: activeProjectId,
            files: filesMap,
            conversation_history: conversationHistory,
          })
        : await aiApi.agenticChat({
            message: input,
            project_id: activeProjectId,
            files: filesMap,
            conversation_history: conversationHistory,
          });

      if (response.success) {
        // Add assistant message
        const assistantMessage: ChatMessage = {
          id: `msg-${Date.now()}`,
          role: 'assistant',
          content: response.message,
          tool_calls: response.tool_calls,
          timestamp: new Date(),
          environment: 'environment' in response ? response.environment : undefined,
          confidence: 'confidence' in response ? response.confidence : undefined,
        };

        setMessages((prev) => [...prev, assistantMessage]);

        // Log environment detection if using unified chat
        if (USE_UNIFIED_CHAT && 'environment' in response) {
          const confidencePercent = Math.round((response.confidence || 0) * 100);
          addConsoleMessage('info', `🔍 Detected: ${response.environment} (${confidencePercent}% confidence)`);
        }

        // Handle updated files
        if (Object.keys(response.updated_files).length > 0) {
          addConsoleMessage('info', `✏️  AI updated ${Object.keys(response.updated_files).length} file(s)`);

          // Collect all files to upload
          const filesToUpload: Record<string, string> = {};

          for (const [path, content] of Object.entries(response.updated_files)) {
            // Check if file exists
            const existingFile = files.find((f) => f.path === path);

            if (existingFile) {
              // Update existing file
              updateFile(existingFile.id, content);
              addConsoleMessage('info', `📝 Updated ${path}`);
            } else {
              // Create new file
              const newFile: File = {
                id: `file-${Date.now()}-${Math.random()}`,
                name: path.split('/').pop() || 'file',
                content,
                language: getLanguageFromPath(path),
                path,
                type: 'component',
              };
              addFile(newFile);
              addConsoleMessage('info', `📄 Created ${path}`);
            }

            // Add to batch upload
            filesToUpload[path] = content;
          }

          // Batch upload all updated files
          try {
            await beamClient.uploadFiles(activeProjectId, filesToUpload, false);
            addConsoleMessage('success', '✅ Files synced to sandbox');
          } catch (error) {
            console.error('Failed to upload files:', error);
            addConsoleMessage('error', '❌ Failed to sync files to sandbox');
          }
        }
      } else {
        // Error response
        const errorMessage: ChatMessage = {
          id: `msg-${Date.now()}`,
          role: 'assistant',
          content: response.error || 'Sorry, I encountered an error.',
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, errorMessage]);
        addConsoleMessage('error', `❌ ${response.error}`);
      }
    } catch (error) {
      console.error('Chat error:', error);
      const errorMessage: ChatMessage = {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.',
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const getLanguageFromPath = (path: string): any => {
    if (path.endsWith('.tsx')) return 'typescriptreact';
    if (path.endsWith('.ts')) return 'typescript';
    if (path.endsWith('.jsx')) return 'javascriptreact';
    if (path.endsWith('.js')) return 'javascript';
    if (path.endsWith('.css')) return 'css';
    if (path.endsWith('.json')) return 'json';
    if (path.endsWith('.py')) return 'python';
    return 'typescript';
  };

  if (!activeProjectId) {
    return (
      <div className="h-full bg-gray-900 flex items-center justify-center p-8">
        <div className="text-center">
          <Sparkles size={48} className="text-purple-400 mx-auto mb-4" />
          <p className="text-gray-400">No project selected</p>
          <p className="text-gray-500 text-sm mt-2">
            Select a project to start chatting with AI
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full bg-gray-900 flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-gray-800">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Sparkles size={20} className="text-purple-400" />
            <h3 className="text-lg font-semibold text-white">AI Agent</h3>
          </div>
          {messages.length > 0 && (
            <button
              onClick={() => {
                setMessages([]);
                if (activeProjectId) {
                  const storageKey = `agentic-chat-${activeProjectId}`;
                  localStorage.removeItem(storageKey);
                }
              }}
              className="p-1.5 hover:bg-gray-800 rounded transition-colors"
              title="Clear chat"
            >
              <Trash2 size={16} className="text-gray-400" />
            </button>
          )}
        </div>
        <p className="text-sm text-gray-400">
          Chat with AI to build your dApp. It can read, write, and explore files.
        </p>
        {contractFiles.length > 0 && (
          <div className="mt-2 text-xs text-gray-500">
            📄 {contractFiles.length} contract(s) in project
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="text-center text-gray-500 mt-8">
            <p className="mb-4">👋 Hi! I'm your AI assistant.</p>
            <p className="text-sm mb-2">Try asking me to:</p>
            <div className="text-xs space-y-1 text-gray-600">
              <p>• "Create a Next.js dApp for my counter contract"</p>
              <p>• "Show me the project structure"</p>
              <p>• "Add a dashboard component with buttons"</p>
              <p>• "Update the styling to use dark mode"</p>
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <ChatMessage
              key={msg.id}
              role={msg.role}
              content={msg.content}
              tool_calls={msg.tool_calls}
              environment={msg.environment}
              confidence={msg.confidence}
            />
          ))
        )}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-gray-800 rounded-lg p-4 max-w-[80%]">
              <div className="flex items-center gap-2 mb-2">
                <Loader2 size={16} className="animate-spin text-purple-400" />
                <span className="text-sm text-gray-300 font-medium">Pensando...</span>
              </div>
              <div className="space-y-1 text-xs text-gray-400">
                <div className="flex items-center gap-2 animate-pulse">
                  <div className="w-1 h-1 rounded-full bg-purple-400"></div>
                  <span>Analisando projeto...</span>
                </div>
                <div className="flex items-center gap-2 animate-pulse" style={{ animationDelay: '200ms' }}>
                  <div className="w-1 h-1 rounded-full bg-blue-400"></div>
                  <span>Planejando ações...</span>
                </div>
                <div className="flex items-center gap-2 animate-pulse" style={{ animationDelay: '400ms' }}>
                  <div className="w-1 h-1 rounded-full bg-green-400"></div>
                  <span>Gerando código...</span>
                </div>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-gray-800">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Ask AI to build features, modify files, or explore code..."
            className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm resize-none focus:outline-none focus:border-purple-500"
            rows={3}
            disabled={isLoading}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            className="px-4 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isLoading ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Send size={18} />
            )}
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          Press Enter to send, Shift+Enter for new line
        </p>
      </div>
    </div>
  );
};
