'use client';

import React, { useRef, useEffect } from 'react';
import { useChat } from '@ai-sdk/react';
import { Sparkles, Send, Loader2, Trash2 } from 'lucide-react';
import { useIDEStore } from '@/store/ide-store';
import type { File } from '@/store/ide-store';
import { beamClient } from '@/lib/beam-client';
import { ChatMessage } from './ChatMessage';

export const AgenticChatStreaming: React.FC = () => {
  const { activeProjectId, files, addFile, updateFile, addConsoleMessage } = useIDEStore();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const contractFiles = files.filter((f) => f.type === 'contract');

  // Prepare files map for API
  const filesMap: Record<string, string> = {};
  files.forEach((file) => {
    filesMap[file.path] = file.content;
  });

  // Use AI SDK's useChat hook
  const chatHelpers = useChat({
    api: '/api/chat',
    initialInput: '',
    body: {
      projectId: activeProjectId,
      files: filesMap,
    },
    onFinish: async (message) => {
      // Handle tool results and file updates
      console.log('Chat finished:', message);

      // Check for file updates in the response
      // This would come from the backend's tool_calls
      // For now, we'll handle this in onResponse

    },
    onResponse: async (response) => {
      console.log('Response headers:', response.headers);
    },
    onError: (error) => {
      console.error('Chat error:', error);
      addConsoleMessage('error', `❌ Chat error: ${error.message}`);
    },
  });

  // Extract properties
  const {
    messages = [],
    append,
    isLoading = false,
    setMessages,
    reload,
  } = chatHelpers;

  // Use local state for input since AI SDK's input handler isn't working
  const [localInput, setLocalInput] = React.useState('');

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setLocalInput(e.target.value);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!localInput.trim() || !activeProjectId) {
      console.log('Validation failed:', { hasInput: !!localInput.trim(), activeProjectId });
      return;
    }

    const userMessage = localInput;
    setLocalInput(''); // Clear input immediately

    // Add user message to UI
    const newMessage = {
      id: `msg-${Date.now()}`,
      role: 'user' as const,
      content: userMessage,
    };

    setMessages([...messages, newMessage]);
    console.log('Sending message:', userMessage);

    try {
      // Manual fetch since useChat's append isn't available
      console.log('Fetching /api/chat...');
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: [...messages, newMessage].slice(-10), // Last 10 messages
          data: {
            projectId: activeProjectId,
            files: filesMap,
          },
        }),
      });

      console.log('Response received:', response.status, response.headers.get('content-type'));

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Response not OK:', response.status, errorText);
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // Read streaming response
      console.log('Starting to read stream...');
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let assistantMessage = '';
      const assistantId = `msg-${Date.now()}-assistant`;
      let buffer = ''; // Buffer for incomplete lines

      if (reader) {
        let chunkCount = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            console.log('Stream done. Total chunks:', chunkCount);
            break;
          }

          chunkCount++;
          const chunk = decoder.decode(value, { stream: true });
          console.log(`Chunk ${chunkCount}:`, chunk.substring(0, 100));
          buffer += chunk;

          const lines = buffer.split('\n');
          // Keep last incomplete line in buffer
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('0:')) {
              // Text content
              try {
                const text = JSON.parse(line.slice(2));
                assistantMessage += text;
                console.log('Parsed text:', text.substring(0, 50));

                // Update message in real-time
                setMessages((prev) => {
                  const lastMsg = prev[prev.length - 1];
                  if (lastMsg?.id === assistantId) {
                    return [
                      ...prev.slice(0, -1),
                      { ...lastMsg, content: assistantMessage },
                    ];
                  } else {
                    return [
                      ...prev,
                      { id: assistantId, role: 'assistant' as const, content: assistantMessage },
                    ];
                  }
                });
              } catch (e) {
                console.error('Failed to parse streaming chunk:', line, e);
              }
            } else if (line.startsWith('2:')) {
              // Data message (file updates)
              try {
                const dataArray = JSON.parse(line.slice(2));
                console.log('[Stream] Received data message:', dataArray);
                if (Array.isArray(dataArray)) {
                  dataArray.forEach((item: any) => {
                    if (item.type === 'files_updated' && item.files) {
                      console.log('[Stream] Updating files:', Object.keys(item.files));
                      Object.entries(item.files).forEach(([path, content]) => {
                        console.log(`[Stream] Updating file by path: ${path}`);
                        // Find the file by path, then update by ID
                        const fileToUpdate = files.find(f => f.path === path);
                        if (fileToUpdate) {
                          console.log(`[Stream] Found file ID: ${fileToUpdate.id}, updating content`);
                          updateFile(fileToUpdate.id, content as string);
                          addConsoleMessage('success', `✅ Updated file: ${path}`);
                        } else {
                          console.error(`[Stream] File not found: ${path}`);
                          addConsoleMessage('error', `❌ File not found: ${path}`);
                        }
                      });
                    }
                  });
                }
              } catch (e) {
                console.error('Failed to parse data message:', line, e);
              }
            }
          }
        }
      }

      addConsoleMessage('success', '✅ Message sent successfully');
    } catch (error: any) {
      console.error('Chat error:', error);
      addConsoleMessage('error', `❌ Failed to send message: ${error.message}`);

      // Add error message
      setMessages((prev) => [
        ...prev,
        {
          id: `msg-${Date.now()}-error`,
          role: 'assistant' as const,
          content: 'Sorry, I encountered an error. Please try again.',
        },
      ]);
    }
  };

  // Auto-scroll to bottom with delay to ensure content is rendered
  useEffect(() => {
    const timer = setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
    return () => clearTimeout(timer);
  }, [messages, isLoading]);

  // Clear chat
  const handleClearChat = () => {
    setMessages([]);
    if (activeProjectId) {
      const storageKey = `agentic-chat-${activeProjectId}`;
      localStorage.removeItem(storageKey);
    }
  };

  // Load messages from localStorage on mount
  useEffect(() => {
    if (activeProjectId) {
      const storageKey = `agentic-chat-${activeProjectId}`;
      const savedMessages = localStorage.getItem(storageKey);
      if (savedMessages) {
        try {
          const parsed = JSON.parse(savedMessages);
          setMessages(parsed);
        } catch (error) {
          console.error('Failed to load chat history:', error);
        }
      }
    }
  }, [activeProjectId, setMessages]);

  // Save messages to localStorage whenever they change
  useEffect(() => {
    if (activeProjectId && messages.length > 0) {
      const storageKey = `agentic-chat-${activeProjectId}`;
      localStorage.setItem(storageKey, JSON.stringify(messages));
    }
  }, [messages, activeProjectId]);

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
    <div className="h-full bg-gradient-to-b from-gray-900 via-gray-900 to-gray-950 flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-gray-800/50 bg-gray-900/50 backdrop-blur-sm">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <div className="relative">
              <Sparkles size={20} className="text-purple-400 animate-pulse" />
              <div className="absolute inset-0 blur-md bg-purple-400/30 animate-pulse"></div>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white">AI Assistant</h3>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full border border-green-500/30 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse"></span>
                  Streaming
                </span>
                {contractFiles.length > 0 && (
                  <span className="text-xs text-gray-500">
                    {contractFiles.length} contract{contractFiles.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
            </div>
          </div>
          {messages.length > 0 && (
            <button
              onClick={handleClearChat}
              className="p-2 hover:bg-gray-800/50 rounded-lg transition-all duration-200 hover:scale-105 group"
              title="Clear chat"
            >
              <Trash2 size={16} className="text-gray-400 group-hover:text-red-400 transition-colors" />
            </button>
          )}
        </div>
        <p className="text-sm text-gray-400 leading-relaxed">
          Real-time AI collaboration for your blockchain projects
        </p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center max-w-md">
              <div className="mb-6 relative inline-block">
                <Sparkles size={48} className="text-purple-400" />
                <div className="absolute inset-0 blur-2xl bg-purple-400/20 animate-pulse"></div>
              </div>
              <h4 className="text-xl font-semibold text-white mb-2">Ready to build</h4>
              <p className="text-gray-400 mb-6 leading-relaxed">
                I can help you create dApps, modify contracts, and explore your codebase.
              </p>
              <div className="space-y-3 text-left">
                <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-3 hover:border-purple-500/50 transition-all cursor-pointer group">
                  <p className="text-sm text-gray-300 group-hover:text-white transition-colors">
                    💡 "Create a Next.js dApp for my counter contract"
                  </p>
                </div>
                <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-3 hover:border-purple-500/50 transition-all cursor-pointer group">
                  <p className="text-sm text-gray-300 group-hover:text-white transition-colors">
                    🔍 "Show me the project structure"
                  </p>
                </div>
                <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-3 hover:border-purple-500/50 transition-all cursor-pointer group">
                  <p className="text-sm text-gray-300 group-hover:text-white transition-colors">
                    🎨 "Add a dashboard component with buttons"
                  </p>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg, index) => (
              <div
                key={msg.id}
                className="animate-fade-in"
                style={{ animationDelay: `${index * 50}ms` }}
              >
                <ChatMessage
                  role={msg.role}
                  content={msg.content}
                  tool_calls={msg.toolInvocations?.map((tool: any) => ({
                    tool: tool.toolName,
                    args: tool.args,
                    result: tool.result,
                  }))}
                />
              </div>
            ))}

            {isLoading && (
              <div className="flex justify-start animate-fade-in">
                <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-4 max-w-[80%] backdrop-blur-sm">
                  <div className="flex items-center gap-3">
                    <Loader2 size={18} className="animate-spin text-purple-400" />
                    <span className="text-sm text-gray-300">Thinking</span>
                    <div className="flex gap-1">
                      <span className="w-1 h-1 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                      <span className="w-1 h-1 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                      <span className="w-1 h-1 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Input */}
      <div className="p-4 border-t border-gray-800/50 bg-gray-900/50 backdrop-blur-sm">
        <form onSubmit={handleSubmit} className="flex gap-3">
          <div className="flex-1 relative">
            <textarea
              value={localInput}
              onChange={handleInputChange}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e);
                }
              }}
              placeholder="Ask AI to build features, modify files, or explore code..."
              className="w-full bg-gray-800/50 border border-gray-700/50 rounded-xl px-4 py-3 text-white text-sm resize-none focus:outline-none focus:border-purple-500/50 focus:ring-2 focus:ring-purple-500/20 transition-all placeholder:text-gray-500"
              rows={3}
              disabled={isLoading}
            />
            <div className="absolute bottom-3 right-3 text-xs text-gray-600">
              {isLoading ? 'Responding...' : 'Press ⏎ to send'}
            </div>
          </div>
          <button
            type="submit"
            disabled={!localInput.trim() || isLoading}
            className="px-5 bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800 text-white rounded-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-lg shadow-purple-500/20 hover:shadow-purple-500/30 hover:scale-105 disabled:hover:scale-100"
          >
            {isLoading ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                <span className="text-sm font-medium">Sending</span>
              </>
            ) : (
              <>
                <Send size={18} />
                <span className="text-sm font-medium">Send</span>
              </>
            )}
          </button>
        </form>
        <div className="flex items-center justify-between mt-3">
          <p className="text-xs text-gray-500">
            Shift + Enter for new line
          </p>
          {messages.length > 0 && (
            <p className="text-xs text-gray-600">
              {messages.length} message{messages.length !== 1 ? 's' : ''}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
