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

import React, { useRef } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from 'ai';
import { Sparkles, Send, Loader2, Trash2, Code2, Globe } from 'lucide-react';
import { useIDEStore } from '@/store/ide-store';
import { AIToolsClient } from '@/lib/ai-tools-client';
import { Conversation, ConversationContent, ConversationScrollButton, ConversationEmptyState } from '@/components/ai-elements/conversation';
import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message';
import { Tool, ToolHeader, ToolContent, ToolInput, ToolOutput } from '@/components/ai-elements/tool';

export const AgenticChatUnified: React.FC = () => {
  const { activeProjectId, addConsoleMessage } = useIDEStore();

  // Track tool calling rounds to prevent infinite loops
  const toolRoundCounterRef = useRef(0);
  const MAX_TOOL_ROUNDS = 10; // Limit to prevent infinite loops

  // Use local state for input since AI SDK's input handler isn't working
  const [localInput, setLocalInput] = React.useState('');

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
            result = await AIToolsClient.uploadFiles(args.files || []);
            break;

          case 'get_sandbox_url':
            result = await AIToolsClient.getSandboxUrl();
            break;

          case 'restart_dev_server':
            result = await AIToolsClient.restartDevServer();
            break;

          case 'run_command':
            result = await AIToolsClient.runCommand(args.command);
            break;

          case 'read_sandbox_files':
            result = await AIToolsClient.readSandboxFiles(args.path);
            break;

          case 'get_sandbox_logs':
            result = await AIToolsClient.getSandboxLogs(args.lines || 50);
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

        // Return result (required by AI SDK)
        return JSON.stringify(result);
      } catch (error: any) {
        console.error('Tool execution error:', error);
        addConsoleMessage('error', `❌ Tool error: ${error.message}`);

        const errorResult = {
          success: false,
          message: `Tool execution failed: ${error.message}`,
          error: error.stack || error.toString(),
        };

        addToolResult({
          tool: toolCall.toolName,
          toolCallId: toolCall.toolCallId,
          output: errorResult,
        });

        return JSON.stringify(errorResult);
      }
    },

    onError(error) {
      console.error('Chat error:', error);
      addConsoleMessage('error', `❌ Chat error: ${error.message}`);
    },
  });

  // Store functions in refs so they can be accessed in callbacks
  sendMessageRef.current = sendMessage;

  const isLoading = status === 'awaiting-message' || status === 'in-progress';

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

      {/* Messages - Using AI Elements with Timeline */}
      <Conversation>
        <ConversationContent>
          {messages.length === 0 && (
            <ConversationEmptyState
              title="Full-Stack Blockchain Development"
              description="I can help you build both smart contracts (Blueprints) and web apps (dApps)!"
            >
              <div className="space-y-2 text-left text-xs mt-4">
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
            </ConversationEmptyState>
          )}

          {messages.map((message) => {
            // Handle both message.parts (new format) and message.content (old format)
            const parts = message.parts && message.parts.length > 0
              ? message.parts
              : [(message as any).content ? { type: 'text', text: (message as any).content } : null].filter(Boolean);

            return (
              <div key={message.id} className="relative">
                {/* Timeline connector - subtle vertical line */}
                <div className="absolute left-2 top-8 bottom-0 w-px bg-gradient-to-b from-purple-500/20 to-transparent" />

                {/* Render parts in chronological order */}
                <div className="space-y-4">
                  {parts.map((part: any, partIndex: number) => {
                    // Render text parts as message bubbles
                    if (part.type === 'text') {
                      return (
                        <div key={`${message.id}-text-${partIndex}`} className="relative">
                          {/* Timeline dot */}
                          <div className="absolute -left-1 top-4 w-2 h-2 rounded-full bg-purple-500/40 border border-purple-500/60" />

                          <Message from={message.role as 'user' | 'assistant'}>
                            <MessageContent>
                              <MessageResponse>{part.text}</MessageResponse>
                            </MessageContent>
                          </Message>
                        </div>
                      );
                    }

                    // Render tool parts as tool cards
                    if (part.type && part.type.startsWith('tool-')) {
                      const toolName = part.type.replace('tool-', '');

                      return (
                        <div key={`${message.id}-tool-${partIndex}`} className="relative">
                          {/* Timeline dot for tools */}
                          <div className="absolute -left-1 top-4 w-2 h-2 rounded-full bg-blue-500/40 border border-blue-500/60" />

                          <div className="ml-4">
                            <Tool defaultOpen={false}>
                              <ToolHeader
                                type={toolName}
                                state={part.state || 'input-streaming'}
                                title={toolName}
                              />
                              <ToolContent>
                                {part.input && <ToolInput input={part.input} />}
                                {part.output && <ToolOutput output={part.output} errorText={part.errorText} />}
                              </ToolContent>
                            </Tool>
                          </div>
                        </div>
                      );
                    }

                    return null;
                  })}
                </div>
              </div>
            );
          })}

          {isLoading && (
            <div className="flex items-center gap-2 text-gray-400 p-4">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Thinking...</span>
            </div>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {/* Input */}
      <div className="p-4 border-t border-gray-700">
        <form onSubmit={handleSubmit}>
          <div className="flex gap-2">
            <textarea
              value={localInput}
              onChange={handleInputChange}
              placeholder="Ask me to build blueprints, dApps, or both..."
              className="flex-1 px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 resize-none"
              rows={3}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e);
                }
              }}
            />
            <button
              type="submit"
              disabled={!localInput.trim() || isLoading}
              className="px-6 py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded-lg transition-colors flex items-center gap-2"
            >
              {isLoading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Send className="w-5 h-5" />
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
