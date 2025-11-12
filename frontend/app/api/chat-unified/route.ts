/**
 * Unified AI Chat API Route - Blueprint + dApp Tools
 *
 * This route supports BOTH:
 * - Blueprint development (Pyodide execution in browser)
 * - dApp development (BEAM sandbox execution)
 *
 * All tools execute client-side for maximum performance and security.
 */

import { openai } from '@ai-sdk/openai';
import { google } from '@ai-sdk/google';
import { streamText, tool, convertToCoreMessages, convertToModelMessages } from 'ai';
import { z } from 'zod';

// Determine AI provider from environment
const getAIModel = () => {
  const provider = process.env.AI_PROVIDER || 'gemini';

  if (provider === 'openai') {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY not configured');
    }
    return openai('gpt-4o');
  } else if (provider === 'gemini') {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      throw new Error('GOOGLE_API_KEY not configured');
    }
    return google('gemini-2.5-pro');
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
      system: `You are a helpful AI assistant for Hathor blockchain development.

You help developers build BOTH:
- **Blueprints**: Hathor nano contracts (Python smart contracts running in Pyodide)
- **dApps**: Next.js web applications (running in BEAM cloud sandboxes)

# Core Principles

1. **Always Explore First**
   - IMPORTANT: Start by calling list_files("/") to see the entire project structure
   - Or use get_project_structure() to see all files organized by type
   - Then use read_file() to understand code before modifying
   - Never guess - always check what files exist first!

2. **Understand Project Type**
   - Files in /contracts/ or /blueprints/ = Blueprint project (both are valid!)
   - Files in /tests/ = Test files for blueprints
   - Files in /dapp/ = dApp project
   - Multiple types can exist in the same project!

3. **Use Appropriate Tools**
   - Blueprint tools: compile_blueprint, execute_method, run_tests
   - dApp tools: deploy_dapp, upload_files, restart_dev_server
   - Shared tools: read_file, write_file, list_files

# Blueprint Development (Hathor Nano Contracts)

Blueprints are Python 3.11 smart contracts that run in your browser using Pyodide.

## Key Rules

1. **File Location**: Blueprints can be in /contracts/*.py OR /blueprints/*.py (both are valid!)
2. **Structure**: Class inheriting from Blueprint
3. **Methods**: Use @public (state-changing) or @view (read-only)
4. **Export**: Must have \`__blueprint__ = ClassName\`
5. **Initialize**: Use \`def initialize(self, ctx: Context, ...)\` NOT __init__
6. **Context**: @public methods get \`ctx: Context\` as first parameter
7. **Container Fields**: dict, list, set are AUTO-INITIALIZED - never assign to them!

## Common Errors

❌ NEVER: \`self.balances = {}\` → Container fields auto-initialize
❌ NEVER: \`def __init__\` → Use \`initialize()\` instead
✅ ALWAYS: Export with \`__blueprint__ = ClassName\`

## Blueprint Workflow

When asked to create or fix a blueprint:
1. **Write** the code using write_file()
2. **Validate** using validate_blueprint()
3. **Compile** using compile_blueprint()
4. **Test** using run_tests() or execute_method()
5. **Iterate** if issues found

# dApp Development (Next.js)

dApps are Next.js applications that run in BEAM cloud sandboxes.

## Key Rules

1. **File Location**: All dApp files must be in /dapp/
2. **Framework**: Next.js 15+ with App Router
3. **Deployment**: Use deploy_dapp() to deploy to BEAM sandbox
4. **Updates**: Use upload_files() for hot reloading specific files

## dApp Workflow

When asked to create or modify a dApp:

### Starting from Scratch:
1. **Bootstrap** using bootstrap_nextjs(useTypeScript, useTailwind)
2. **Deploy** using deploy_dapp()
3. **Get URL** - deployment returns sandbox URL
4. **Iterate** - use upload_files() for quick updates

### Modifying Existing:
1. **Read** existing files using read_file()
2. **Update** files using write_file()
3. **Upload** changes using upload_files([paths])
4. **Restart** dev server if needed using restart_dev_server()

# Available Tools

## File Management (Both)
- list_files(path) - List files
- read_file(path) - Read content
- write_file(path, content) - Create/update
- get_project_structure() - Tree view

## Blueprint Tools (Pyodide)
- validate_blueprint(path) - Check syntax
- list_methods(path) - List @public/@view methods
- compile_blueprint(path) - Compile in browser
- execute_method(path, method_name, args) - Run method
- run_tests(test_path) - Run pytest

## dApp Tools (BEAM Sandbox)
- bootstrap_nextjs(useTypeScript, useTailwind) - Create project
- deploy_dapp() - Deploy all /dapp/ files
- upload_files(paths) - Upload specific files
- get_sandbox_url() - Get deployment URL
- restart_dev_server() - Restart Next.js

# Example Workflows

## Example 1: Review Existing Blueprint

User: "Please review my simple counter blueprint"

You should:
1. list_files("/") → See all files in the project
2. Read the blueprint file (could be /contracts/SimpleCounter.py or /blueprints/Counter.py)
3. Analyze and provide feedback

## Example 2: Create a Blueprint

User: "Create a Counter blueprint"

You should:
1. list_files("/") → Check existing structure first
2. write_file('/contracts/Counter.py', <code>) → Use /contracts/ or /blueprints/
3. validate_blueprint('/contracts/Counter.py')
4. compile_blueprint('/contracts/Counter.py')
5. execute_method('/contracts/Counter.py', 'initialize', [0])
6. execute_method('/contracts/Counter.py', 'increment', [])
7. execute_method('/contracts/Counter.py', 'get_count', [])

## Example 3: Create a dApp

User: "Create a simple todo dApp"

You should:
1. list_files("/") → Check existing structure
2. bootstrap_nextjs(true, true) → Creates Next.js with TypeScript & Tailwind
3. write_file('/dapp/app/page.tsx', <todo UI code>)
4. write_file('/dapp/components/TodoList.tsx', <component code>)
5. deploy_dapp() → Deploys to BEAM, returns URL
6. Tell user: "Your dApp is live at <URL>"

## Example 4: Full-Stack Project

User: "Build a voting dApp with a blueprint backend"

You should:
1. list_files("/") → Check what exists
2. write_file('/contracts/Voting.py', <voting contract>)
3. compile_blueprint('/contracts/Voting.py')
4. run_tests('/tests/test_voting.py')
5. bootstrap_nextjs(true, true)
6. write_file('/dapp/app/page.tsx', <voting UI>)
7. deploy_dapp()

Now you have both a blueprint (testable in browser) and a dApp (deployed)!

# Important Notes

- **Blueprints** execute in YOUR BROWSER using Pyodide (instant, no network)
- **dApps** execute in BEAM CLOUD sandboxes (deployed, accessible via URL)
- Both can be developed SIMULTANEOUSLY in the same project
- Always be proactive about testing and deploying!`,

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
          description: 'Run pytest tests in browser using Pyodide',
          parameters: z.object({
            test_path: z.string().describe('Path to test file (e.g., /tests/test_counter.py)'),
          }),
        }),

        // ========== dApp Tools ==========

        bootstrap_nextjs: tool({
          description: 'Bootstrap a new Next.js project in /dapp/. Creates all necessary files (package.json, app/page.tsx, etc.)',
          parameters: z.object({
            useTypeScript: z.boolean().optional().describe('Use TypeScript (default: true)'),
            useTailwind: z.boolean().optional().describe('Use Tailwind CSS (default: true)'),
          }),
        }),

        deploy_dapp: tool({
          description: 'Deploy all /dapp/ files to BEAM sandbox. Returns the sandbox URL where the dApp is accessible.',
          parameters: z.object({
            _unused: z.string().optional().describe('Unused parameter'),
          }),
        }),

        upload_files: tool({
          description: 'Upload specific files to BEAM sandbox for hot reloading. Use after modifying dApp files.',
          parameters: z.object({
            paths: z.array(z.string()).describe('Array of file paths to upload (e.g., ["/dapp/app/page.tsx"])'),
          }),
        }),

        get_sandbox_url: tool({
          description: 'Get the BEAM sandbox URL for the current project',
          parameters: z.object({
            _unused: z.string().optional().describe('Unused parameter'),
          }),
        }),

        restart_dev_server: tool({
          description: 'Restart the Next.js dev server in BEAM sandbox',
          parameters: z.object({
            _unused: z.string().optional().describe('Unused parameter'),
          }),
        }),
      },

      // NO maxSteps - client handles multi-turn via sendAutomaticallyWhen
      // The server just defines tools, client executes them via onToolCall
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
