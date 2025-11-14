# Hathor Playground - Tool Registration & Execution Architecture

## Executive Summary

This is a **client-side tool execution system** where the AI agent (Claude/Gemini) makes decisions about which tools to call, but the actual tool execution happens entirely in the browser. The system supports both:

1. **Blueprint Development** - Python smart contracts compiled/executed in Pyodide (browser WebAssembly)
2. **dApp Development** - Next.js applications deployed to BEAM cloud sandboxes

The critical insight is: **The AI defines tools in the API route, the frontend executes them via `onToolCall` callback**.

---

## 1. How Tools Are Registered (Backend)

### Location: `/frontend/app/api/chat-unified/route.ts`

Tools are defined in the **Next.js API route** using the `ai` SDK's `tool()` function. This is where the AI sees the available tools.

```typescript
export async function POST(req: Request) {
  const result = streamText({
    model: getAIModel(),
    messages,
    system: `You are a helpful AI assistant...`,
    
    tools: {
      // SHARED FILE TOOLS (execute against Zustand store)
      list_files: tool({
        description: 'List files and directories in the project',
        parameters: z.object({
          path: z.string().describe('Directory path to list')
        })
      }),
      
      read_file: tool({
        description: "Read a file's content by path",
        parameters: z.object({
          path: z.string().describe('File path to read')
        })
      }),
      
      write_file: tool({
        description: 'Create or update a file',
        parameters: z.object({
          path: z.string().describe('File path'),
          content: z.string().describe('Full file content')
        })
      }),
      
      // BLUEPRINT TOOLS (execute in Pyodide)
      compile_blueprint: tool({
        description: 'Compile blueprint in browser using Pyodide',
        parameters: z.object({
          path: z.string().describe('Path to blueprint file')
        })
      }),
      
      execute_method: tool({
        description: 'Execute a blueprint method',
        parameters: z.object({
          path: z.string().describe('Path to blueprint file'),
          method_name: z.string().describe('Method name'),
          args: z.array(z.any()).optional().describe('Method arguments')
        })
      }),
      
      run_tests: tool({
        description: 'Run pytest tests in browser using Pyodide',
        parameters: z.object({
          test_path: z.string().describe('Path to test file')
        })
      }),
      
      // DAPP TOOLS (execute via BEAM client)
      bootstrap_nextjs: tool({
        description: 'Bootstrap a new Next.js project',
        parameters: z.object({
          useTypeScript: z.boolean().optional(),
          useTailwind: z.boolean().optional()
        })
      }),
      
      deploy_dapp: tool({
        description: 'Deploy all /dapp/ files to BEAM sandbox',
        parameters: z.object({
          _unused: z.string().optional()
        })
      }),
      
      upload_files: tool({
        description: 'Upload specific files to BEAM sandbox',
        parameters: z.object({
          paths: z.array(z.string()).describe('Array of file paths')
        })
      }),
      
      restart_dev_server: tool({
        description: 'Restart the Next.js dev server',
        parameters: z.object({
          _unused: z.string().optional()
        })
      }),
      
      // ... more tools
    },
  });
  
  return result.toUIMessageStreamResponse();
}
```

**Key Points:**
- Tools are defined server-side but **execution happens client-side**
- Uses Zod for parameter validation
- Parameters are streamed as JSON when the AI decides to call a tool
- The API route does NOT execute tools - it only defines their schemas

---

## 2. Frontend Communication of Tool Executions

### Location: `/frontend/components/RightPanel/AgenticChatUnified.tsx`

The frontend receives tool calls via the `useChat` hook and executes them with the `onToolCall` callback.

```typescript
const { messages, setMessages, sendMessage, addToolResult, status } = useChat({
  // Transport layer for message streaming
  sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
  transport: new DefaultChatTransport({
    api: '/api/chat-unified',  // Backend route that defines tools
  }),

  // THIS IS WHERE TOOL EXECUTION HAPPENS
  async onToolCall({ toolCall }) {
    console.log('🎯 onToolCall TRIGGERED!');
    console.log('🔧 Tool call:', toolCall.toolName, toolCall.input);
    
    // Log to console (visual feedback)
    addConsoleMessage('info', 
      `🔧 Executing: ${toolCall.toolName}(${JSON.stringify(toolCall.input).slice(0, 100)})`
    );

    try {
      let result;

      // Route to appropriate handler based on tool name
      switch (toolCall.toolName) {
        // SHARED TOOLS - access Zustand store
        case 'list_files':
          result = await AIToolsClient.listFiles(toolCall.input.path || '/');
          break;

        case 'write_file':
          result = await AIToolsClient.writeFile(
            toolCall.input.path, 
            toolCall.input.content
          );
          break;

        // BLUEPRINT TOOLS - execute in Pyodide
        case 'compile_blueprint':
          result = await AIToolsClient.compileBlueprint(toolCall.input.path);
          break;

        case 'execute_method':
          result = await AIToolsClient.executeMethod(
            toolCall.input.path,
            toolCall.input.method_name,
            toolCall.input.args || [],
            toolCall.input.caller_address
          );
          break;

        case 'run_tests':
          result = await AIToolsClient.runTests(toolCall.input.test_path);
          break;

        // DAPP TOOLS - execute via BEAM client
        case 'bootstrap_nextjs':
          result = await AIToolsClient.bootstrapNextJS(
            toolCall.input.useTypeScript ?? true,
            toolCall.input.useTailwind ?? true
          );
          break;

        case 'deploy_dapp':
          result = await AIToolsClient.deployDApp();
          break;

        case 'upload_files':
          result = await AIToolsClient.uploadFiles(toolCall.input.paths);
          break;

        default:
          result = {
            success: false,
            message: `Unknown tool: ${toolCall.toolName}`,
            error: 'Tool not implemented'
          };
      }

      // Log result
      console.log('Tool call result:', result);
      
      // Notify user
      if (result.success) {
        addConsoleMessage('success', result.message);
      } else {
        addConsoleMessage('error', result.message);
      }

      // Send result back to AI for continued reasoning
      addToolResult({
        tool: toolCall.toolName,
        toolCallId: toolCall.toolCallId,
        output: result.data,
      });

    } catch (error: any) {
      const errorMsg = `Tool execution failed: ${error.message}`;
      addConsoleMessage('error', `❌ ${errorMsg}`);
      
      addToolResult({
        state: 'output-error',
        tool: toolCall.toolName,
        toolCallId: toolCall.toolCallId,
        errorText: errorMsg,
      });
    }
  },

  onError(error) {
    console.error('Chat error:', error);
    addConsoleMessage('error', `❌ Chat error: ${error.message}`);
  },
});
```

**Communication Flow:**

```
1. Frontend sends user message to /api/chat-unified
   ├─ Body: { messages: [...] }
   └─ HTTP POST

2. Backend streams response with tool calls
   ├─ SSE/ReadableStream
   ├─ Tool call format:
   │  {
   │    toolCallId: "uuid",
   │    toolName: "compile_blueprint",
   │    input: { path: "/blueprints/Counter.py" }
   │  }
   └─ Streamed to client

3. Frontend intercepts tool call in onToolCall callback
   ├─ Routes to AIToolsClient.[toolName]()
   ├─ Executes locally (Pyodide, Zustand, or BEAM client)
   └─ Gets result

4. Frontend sends tool result back to API
   ├─ Via addToolResult()
   ├─ Includes toolCallId for correlation
   └─ API streams final response to client
```

---

## 3. Tool Execution Logic - "🔧 Executing: run_tests({})"

The message "🔧 Executing: run_tests({})" comes from this line in `AgenticChatUnified.tsx`:

```typescript
addConsoleMessage('info', 
  `🔧 Executing: ${toolCall.toolName}(${JSON.stringify(toolCall.input).slice(0, 100)})`
);
```

This happens **before** the actual tool execution. It's a UI notification that logs to the console panel.

### Where is the Console Display?

The console is rendered in the left panel (stored in Zustand's `consoleMessages` array):

```typescript
// In ide-store.ts
interface IDEState {
  consoleMessages: ConsoleMessage[];  // Displayed in left panel
  addConsoleMessage: (type: 'info' | 'error' | 'warning' | 'success', message: string) => void;
}

// Called from AgenticChatUnified.tsx
addConsoleMessage('info', `🔧 Executing: compile_blueprint({...})`);
addConsoleMessage('success', `✅ Compiled /blueprints/Counter.py`);
addConsoleMessage('error', `❌ Compilation failed: SyntaxError`);
```

---

## 4. Tool Parameters Flow

### From AI Decision → Backend Definition → Frontend Execution

**Step 1: AI makes decision**
- Claude/Gemini decides: "I need to compile a blueprint"
- Looks at available tools from backend
- Generates tool call with parameters

**Step 2: Tool definition (backend)**
- API route defines parameter schema using Zod:
  ```typescript
  compile_blueprint: tool({
    parameters: z.object({
      path: z.string().describe('Path to blueprint file')
    })
  })
  ```

**Step 3: Tool call in stream**
- AI sends tool call as JSON:
  ```json
  {
    "toolCallId": "call_123",
    "toolName": "compile_blueprint",
    "input": {
      "path": "/blueprints/Counter.py"
    }
  }
  ```

**Step 4: Frontend extraction**
- `onToolCall` callback receives `toolCall` object:
  ```typescript
  const toolName = toolCall.toolName;  // "compile_blueprint"
  const args = toolCall.input || {};    // { path: "/blueprints/Counter.py" }
  ```

**Step 5: Dispatch to handler**
- Frontend routes to appropriate handler:
  ```typescript
  switch (toolCall.toolName) {
    case 'compile_blueprint':
      result = await AIToolsClient.compileBlueprint(args.path);
      break;
  }
  ```

---

## 5. Complete Flow: AI Decision → Tool Execution → Result Display

### Scenario: "Create a Counter blueprint and test it"

```
┌─────────────────────────────────────────────────────────────────┐
│ STEP 1: User Input                                              │
└─────────────────────────────────────────────────────────────────┘
User: "Create a Counter blueprint and run tests"
  ↓
Frontend sends to /api/chat-unified
  {
    messages: [
      {
        role: "user",
        content: "Create a Counter blueprint and run tests"
      }
    ]
  }


┌─────────────────────────────────────────────────────────────────┐
│ STEP 2: AI Reasoning (Backend)                                  │
└─────────────────────────────────────────────────────────────────┘
Backend receives request:
  ├─ Calls OpenAI/Gemini with system prompt
  ├─ AI sees available tools (compile_blueprint, write_file, etc.)
  ├─ AI decides: 
  │   1. write_file(/blueprints/Counter.py, code)
  │   2. compile_blueprint(/blueprints/Counter.py)
  │   3. write_file(/tests/test_counter.py, tests)
  │   4. run_tests(/tests/test_counter.py)
  └─ Streams tool calls back to frontend


┌─────────────────────────────────────────────────────────────────┐
│ STEP 3: Tool Execution (Frontend - Browser)                    │
└─────────────────────────────────────────────────────────────────┘

Tool Call 1: write_file
  ├─ Frontend receives: { toolName: "write_file", input: { path: "...", content: "..." } }
  ├─ onToolCall triggers
  ├─ Logs: "🔧 Executing: write_file(...)"  → Console
  ├─ Calls: AIToolsClient.writeFile()
  │   └─ Updates Zustand store (useIDEStore.getState().addFile(...))
  ├─ Returns: { success: true, data: { path, action: "created" } }
  ├─ Logs: "✅ Created /blueprints/Counter.py"  → Console
  └─ Calls: addToolResult({ tool: "write_file", output: {...} })

Tool Call 2: compile_blueprint
  ├─ Frontend receives: { toolName: "compile_blueprint", input: { path: "/blueprints/Counter.py" } }
  ├─ Logs: "🔧 Executing: compile_blueprint(...)"  → Console
  ├─ Calls: AIToolsClient.compileBlueprint()
  │   ├─ Initializes Pyodide if needed
  │   ├─ Calls: pyodideRunner.compileContract()
  │   │   └─ Runs Python code in browser WebAssembly
  │   └─ Updates Zustand: setCompiledContract()
  ├─ Returns: { success: true, data: { blueprint_id: "uuid" } }
  ├─ Logs: "✅ Compiled /blueprints/Counter.py"  → Console
  └─ Calls: addToolResult({ tool: "compile_blueprint", output: {...} })

Tool Call 3: write_file (tests)
  ├─ Similar flow...
  └─ Calls: addToolResult(...)

Tool Call 4: run_tests
  ├─ Frontend receives: { toolName: "run_tests", input: { test_path: "/tests/test_counter.py" } }
  ├─ Logs: "🔧 Executing: run_tests(...)"  → Console
  ├─ Calls: AIToolsClient.runTests()
  │   ├─ Reads test file from Zustand
  │   ├─ Calls: pyodideRunner.runTests()
  │   │   └─ Pytest runs in browser WebAssembly
  │   └─ Returns: { success: true, tests_passed: 5, tests_run: 5 }
  ├─ Logs: "✅ Tests completed: 5/5 passed\n..."  → Console
  └─ Calls: addToolResult({ tool: "run_tests", output: {...} })


┌─────────────────────────────────────────────────────────────────┐
│ STEP 4: Result Streaming Back to AI (Frontend → Backend)       │
└─────────────────────────────────────────────────────────────────┘
Each addToolResult() call:
  ├─ Sends: { toolCallId: "...", output: {...} }
  └─ Included in next message to /api/chat-unified


┌─────────────────────────────────────────────────────────────────┐
│ STEP 5: AI Final Response (Backend)                             │
└─────────────────────────────────────────────────────────────────┘
Backend receives all tool results:
  ├─ AI reviews results
  ├─ Generates final response:
  │   "✅ I've successfully created your Counter blueprint!
  │    
  │    Files created:
  │    - /blueprints/Counter.py
  │    - /tests/test_counter.py
  │    
  │    Tests: 5/5 passed ✅
  │    
  │    The Counter blueprint is ready to use!"
  └─ Streams to frontend


┌─────────────────────────────────────────────────────────────────┐
│ STEP 6: Display Results (Frontend UI)                           │
└─────────────────────────────────────────────────────────────────┘
Console panel shows:
  ├─ 🔧 Executing: write_file(...)
  ├─ ✅ Created /blueprints/Counter.py
  ├─ 🔧 Executing: compile_blueprint(...)
  ├─ ✅ Compiled /blueprints/Counter.py
  ├─ 🔧 Executing: write_file(...)
  ├─ ✅ Created /tests/test_counter.py
  ├─ 🔧 Executing: run_tests(...)
  └─ ✅ Tests completed: 5/5 passed

Chat panel shows:
  ├─ User message: "Create a Counter blueprint..."
  ├─ Tool invocations displayed (in AgenticChatUnified.tsx)
  │   ├─ write_file (args collapsed/expanded)
  │   ├─ compile_blueprint (args and result)
  │   ├─ write_file (tests)
  │   └─ run_tests (args and result)
  └─ AI response: "✅ I've successfully created your Counter blueprint!"

Left panel shows:
  └─ File tree updated:
     ├─ /blueprints/Counter.py (NEW - highlighted)
     └─ /tests/test_counter.py (NEW - highlighted)
```

---

## 6. Key Files to Understand This Architecture

### 1. **Tool Definition Layer**
   - `/frontend/app/api/chat-unified/route.ts` (195 lines)
     - Defines all available tools and their schemas
     - Uses `ai` SDK's `tool()` and Zod for validation
     - Routes messages to OpenAI/Gemini

### 2. **Frontend Tool Dispatch**
   - `/frontend/components/RightPanel/AgenticChatUnified.tsx` (481 lines)
     - Uses `useChat()` hook from `@ai-sdk/react`
     - Implements `onToolCall` callback for tool execution
     - Routes tool calls to AIToolsClient
     - Displays tool execution in UI

### 3. **Client-Side Tool Implementation**
  - `/frontend/lib/tools/files.ts`, `/frontend/lib/tools/blueprints.ts`, `/frontend/lib/tools/beam.ts`, `/frontend/lib/tools/sync.ts`
     - Implements all tool handlers
     - Three categories:
       - **Shared tools**: File operations via Zustand
       - **Blueprint tools**: Pyodide compilation/execution
       - **dApp tools**: BEAM client API calls

### 4. **State Management (Source of Truth)**
   - `/frontend/store/ide-store.ts`
     - Zustand store with all project files
     - Accessed by AIToolsClient for file operations
     - Stores console messages

### 5. **Execution Environments**
   - `/frontend/lib/pyodide-runner.ts` (200+ lines)
     - Loads Pyodide from CDN
     - Compiles and executes Python blueprints
     - Runs pytest tests in browser
   
   - `/frontend/lib/beam-client.ts` (150+ lines)
     - API calls to BEAM sandbox
     - Deploys dApp files
     - Manages dev server

### 6. **Message Display**
   - `/frontend/components/RightPanel/ChatMessage.tsx` (195 lines)
     - Renders user and assistant messages
     - Displays tool invocations with args/results
     - Markdown rendering for assistant responses

### 7. **Architecture Documentation**
   - `/UNIFIED_ARCHITECTURE.md` (16KB)
     - Complete system overview
     - Flow diagrams
     - Component descriptions
   - `/UNIFIED_AGENT.md` (9KB)
     - Agent capabilities
     - Tool definitions

---

## 7. Critical Execution Points

### Where "🔧 Executing: run_tests({})" appears:

**File:** `/frontend/components/RightPanel/AgenticChatUnified.tsx`  
**Line 55:**
```typescript
addConsoleMessage('info', `🔧 Executing: ${toolName}(${JSON.stringify(args).slice(0, 100)})`);
```

This adds a message to the console before the tool actually executes.

### Actual Tool Execution:

**Line 102:**
```typescript
case 'run_tests':
  result = await blueprintTools.runTests(args.test_path);
  break;
```

This calls the actual implementation in the blueprint tools module.

### Result Display:

**File:** `/frontend/lib/tools/blueprints.ts`  
**Runtime snippet:**
```typescript
if (result.success) {
  const passRate = result.tests_run
    ? `${result.tests_passed}/${result.tests_run} passed`
    : 'unknown';

  return {
    success: true,
    message: `✅ Tests completed: ${passRate}\n\n${result.output}`,
    data: {
      tests_run: result.tests_run,
      tests_passed: result.tests_passed,
      tests_failed: result.tests_failed,
      output: result.output,
    },
  };
}
```

This message is then logged to console:
```typescript
addConsoleMessage('success', result.message);  // Shows ✅ in console
```

---

## 8. Parameter Passing Deep Dive

### Example: `run_tests` Tool Call

**Backend Definition:**
```typescript
run_tests: tool({
  description: 'Run pytest tests in browser using Pyodide',
  parameters: z.object({
    test_path: z.string().describe('Path to test file (e.g., /tests/test_counter.py)'),
  }),
}),
```

**AI Generation:**
```
Tool Decision: "I need to run tests on /tests/test_counter.py"
↓
Tool Call JSON:
{
  "toolCallId": "call_abc123",
  "toolName": "run_tests",
  "input": {
    "test_path": "/tests/test_counter.py"
  }
}
```

**Frontend Extraction:**
```typescript
const toolCall = {
  toolCallId: "call_abc123",
  toolName: "run_tests",
  input: { test_path: "/tests/test_counter.py" }
}

const toolName = toolCall.toolName;              // "run_tests"
const args = toolCall.input || {};                // { test_path: "/tests/test_counter.py" }

result = await AIToolsClient.runTests(args.test_path);  // "/tests/test_counter.py"
```

**Execution:**
```typescript
static async runTests(testPath: string): Promise<ToolResult> {
  // testPath = "/tests/test_counter.py"
  const files = useIDEStore.getState().files;
  const testFile = files.find(f => f.path === testPath);
  
  await pyodideRunner.initialize();
  const result = await pyodideRunner.runTests(
    testFile.content,
    testFile.name
  );
  
  return {
    success: result.success,
    message: `✅ Tests completed: ${result.tests_passed}/${result.tests_run} passed`,
    data: result,
  };
}
```

---

## Summary

This architecture achieves **client-side tool execution** with **server-side AI reasoning** by:

1. **Backend defines tools** - API route uses `ai` SDK to define tool schemas
2. **Backend reasons about tools** - AI (OpenAI/Gemini) decides which tools to call
3. **Backend streams tool calls** - Tool decisions sent as structured JSON
4. **Frontend intercepts calls** - `onToolCall` callback receives tool call objects
5. **Frontend executes locally** - Tools run in browser (Pyodide, Zustand, BEAM client)
6. **Frontend sends results** - `addToolResult` sends execution results back to AI
7. **AI continues reasoning** - With tool results, AI generates final response
8. **Frontend UI updates** - Files, console, and chat react to tool outputs

The key insight: **The AI doesn't execute tools, it decides what tools to call. The frontend executes them and reports results back.**

---

## Files Manifest (Essential Reading Order)

1. `/frontend/app/api/chat-unified/route.ts` - Tool definitions
2. `/frontend/components/RightPanel/AgenticChatUnified.tsx` - Tool dispatch
3. `/frontend/lib/tools/*.ts` - Tool implementations (files/blueprints/beam/sync modules)
4. `/frontend/store/ide-store.ts` - State management
5. `/frontend/lib/pyodide-runner.ts` - Blueprint execution
6. `/frontend/lib/beam-client.ts` - dApp deployment
7. `/frontend/components/RightPanel/ChatMessage.tsx` - Message display
8. `/UNIFIED_ARCHITECTURE.md` - Architecture docs

---

## 9. 2025 Refactor Highlights

- **Modular tools** now live in `frontend/lib/tools/` so file, blueprint, BEAM, and sync behaviors evolve independently.
- **Manifest-based syncing** replaces in-browser git: each `/dapp` file is hashed, compared against a stored manifest, and only changed files are sent in either direction.
- **Sandbox file API** (`/api/beam/sandbox/[projectId]/files`) supports pagination, base64 payloads, and gzip compression to handle large/binary assets safely.
- **SSE command runner** (`/api/beam/sandbox/[projectId]/command/stream`) streams stdout/stderr in real time; `beamTools.runCommand` now surfaces those chunks to the console while still returning aggregated output to the AI.

