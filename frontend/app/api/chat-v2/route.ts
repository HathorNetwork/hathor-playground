/**
 * AI Chat API Route with Client-Side Tool Execution
 *
 * This route uses Vercel AI SDK to stream LLM responses.
 * Tools are defined here but execute on the CLIENT SIDE.
 *
 * Security:
 * - API keys stay on server (this file)
 * - Tools execute in browser (via onToolCall in frontend)
 * - No file uploads needed (files stay in browser)
 */

import { openai } from '@ai-sdk/openai';
import { streamText, tool } from 'ai';
import { z } from 'zod';

// Determine AI provider from environment
const getAIModel = () => {
  const provider = process.env.AI_PROVIDER || 'openai';

  if (provider === 'openai') {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY not configured');
    }
    return openai('gpt-4o');
  }

  // Add Gemini support later if needed
  throw new Error(`Unsupported AI provider: ${provider}`);
};

export async function POST(req: Request) {
  try {
    const { messages } = await req.json();

    const model = getAIModel();

    const result = streamText({
      model,
      messages,
      system: `You are a helpful AI assistant for Hathor blockchain development.

You help developers build:
- **Blueprints**: Hathor nano contracts (Python smart contracts)
- **dApps**: Next.js web applications

# Core Principles

1. **Always Explore First**
   - Use list_files() to see project structure
   - Use read_file() to understand code before modifying
   - Never guess - always check!

2. **Clear Communication**
   - Explain what you're doing and why
   - Show which tools you're using
   - Provide helpful context

3. **Iterative Development**
   - After writing code, validate it
   - After validating, compile it
   - After compiling, test it
   - If tests fail, fix and repeat

# Blueprint Development (Hathor Nano Contracts)

Blueprints are Python 3.11 smart contracts for Hathor blockchain.

## Key Rules

1. **File Location**: All blueprints must be in /blueprints/*.py
2. **Structure**: Class inheriting from Blueprint
3. **Methods**: Use @public (state-changing) or @view (read-only)
4. **Export**: Must have \`__blueprint__ = ClassName\`
5. **Initialize**: Use \`def initialize(self, ctx: Context, ...)\` NOT __init__
6. **Context**: @public methods get \`ctx: Context\` as first parameter
7. **Container Fields**: dict, list, set are AUTO-INITIALIZED - never assign to them!

## Common Errors to Avoid

❌ NEVER: \`self.balances = {}\` → Container fields auto-initialize
❌ NEVER: \`def __init__\` → Use \`initialize()\` instead
❌ NEVER: \`ctx.address\` → Use \`ctx.vertex.hash\` for caller
✅ ALWAYS: Export with \`__blueprint__ = ClassName\`

## Development Workflow

When asked to create or fix a blueprint:

1. **Write the code** using write_file()
2. **Validate** using validate_blueprint()
3. **Fix any issues** found during validation
4. **Compile** using compile_blueprint()
5. **Test** using run_tests()
6. **If tests fail**, analyze the error, fix the code, and repeat from step 2

## Available Tools

You have access to these tools that execute in the user's browser:

### File Management
- \`list_files(path)\` - List files in project
- \`read_file(path)\` - Read file content
- \`write_file(path, content)\` - Create/update files
- \`get_project_structure()\` - See full project tree

### Blueprint Development
- \`validate_blueprint(path)\` - Check blueprint syntax/structure
- \`list_methods(path)\` - List all @public and @view methods
- \`compile_blueprint(path)\` - Compile blueprint in browser Pyodide
- \`execute_method(path, method_name, args)\` - Run a blueprint method
- \`run_tests(test_path)\` - Run tests in browser Pyodide

## Tool Execution

All tools run in the user's browser using Pyodide (WebAssembly Python runtime).
This means:
- Execution is FAST (no network round-trips)
- Execution is SAFE (sandboxed in browser)
- You can iterate quickly (compile, test, fix, repeat)

## Example Workflow

User: "Create a Counter blueprint with increment and decrement methods"

You should:
1. write_file('/blueprints/Counter.py', <code>)
2. validate_blueprint('/blueprints/Counter.py')
3. If validation passes: compile_blueprint('/blueprints/Counter.py')
4. execute_method('/blueprints/Counter.py', 'initialize', [0])
5. execute_method('/blueprints/Counter.py', 'increment', [])
6. Explain the results to the user

Always be proactive about validating, compiling, and testing the code you write!`,

      // Define tools (these will execute on the CLIENT SIDE)
      tools: {
        // ========== File Management Tools ==========

        list_files: tool({
          description: 'List files and directories in the project',
          parameters: z.object({
            path: z.string().default('/').describe('Directory path to list (default: /)'),
          }),
          // No execute function = runs on client!
        }),

        read_file: tool({
          description: "Read a file's content by path",
          parameters: z.object({
            path: z.string().describe('File path to read (e.g., /blueprints/Counter.py)'),
          }),
        }),

        write_file: tool({
          description: 'Create or update a file in the project',
          parameters: z.object({
            path: z.string().describe('File path (must start with /blueprints/, /contracts/, /tests/, or /dapp/)'),
            content: z.string().describe('Full file content to write'),
          }),
        }),

        get_project_structure: tool({
          description: 'Get a tree view of the entire project structure',
          parameters: z.object({}),
        }),

        // ========== Blueprint Validation Tools ==========

        validate_blueprint: tool({
          description: 'Validate blueprint syntax and structure (static analysis)',
          parameters: z.object({
            path: z.string().describe('Path to blueprint file (e.g., /blueprints/Counter.py)'),
          }),
        }),

        list_methods: tool({
          description: 'List all @public and @view methods in a blueprint',
          parameters: z.object({
            path: z.string().describe('Path to blueprint file'),
          }),
        }),

        // ========== Pyodide Execution Tools ==========

        compile_blueprint: tool({
          description: 'Compile a blueprint contract in the browser using Pyodide. This deploys it to the in-browser blockchain.',
          parameters: z.object({
            path: z.string().describe('Path to blueprint file to compile'),
          }),
        }),

        execute_method: tool({
          description: 'Execute a blueprint method (initialize, @public, or @view) in the browser using Pyodide',
          parameters: z.object({
            path: z.string().describe('Path to blueprint file'),
            method_name: z.string().describe('Method name to execute (e.g., "initialize", "increment")'),
            args: z.array(z.any()).default([]).describe('Method arguments as JSON array'),
            caller_address: z.string().optional().describe('Caller address (optional, defaults to test address)'),
          }),
        }),

        run_tests: tool({
          description: 'Run pytest tests for a blueprint in the browser using Pyodide',
          parameters: z.object({
            test_path: z.string().describe('Path to test file (e.g., /tests/test_counter.py)'),
          }),
        }),
      },

      maxSteps: 10, // Allow multiple tool calls in sequence
    });

    return result.toDataStreamResponse();
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
