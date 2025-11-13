/**
 * Unified AI Chat API Route - Blueprint Specialist
 *
 * Expert AI agent for developing, testing, and deploying Hathor Network nano contracts.
 * System prompt: frontend/prompts/blueprint-specialist.md
 *
 * All tools execute client-side for maximum performance and security.
 */

import { openai } from '@ai-sdk/openai';
import { google } from '@ai-sdk/google';
import { streamText, tool, convertToCoreMessages, convertToModelMessages } from 'ai';
import { z } from 'zod';
import { initLogger, wrapAISDKModel } from 'braintrust';
import { readFileSync } from 'fs';
import { join } from 'path';

// Initialize Braintrust logger
console.log('[Braintrust] Initializing logger...');
initLogger({
  projectName: process.env.PROJECT_NAME || 'Hathor Playground',
  apiKey: process.env.BRAINTRUST_API_KEY!,
});
console.log('[Braintrust] Logger initialized');

// Load system prompt from file
const getSystemPrompt = (): string => {
  const promptPath = join(process.cwd(), 'prompts', 'blueprint-specialist.md');
  return readFileSync(promptPath, 'utf-8');
};

// Determine AI provider from environment and wrap model for tracing
const getAIModel = () => {
  const provider = process.env.AI_PROVIDER || 'gemini';

  if (provider === 'openai') {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY not configured');
    }
    console.log('[Braintrust] Wrapping OpenAI model...');
    return wrapAISDKModel(openai('gpt-4o'));
  } else if (provider === 'gemini') {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      throw new Error('GOOGLE_API_KEY not configured');
    }
    console.log('[Braintrust] Wrapping Gemini model...');
    return wrapAISDKModel(google('gemini-2.5-pro'));
  }

  throw new Error(`Unsupported AI provider: ${provider}`);
};

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const model = getAIModel();

    // Extract messages - DefaultChatTransport might send it differently
    let rawMessages = body.messages || body;

    // Ensure rawMessages is an array
    if (!Array.isArray(rawMessages)) {
      console.error('Invalid message format: expected array, got', typeof rawMessages);
      throw new Error('Invalid message format: expected an array of messages');
    }

    // Check if messages are UIMessages (have 'parts' array) and need conversion
    const hasUIMessageFormat = rawMessages.some((m: any) => m.parts || m.metadata);

    let messages;
    if (hasUIMessageFormat) {
      // Manual conversion with proper output wrapping

      const coreMessages: any[] = [];

      for (const msg of rawMessages) {
        if (msg.parts) {
          // Extract text parts
          const textParts = msg.parts
            .filter((p: any) => p.type === 'text')
            .map((p: any) => p.text);

          // Extract tool parts (type="tool-<name>")
          const toolParts = msg.parts.filter((p: any) => p.type?.startsWith('tool-'));

          if (msg.role === 'assistant' && toolParts.length > 0) {
            // Create assistant message with text and tool-calls
            const toolCalls = toolParts.map((part: any) => {
              const toolName = part.type.replace('tool-', '');
              return {
                type: 'tool-call',
                toolCallId: part.toolCallId,
                toolName: toolName,
                args: part.input || {},
              };
            });

            const content = textParts.length > 0 ? textParts.join('') : '';

            coreMessages.push({
              role: 'assistant',
              content: [
                ...(content ? [{ type: 'text', text: content }] : []),
                ...toolCalls,
              ],
            });

            // If tool parts have output (state=output-available), create tool result messages
            for (const part of toolParts) {
              if (part.state === 'output-available' && part.output !== undefined) {
                const toolName = part.type.replace('tool-', '');

                // CRITICAL FIX: Wrap output in the correct { type, value } schema
                const wrappedOutput = typeof part.output === 'string'
                  ? { type: 'text', value: part.output }
                  : { type: 'json', value: part.output };

                coreMessages.push({
                  role: 'tool',
                  content: [{
                    type: 'tool-result',
                    toolCallId: part.toolCallId,
                    toolName: toolName,
                    output: wrappedOutput,
                  }],
                });
              }
            }
          } else {
            // Regular message with text content
            const content = textParts.join('');
            if (content) {
              coreMessages.push({
                role: msg.role,
                content: content,
              });
            }
          }
        } else {
          // Message without parts (already in simple format)
          if (msg.content) {
            coreMessages.push({
              role: msg.role,
              content: msg.content,
            });
          }
        }
      }

      messages = coreMessages;
    } else {
      // Messages are already in simple/core format
      messages = rawMessages;
    }

    const result = streamText({
      model,
      messages,
      system: getSystemPrompt(),

      tools: {
        // ========== Shared Tools ==========

        list_files: tool({
          description: 'List files and directories in the project. IMPORTANT: Start with "/" to see the entire project structure, then explore subdirectories as needed.',
          parameters: z.object({
            path: z.string().describe('Directory path to list. Use "/" to see all files, or "/contracts/" or "/dapp/" for specific sections. Start with "/" when unsure what files exist.'),
          }),
        }),

        read_file: tool({
          description: "Read a file's content by path",
          parameters: z.object({
            path: z.string().describe('File path to read'),
          }),
        }),

        write_file: tool({
          description: 'Create or update a file',
          parameters: z.object({
            path: z.string().describe('File path (must start with /blueprints/, /contracts/, /tests/, or /dapp/)'),
            content: z.string().describe('Full file content'),
          }),
        }),

        delete_file: tool({
          description: 'Delete a file by path',
          parameters: z.object({
            path: z.string().describe('File path to delete'),
          }),
        }),

        get_project_structure: tool({
          description: 'Get tree view of entire project',
          parameters: z.object({
            _unused: z.string().optional().describe('Unused parameter'),
          }),
        }),

        // ========== Blueprint Tools ==========

        validate_blueprint: tool({
          description: 'Validate blueprint syntax and structure (static analysis)',
          parameters: z.object({
            path: z.string().describe('Path to blueprint file'),
          }),
        }),

        list_methods: tool({
          description: 'List all @public and @view methods in blueprint',
          parameters: z.object({
            path: z.string().describe('Path to blueprint file'),
          }),
        }),

        compile_blueprint: tool({
          description: 'Compile blueprint in browser using Pyodide',
          parameters: z.object({
            path: z.string().describe('Path to blueprint file'),
          }),
        }),

        execute_method: tool({
          description: 'Execute a blueprint method (initialize, @public, or @view)',
          parameters: z.object({
            path: z.string().describe('Path to blueprint file'),
            method_name: z.string().describe('Method name (e.g., "initialize", "increment")'),
            args: z.array(z.any()).optional().describe('Method arguments (default: [])'),
            caller_address: z.string().optional().describe('Caller address (optional)'),
          }),
        }),

        run_tests: tool({
          description: 'Run pytest tests in browser using Pyodide. IMPORTANT: test_path parameter is required.',
          parameters: z.object({
            test_path: z.string().describe('Path to test file (e.g., /tests/test_counter.py) - REQUIRED'),
          }),
        }),

        // ========== dApp Tools (BEAM Sandbox) ==========

        deploy_dapp: tool({
          description: 'Deploy all /dapp/ files to BEAM sandbox. Creates sandbox if needed, uploads files, starts dev server.',
          parameters: z.object({
            _unused: z.string().optional().describe('No parameters needed'),
          }),
        }),

        upload_files: tool({
          description: 'Upload specific files to BEAM sandbox (for incremental updates)',
          parameters: z.object({
            paths: z.array(z.string()).describe('Array of file paths to upload (e.g., ["/dapp/app/page.tsx"])'),
          }),
        }),

        get_sandbox_url: tool({
          description: 'Get the live URL of the deployed dApp sandbox',
          parameters: z.object({
            _unused: z.string().optional().describe('No parameters needed'),
          }),
        }),

        restart_dev_server: tool({
          description: 'Restart the Next.js dev server in the sandbox',
          parameters: z.object({
            _unused: z.string().optional().describe('No parameters needed'),
          }),
        }),

        bootstrap_nextjs: tool({
          description: 'Create a new Next.js project scaffold with TypeScript and Tailwind',
          parameters: z.object({
            use_typescript: z.boolean().optional().describe('Use TypeScript (default: true)'),
            use_tailwind: z.boolean().optional().describe('Use Tailwind CSS (default: true)'),
          }),
        }),

        run_command: tool({
          description: 'Execute a shell command in the BEAM sandbox (e.g., npm install, npm run build)',
          parameters: z.object({
            command: z.string().describe('Shell command to execute'),
          }),
        }),

        read_sandbox_files: tool({
          description: 'Read files from BEAM sandbox back to IDE (two-way sync). Use after running commands that generate files.',
          parameters: z.object({
            path: z.string().optional().describe('Directory path to read from (default: /app)'),
          }),
        }),

        get_sandbox_logs: tool({
          description: 'Get recent logs from the sandbox dev server for debugging',
          parameters: z.object({
            lines: z.number().optional().describe('Number of log lines to retrieve (default: 50)'),
          }),
        }),
      },

      // NO maxSteps - client handles multi-turn via sendAutomaticallyWhen
      // The server just defines tools, client executes them via onToolCall
      // Braintrust tracing is handled automatically via wrapAISDKModel()
    });

    return result.toUIMessageStreamResponse();
  } catch (error: any) {
    console.error('Chat API error:', error);
    return new Response(
      JSON.stringify({
        error: error.message || 'Failed to process chat request',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}
