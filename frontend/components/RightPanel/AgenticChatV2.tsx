'use client';

/**
 * Agentic Chat V2 - Client-Side Tool Execution
 *
 * This component uses Vercel AI SDK's useChat hook with client-side tools.
 * All tool execution happens in the browser - no file uploads needed!
 *
 * Architecture:
 * - LLM calls proxied through Next.js API route (API key secure)
 * - Tools execute in browser (access to Zustand + Pyodide)
 * - Files never leave the browser
 */

import React, { useRef, useEffect } from 'react';
import { useChat } from '@ai-sdk/react';
import { Sparkles, Send, Loader2, Trash2, Wrench, Square } from 'lucide-react';
import { useIDEStore } from '@/store/ide-store';
import { AIToolsClient } from '@/lib/ai-tools-client';
import { ChatMessage } from './ChatMessage';

export const AgenticChatV2: React.FC = () => {
  const { activeProjectId, addConsoleMessage } = useIDEStore();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [localInput, setLocalInput] = React.useState('');

  // Use AI SDK's useChat hook with client-side tool execution
  const {
    messages,
    input,
    handleInputChange,
    handleSubmit,
    isLoading,
    setMessages,
    addToolResult,
    stop,
  } = useChat({
    api: '/api/chat-v2', // New API route with client-side tools

    // Client-side tool execution!
    async onToolCall({ toolCall }) {
      console.log('🔧 Tool call:', toolCall.toolName, toolCall.args);
      addConsoleMessage('info', `🔧 Executing: ${toolCall.toolName}(${JSON.stringify(toolCall.args).slice(0, 100)})`);

      try {
        let result;

        // Route tool calls to appropriate handlers
        switch (toolCall.toolName) {
          // File management tools
          case 'list_files':
            result = await AIToolsClient.listFiles(toolCall.args.path);
            break;

          case 'read_file':
            result = await AIToolsClient.readFile(toolCall.args.path);
            break;

          case 'write_file':
            result = await AIToolsClient.writeFile(
              toolCall.args.path,
              toolCall.args.content
            );
            break;

          case 'get_project_structure':
            result = await AIToolsClient.getProjectStructure();
            break;

          // Blueprint validation tools
          case 'validate_blueprint':
            result = await AIToolsClient.validateBlueprint(toolCall.args.path);
            break;

          case 'list_methods':
            result = await AIToolsClient.listMethods(toolCall.args.path);
            break;

          // Pyodide execution tools
          case 'compile_blueprint':
            result = await AIToolsClient.compileBlueprint(toolCall.args.path);
            break;

          case 'execute_method':
            result = await AIToolsClient.executeMethod(
              toolCall.args.path,
              toolCall.args.method_name,
              toolCall.args.args || [],
              toolCall.args.caller_address
            );
            break;

          case 'run_tests':
            result = await AIToolsClient.runTests(toolCall.args.test_path);
            break;

          default:
            result = {
              success: false,
              message: `Unknown tool: ${toolCall.toolName}`,
              error: 'Tool not implemented',
            };
        }

        // Log result to console
        if (result.success) {
          addConsoleMessage('success', result.message);
        } else {
          addConsoleMessage('error', result.message);
        }

        // Return result to LLM
        return result.message + (result.data ? `\n\nData: ${JSON.stringify(result.data, null, 2)}` : '');
      } catch (error: any) {
        const errorMsg = `Tool execution failed: ${error.message}`;
        addConsoleMessage('error', `❌ ${errorMsg}`);
        return errorMsg;
      }
    },

    onError(error) {
      console.error('Chat error:', error);
      addConsoleMessage('error', `❌ Chat error: ${error.message}`);
    },

    onFinish(message) {
      console.log('Chat finished:', message);
      addConsoleMessage('success', '✅ Response complete');
    },
  });

  const handleStop = () => {
    console.log('🛑 Stopping AI generation...');
    stop();
    addConsoleMessage('info', '🛑 AI generation stopped by user');
  };

  // Auto-scroll to bottom
  useEffect(() => {
    const timer = setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
    return () => clearTimeout(timer);
  }, [messages, isLoading]);

  // Load messages from localStorage on mount
  useEffect(() => {
    if (activeProjectId) {
      const storageKey = `agentic-chat-v2-${activeProjectId}`;
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
      const storageKey = `agentic-chat-v2-${activeProjectId}`;
      localStorage.setItem(storageKey, JSON.stringify(messages));
    }
  }, [activeProjectId, messages]);

  // Clear chat
  const handleClearChat = () => {
    setMessages([]);
    if (activeProjectId) {
      const storageKey = `agentic-chat-v2-${activeProjectId}`;
      localStorage.removeItem(storageKey);
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-900">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-purple-400" />
          <h2 className="text-sm font-semibold text-white">AI Assistant V2</h2>
          <span className="px-2 py-0.5 text-xs bg-green-500/20 text-green-400 rounded">
            Client-Side Tools
          </span>
        </div>
        <button
          onClick={handleClearChat}
          className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
          title="Clear chat"
        >
          <Trash2 className="w-4 h-4 text-gray-400" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-gray-500 max-w-md">
              <Sparkles className="w-12 h-12 mx-auto mb-4 text-purple-400" />
              <p className="text-sm mb-2">AI Assistant with Browser-Side Execution</p>
              <p className="text-xs text-gray-600">
                All tools run in your browser using Pyodide. Files never leave your machine!
              </p>
              <p className="text-xs text-gray-600 mt-4">
                Try: "Create a Counter blueprint with increment and decrement methods"
              </p>
            </div>
          </div>
        )}

        {messages.map((message, index) => (
          <div key={index}>
            <ChatMessage
              role={message.role}
              content={message.content}
              toolInvocations={message.toolInvocations}
            />

            {/* Show tool invocations */}
            {message.toolInvocations && message.toolInvocations.length > 0 && (
              <div className="ml-12 mt-2 space-y-2">
                {message.toolInvocations.map((tool: any, toolIndex: number) => (
                  <div
                    key={toolIndex}
                    className="p-3 bg-gray-800 border border-gray-700 rounded-lg text-xs"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <Wrench className="w-3 h-3 text-blue-400" />
                      <span className="font-mono text-blue-400">
                        {tool.toolName}
                      </span>
                      {tool.state === 'result' && (
                        <span className="text-green-400">✓</span>
                      )}
                      {tool.state === 'call' && (
                        <Loader2 className="w-3 h-3 animate-spin text-yellow-400" />
                      )}
                    </div>

                    {/* Tool arguments */}
                    {tool.args && (
                      <div className="text-gray-400 mb-2">
                        <span className="font-semibold">Args:</span>{' '}
                        {JSON.stringify(tool.args, null, 2)}
                      </div>
                    )}

                    {/* Tool result */}
                    {tool.state === 'result' && tool.result && (
                      <div className="text-gray-300 whitespace-pre-wrap">
                        {typeof tool.result === 'string'
                          ? tool.result
                          : JSON.stringify(tool.result, null, 2)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        {isLoading && (
          <div className="flex items-center gap-2 text-gray-400">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Thinking...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="p-4 border-t border-gray-700">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={handleInputChange}
            placeholder="Ask me to create, test, or fix blueprints..."
            className="flex-1 px-4 py-2 bg-gray-800 text-white rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-purple-500"
            rows={2}
            disabled={isLoading || !activeProjectId}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e);
              }
            }}
          />
          {isLoading ? (
            <button
              type="button"
              onClick={handleStop}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors flex items-center gap-2"
              title="Stop AI generation"
            >
              <Square className="w-5 h-5" />
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim() || !activeProjectId}
              className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Send className="w-5 h-5" />
            </button>
          )}
        </div>

        {!activeProjectId && (
          <p className="text-xs text-gray-500 mt-2">
            Create or select a project to start chatting
          </p>
        )}
      </form>
    </div>
  );
};
