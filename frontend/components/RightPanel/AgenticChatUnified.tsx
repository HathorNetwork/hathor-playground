'use client';

/**
 * Unified Agentic Chat - Blueprint + dApp Development
 *
 * This component supports BOTH:
 * - Blueprint development (Pyodide in browser)
 * - dApp development (BEAM sandboxes)
 *
 * All tools execute client-side for maximum performance.
 */

import React, { useRef, useEffect } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { Sparkles, Send, Loader2, Trash2, Wrench, Code2, Globe } from 'lucide-react';
import { useIDEStore } from '@/store/ide-store';
import { AIToolsClient } from '@/lib/ai-tools-client';
import { ChatMessage } from './ChatMessage';

export const AgenticChatUnified: React.FC = () => {
  const { activeProjectId, addConsoleMessage } = useIDEStore();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Use local state for input since AI SDK's input handler isn't working
  const [localInput, setLocalInput] = React.useState('');

  const chatHelpers = useChat({
    transport: new DefaultChatTransport({
      api: '/api/chat-unified',
    }),

    // Client-side tool execution for BOTH Blueprint and dApp tools!
    async onToolCall({ toolCall }) {
      const toolName = toolCall.toolName;
      const args = toolCall.args || {};

      console.log('🔧 Tool call:', toolName, args);
      addConsoleMessage('info', `🔧 Executing: ${toolName}(${JSON.stringify(args).slice(0, 100)})`);

      try {
        let result;

        // Route to appropriate handler
        switch (toolName) {
          // ========== Shared File Tools ==========
          case 'list_files':
            result = await AIToolsClient.listFiles(args.path || '/');
            break;

          case 'read_file':
            result = await AIToolsClient.readFile(args.path);
            break;

          case 'write_file':
            result = await AIToolsClient.writeFile(args.path, args.content);
            break;

          case 'get_project_structure':
            result = await AIToolsClient.getProjectStructure();
            break;

          // ========== Blueprint Tools ==========
          case 'validate_blueprint':
            result = await AIToolsClient.validateBlueprint(args.path);
            break;

          case 'list_methods':
            result = await AIToolsClient.listMethods(args.path);
            break;

          case 'compile_blueprint':
            result = await AIToolsClient.compileBlueprint(args.path);
            break;

          case 'execute_method':
            result = await AIToolsClient.executeMethod(
              args.path,
              args.method_name,
              args.args || [],
              args.caller_address
            );
            break;

          case 'run_tests':
            result = await AIToolsClient.runTests(args.test_path);
            break;

          // ========== dApp Tools ==========
          case 'bootstrap_nextjs':
            result = await AIToolsClient.bootstrapNextJS(
              args.useTypeScript ?? true,
              args.useTailwind ?? true
            );
            break;

          case 'deploy_dapp':
            result = await AIToolsClient.deployDApp();
            break;

          case 'upload_files':
            result = await AIToolsClient.uploadFiles(args.paths);
            break;

          case 'get_sandbox_url':
            result = await AIToolsClient.getSandboxUrl();
            break;

          case 'restart_dev_server':
            result = await AIToolsClient.restartDevServer();
            break;

          default:
            result = {
              success: false,
              message: `Unknown tool: ${toolName}`,
              error: 'Tool not implemented',
            };
        }

        // Log to console
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

  const {
    messages,
    status,
    setMessages,
    sendMessage,
    stop,
    error,
  } = chatHelpers;

  const isLoading = status === 'awaiting-message' || status === 'in-progress';

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // Load messages from localStorage
  useEffect(() => {
    if (activeProjectId) {
      const storageKey = `agentic-chat-unified-${activeProjectId}`;
      const savedMessages = localStorage.getItem(storageKey);
      if (savedMessages) {
        try {
          setMessages(JSON.parse(savedMessages));
        } catch (error) {
          console.error('Failed to load chat history:', error);
        }
      }
    }
  }, [activeProjectId, setMessages]);

  // Save messages to localStorage
  useEffect(() => {
    if (activeProjectId && messages.length > 0) {
      const storageKey = `agentic-chat-unified-${activeProjectId}`;
      localStorage.setItem(storageKey, JSON.stringify(messages));
    }
  }, [activeProjectId, messages]);

  const handleClearChat = () => {
    setMessages([]);
    setLocalInput('');
    if (activeProjectId) {
      localStorage.removeItem(`agentic-chat-unified-${activeProjectId}`);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setLocalInput(e.target.value);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!localInput.trim() || !activeProjectId) {
      return;
    }

    const userMessage = localInput;
    setLocalInput(''); // Clear input immediately

    // Use sendMessage from useChat (new API with onToolCall)
    try {
      await sendMessage({
        role: 'user',
        content: userMessage,
      });
    } catch (error: any) {
      console.error('Chat error:', error);
      addConsoleMessage('error', `❌ Failed to send message: ${error.message}`);
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-900">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-purple-400" />
          <h2 className="text-sm font-semibold text-white">AI Assistant</h2>
          <div className="flex gap-1">
            <span className="px-2 py-0.5 text-xs bg-blue-500/20 text-blue-400 rounded flex items-center gap-1">
              <Code2 className="w-3 h-3" />
              Blueprint
            </span>
            <span className="px-2 py-0.5 text-xs bg-green-500/20 text-green-400 rounded flex items-center gap-1">
              <Globe className="w-3 h-3" />
              dApp
            </span>
          </div>
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
              <p className="text-sm font-semibold mb-2">
                Full-Stack Blockchain Development
              </p>
              <p className="text-xs text-gray-600 mb-4">
                I can help you build both smart contracts (Blueprints) and web apps (dApps)!
              </p>
              <div className="space-y-2 text-left text-xs">
                <div className="p-3 bg-blue-500/10 rounded border border-blue-500/20">
                  <div className="flex items-center gap-2 mb-1">
                    <Code2 className="w-4 h-4 text-blue-400" />
                    <span className="font-semibold text-blue-400">Blueprint Example</span>
                  </div>
                  <p className="text-gray-400">
                    "Create a Counter blueprint with increment and decrement"
                  </p>
                </div>
                <div className="p-3 bg-green-500/10 rounded border border-green-500/20">
                  <div className="flex items-center gap-2 mb-1">
                    <Globe className="w-4 h-4 text-green-400" />
                    <span className="font-semibold text-green-400">dApp Example</span>
                  </div>
                  <p className="text-gray-400">
                    "Create a todo list dApp with Tailwind CSS"
                  </p>
                </div>
                <div className="p-3 bg-purple-500/10 rounded border border-purple-500/20">
                  <div className="flex items-center gap-2 mb-1">
                    <Sparkles className="w-4 h-4 text-purple-400" />
                    <span className="font-semibold text-purple-400">Full-Stack Example</span>
                  </div>
                  <p className="text-gray-400">
                    "Build a voting system with blueprint + dApp frontend"
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {messages.map((message, index) => {
          // Extract content from parts array (new AI SDK format)
          const content = message.parts
            ?.filter((part: any) => part.type === 'text')
            .map((part: any) => part.text)
            .join('') || message.content || '';

          return (
            <div key={index}>
              <ChatMessage
                role={message.role}
                content={content}
                toolInvocations={message.toolInvocations}
              />

            {/* Tool invocations */}
            {message.toolInvocations && message.toolInvocations.length > 0 && (
              <div className="ml-12 mt-2 space-y-2">
                {message.toolInvocations.map((tool: any, toolIndex: number) => {
                  // Determine tool category for styling
                  const isBlueprintTool = [
                    'validate_blueprint',
                    'compile_blueprint',
                    'execute_method',
                    'run_tests',
                    'list_methods',
                  ].includes(tool.toolName);

                  const isDAppTool = [
                    'bootstrap_nextjs',
                    'deploy_dapp',
                    'upload_files',
                    'get_sandbox_url',
                    'restart_dev_server',
                  ].includes(tool.toolName);

                  const borderColor = isBlueprintTool
                    ? 'border-blue-500/30'
                    : isDAppTool
                    ? 'border-green-500/30'
                    : 'border-gray-700';

                  const iconColor = isBlueprintTool
                    ? 'text-blue-400'
                    : isDAppTool
                    ? 'text-green-400'
                    : 'text-gray-400';

                  return (
                    <div
                      key={toolIndex}
                      className={`p-3 bg-gray-800 border rounded-lg text-xs ${borderColor}`}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <Wrench className={`w-3 h-3 ${iconColor}`} />
                        <span className={`font-mono ${iconColor}`}>{tool.toolName}</span>
                        {tool.state === 'result' && <span className="text-green-400">✓</span>}
                        {tool.state === 'call' && (
                          <Loader2 className="w-3 h-3 animate-spin text-yellow-400" />
                        )}
                      </div>

                      {/* Args */}
                      {tool.args && Object.keys(tool.args).length > 0 && (
                        <div className="text-gray-400 mb-2">
                          <span className="font-semibold">Args:</span>{' '}
                          {JSON.stringify(tool.args, null, 2)}
                        </div>
                      )}

                      {/* Result */}
                      {tool.state === 'result' && tool.result && (
                        <div className="text-gray-300 whitespace-pre-wrap">
                          {typeof tool.result === 'string'
                            ? tool.result
                            : JSON.stringify(tool.result, null, 2)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            </div>
          );
        })}

        {isLoading && (
          <div className="flex items-center gap-2 text-gray-400">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Thinking...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-gray-700">
        <form onSubmit={handleSubmit}>
          <div className="flex gap-2">
            <textarea
              value={localInput}
              onChange={handleInputChange}
              placeholder="Ask me to build blueprints, dApps, or both..."
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
            <button
              type="submit"
              disabled={isLoading || !localInput.trim() || !activeProjectId}
              className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
            </button>
          </div>
        </form>

        {!activeProjectId && (
          <p className="text-xs text-gray-500 mt-2">
            Create or select a project to start chatting
          </p>
        )}
      </div>
    </div>
  );
};
