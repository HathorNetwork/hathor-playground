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

import React, { useRef, useEffect, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from 'ai';
import { Sparkles, Send, Loader2, Trash2, Wrench, Code2, Globe, ChevronDown, ChevronRight } from 'lucide-react';
import { useIDEStore } from '@/store/ide-store';
import { AIToolsClient } from '@/lib/ai-tools-client';
import { ChatMessage } from './ChatMessage';

// Component for displaying tool invocations
const ToolInvocationsDisplay: React.FC<{ toolInvocations: any[] }> = ({ toolInvocations }) => {
  const [expandedTools, setExpandedTools] = useState<Set<number>>(new Set());

  const toggleTool = (index: number) => {
    const newExpanded = new Set(expandedTools);
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }
    setExpandedTools(newExpanded);
  };

  const truncateString = (str: string, maxLength: number = 100) => {
    if (str.length <= maxLength) return str;
    return str.substring(0, maxLength) + '...';
  };

  const getToolSummary = (tool: any) => {
    // Create a compact summary of the tool arguments
    if (!tool.args || Object.keys(tool.args).length === 0) return '';

    const args = tool.args;
    const entries = Object.entries(args);

    if (entries.length === 1) {
      const [key, value] = entries[0];
      return `${key}: ${truncateString(String(value), 40)}`;
    }

    return `${entries.length} args`;
  };

  return (
    <div className="ml-12 mt-2 space-y-1">
      {toolInvocations.map((tool: any, toolIndex: number) => {
        const isExpanded = expandedTools.has(toolIndex);

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

        const bgColor = isBlueprintTool
          ? 'bg-blue-500/5 hover:bg-blue-500/10'
          : isDAppTool
          ? 'bg-green-500/5 hover:bg-green-500/10'
          : 'bg-gray-800/50 hover:bg-gray-800';

        const borderColor = isBlueprintTool
          ? 'border-blue-500/20'
          : isDAppTool
          ? 'border-green-500/20'
          : 'border-gray-700/50';

        const iconColor = isBlueprintTool
          ? 'text-blue-400'
          : isDAppTool
          ? 'text-green-400'
          : 'text-gray-400';

        const summary = getToolSummary(tool);

        return (
          <div
            key={toolIndex}
            className={`border rounded-lg overflow-hidden ${borderColor} ${bgColor} transition-colors`}
          >
            {/* Header - Always visible */}
            <button
              onClick={() => toggleTool(toolIndex)}
              className="w-full px-3 py-2 flex items-center gap-2 text-left"
            >
              {isExpanded ? (
                <ChevronDown className="w-3 h-3 text-gray-400 flex-shrink-0" />
              ) : (
                <ChevronRight className="w-3 h-3 text-gray-400 flex-shrink-0" />
              )}
              <Wrench className={`w-3 h-3 ${iconColor} flex-shrink-0`} />
              <span className={`font-mono text-xs ${iconColor} flex-shrink-0`}>
                {tool.toolName}
              </span>
              {summary && (
                <span className="text-xs text-gray-500 truncate flex-1 min-w-0">
                  {summary}
                </span>
              )}
              {tool.state === 'result' && (
                <span className="text-green-400 text-xs flex-shrink-0">✓</span>
              )}
              {tool.state === 'call' && (
                <Loader2 className="w-3 h-3 animate-spin text-yellow-400 flex-shrink-0" />
              )}
            </button>

            {/* Expanded content */}
            {isExpanded && (
              <div className="border-t border-gray-700/50">
                {/* Args */}
                {tool.args && Object.keys(tool.args).length > 0 && (
                  <div className="px-3 py-2 bg-black/20">
                    <div className="text-xs text-gray-500 mb-1">Arguments:</div>
                    <pre className="text-xs text-gray-300 font-mono overflow-x-auto">
                      {JSON.stringify(tool.args, null, 2)}
                    </pre>
                  </div>
                )}

                {/* Result */}
                {tool.state === 'result' && tool.result && (
                  <div className="px-3 py-2 border-t border-gray-700/50 bg-black/20">
                    <div className="text-xs text-gray-500 mb-1">Result:</div>
                    <pre className="text-xs text-gray-300 font-mono overflow-x-auto max-h-60 overflow-y-auto">
                      {typeof tool.result === 'string'
                        ? tool.result
                        : JSON.stringify(tool.result, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export const AgenticChatUnified: React.FC = () => {
  const { activeProjectId, addConsoleMessage } = useIDEStore();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Use local state for input since AI SDK's input handler isn't working
  const [localInput, setLocalInput] = React.useState('');

  // Track tool calling rounds to prevent infinite loops
  const toolRoundCounterRef = useRef(0);
  const MAX_TOOL_ROUNDS = 10; // Limit to prevent infinite loops

  // Create refs for functions we need in callbacks
  const sendMessageRef = useRef<any>(null);
  const addToolResultRef = useRef<any>(null);

  const { messages, setMessages, sendMessage, addToolResult, status } = useChat({
    sendAutomaticallyWhen: (opts) => {
      // Check if we've exceeded max rounds
      if (toolRoundCounterRef.current >= MAX_TOOL_ROUNDS) {
        console.warn(`⚠️ Max tool rounds (${MAX_TOOL_ROUNDS}) reached, stopping automatic sends`);
        addConsoleMessage('warning', `⚠️ Max tool calling rounds reached (${MAX_TOOL_ROUNDS}). Stopping to prevent infinite loop.`);
        return false;
      }

      // Use default behavior: send when last assistant message has complete tool calls
      const shouldSend = lastAssistantMessageIsCompleteWithToolCalls(opts);
      if (shouldSend) {
        toolRoundCounterRef.current++;
        console.log(`🔄 Tool round ${toolRoundCounterRef.current}/${MAX_TOOL_ROUNDS}`);
      }
      return shouldSend;
    },
    transport: new DefaultChatTransport({
      api: '/api/chat-unified',
    }),

    // Client-side tool execution for BOTH Blueprint and dApp tools!
    async onToolCall({ toolCall }) {
      console.log('🎯 onToolCall TRIGGERED!');
      console.log('🎯 Full toolCall object:', toolCall);
      console.log('🎯 toolCall.dynamic:', toolCall.dynamic);

      // Check for dynamic tools (TypeScript requirement)
      if (toolCall.dynamic) {
        console.log('⚠️ Skipping dynamic tool');
        return;
      }

      const toolName = toolCall.toolName;
      const args = toolCall.input || toolCall.args || {};

      console.log('🔧 Tool call:', toolName, args);
      console.log('🔧 Tool call ID:', toolCall.toolCallId);
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
            // Validate test_path parameter
            if (!args.test_path) {
              // Try to find available test files to help the AI
              const files = (await AIToolsClient.listFiles('/tests')).data || [];
              const testFiles = files.filter((f: any) =>
                f.name.startsWith('test_') && f.name.endsWith('.py')
              );

              const suggestion = testFiles.length > 0
                ? `\n\nAvailable test files:\n${testFiles.map((f: any) => `  - ${f.path}`).join('\n')}`
                : '\n\nNo test files found in /tests/';

              result = {
                success: false,
                message: `Missing required parameter: test_path${suggestion}`,
                error: 'test_path parameter is required. Example: run_tests({ test_path: "/tests/test_counter.py" })',
              };
            } else {
              result = await AIToolsClient.runTests(args.test_path);
            }
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

        console.log('Tool call result: ', result);

        // Log to console
        if (result.success) {
          addConsoleMessage('success', result.message);
        } else {
          addConsoleMessage('error', result.message);
        }

        addToolResult({
          tool: toolCall.toolName,
          toolCallId: toolCall.toolCallId,
          output: result.data,
        });
      } catch (error: any) {
        const errorMsg = `Tool execution failed: ${error.message}`;
        console.error('❌ Error in onToolCall:', error);
        addConsoleMessage('error', `❌ ${errorMsg}`);

        // Send error via addToolResult
        if (addToolResultRef.current) {
          addToolResult({
            state: 'output-error',
            tool: toolName,
            toolCallId: toolCall.toolCallId,
            errorText: errorMsg,
          });
        }
      }
    },

    /* async onFinish({ message, messages: finishMessages }) {
      console.log('💬 Chat finished');
      console.log('📊 Finish message parts:', message.parts);

      // Check message.parts for tool calls (not message.toolInvocations)
      const toolParts = message.parts?.filter((part: any) =>
        part.type?.startsWith('tool-')
      ) || [];

      console.log('🔧 Tool parts:', toolParts);

      if (toolParts.length > 0) {
        // Check if any have output (state === 'output-available' or 'result')
        const hasOutputs = toolParts.some(
          (part: any) => part.state === 'output-available' || part.state === 'result' || part.output !== undefined
        );
        console.log('🔍 Has tool parts:', toolParts.length, 'Has outputs:', hasOutputs);

        if (hasOutputs) {
          console.log('✅ Tool executed successfully');
          console.log('📋 Tool outputs:', toolParts.filter(p => p.output).map(p => ({
            tool: p.type,
            output: p.output?.slice(0, 100)
          })));
          addConsoleMessage('success', '🔧 Tool executed - results available in console');
        } else {
          console.log('⏳ Tool parts exist but no outputs yet');
          addConsoleMessage('success', '✅ Response complete');
        }
      } else {
        addConsoleMessage('success', '✅ Response complete');
      }
    }, */

    onError(error) {
      console.error('Chat error:', error);
      addConsoleMessage('error', `❌ Chat error: ${error.message}`);
    },
  });

  // Store functions in refs so they can be accessed in callbacks
  sendMessageRef.current = sendMessage;

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

    // Reset tool round counter for new user message
    toolRoundCounterRef.current = 0;

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
              />

              {/* Tool invocations */}
              {message.toolInvocations && message.toolInvocations.length > 0 && (
                <ToolInvocationsDisplay toolInvocations={message.toolInvocations} />
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
