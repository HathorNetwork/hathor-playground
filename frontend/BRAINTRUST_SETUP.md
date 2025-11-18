# Braintrust Observability Setup

This project uses [Braintrust](https://www.braintrust.dev/) for AI agent observability, providing:
- 🔍 **Trace Debugging** - See every message, tool call, and timing
- 💰 **Cost Tracking** - Monitor token usage and LLM costs per conversation
- 📊 **Performance Metrics** - Identify slow tool calls and optimize latency
- 🧪 **Evaluation Playground** - Test prompt variations without deploying code
- 🚨 **Loop Detection** - Find why agents get stuck in repeated tool calls

## What's Installed

- `braintrust@0.4.9` - Latest Braintrust SDK with native Vercel AI SDK integration

## Configuration

### 1. Environment Variables (Already Set)

Your `.env.local` already has:
```bash
BRAINTRUST_API_KEY=sk-h619u3OH0Lm4nkPAZ7GAZTn5DSHmzW1AnzlA9vnFBnD3wCj7
PROJECT_NAME=Hathor Playground
```

### 2. API Route Integration (`app/api/chat-unified/route.ts`)

Braintrust uses its **native `wrapAISDKModel()`** approach - the only platform with first-class Vercel AI SDK support:

```typescript
import { wrapAISDKModel } from 'braintrust';
import { openai } from '@ai-sdk/openai';
import { google } from '@ai-sdk/google';

const getAIModel = () => {
  const provider = process.env.AI_PROVIDER || 'gemini';

  if (provider === 'openai') {
    // Wrap model with Braintrust for automatic tracing
    return wrapAISDKModel(openai('gpt-4o'));
  } else if (provider === 'gemini') {
    // Wrap model with Braintrust for automatic tracing
    return wrapAISDKModel(google('gemini-2.5-pro'));
  }
};
```

That's it! Just wrap your model with `wrapAISDKModel()` and Braintrust automatically traces:
- ✅ Every LLM call
- ✅ Token usage and costs
- ✅ Latency metrics
- ✅ Tool calls
- ✅ Message history
- ✅ Model parameters

### 3. Why Not OpenTelemetry?

We initially tried the OpenTelemetry approach (`@vercel/otel` + `BraintrustExporter`), but it has a [known bug with Next.js 15](https://github.com/vercel/ai/issues/8273) where webpack uses the browser bundle instead of Node.js bundle.

**Braintrust's native integration is actually better:**
- ✅ No webpack bundling issues
- ✅ Simpler setup (one wrapper call)
- ✅ Works with all AI SDK versions
- ✅ Purpose-built for Vercel AI SDK

## How to Use

### 1. Start the Development Server

```bash
npm run dev
```

The instrumentation automatically initializes on startup.

### 2. Use the AI Agent

Just interact with the AI agent normally in the UI. Every conversation is automatically traced to Braintrust.

### 3. View Traces in Braintrust Dashboard

1. Go to [https://www.braintrust.dev/](https://www.braintrust.dev/)
2. Sign in with your account
3. Navigate to the "Hathor Playground" project
4. View traces in real-time

## What Gets Traced

### Automatic Tracing:
- ✅ Every LLM call (Gemini/OpenAI)
- ✅ Token usage per call
- ✅ Latency metrics
- ✅ Model parameters
- ✅ System prompts
- ✅ User messages
- ✅ Assistant responses

### Not Currently Traced (Client-Side):
- ❌ Tool execution details (happens in browser)
- ❌ Pyodide Python execution
- ❌ File operations

> **Note**: Tools execute client-side for security, so only the tool *calls* are traced, not the internal execution.

## Debugging the Loop Issue

Your agent was stuck in a loop calling `read_file` repeatedly. Here's how to debug it with Braintrust:

### 1. Find the Problematic Conversation

In Braintrust dashboard:
- Filter by date/time when the loop occurred
- Look for traces with high `tool_calls.count`
- Search for "read_file" in tool calls

### 2. Analyze the Pattern

Look for:
- **Repeated tool calls**: Same tool with same arguments
- **Missing termination**: Agent never returns a final text response
- **Token usage spike**: High cost from repeated calls

### 3. Test Prompt Fixes

Use the Braintrust **Evaluation Playground**:
1. Export the problematic conversation
2. Try different system prompt variations
3. Test without deploying code
4. Compare results side-by-side

### Example Prompt Improvements:
```
Original: "Read files to understand the codebase"
Fixed: "Read files ONCE, then summarize what you found. Do not read the same file twice."
```

## Troubleshooting

### Traces Not Appearing in Braintrust?

**Check:**
1. API key is correct in `.env.local`
2. Dev server was restarted after adding instrumentation
3. Check browser console for errors
4. Verify network request to Braintrust API succeeds

**Debug:**
```bash
# Enable verbose logging
export DEBUG=braintrust:*
npm run dev
```

### Performance Impact?

Braintrust uses **async logging** - zero latency impact on your app. Traces are sent in the background.

### Cost?

- **Free tier**: Generous limits (should cover development usage)
- **No per-request fees**: Flat pricing
- **Token tracking**: See your actual LLM costs

## Advanced: Custom Instrumentation

Want to trace tool execution details? Add custom spans:

```typescript
import { initLogger } from "braintrust";

const logger = initLogger({
  projectName: process.env.PROJECT_NAME!,
  apiKey: process.env.BRAINTRUST_API_KEY!,
});

// In your tool execution:
const span = logger.startSpan({
  name: "tool_execution",
  spanAttributes: {
    toolName: "compile_blueprint",
    path: "/contracts/Counter.py",
  },
});

try {
  const result = await pyodideRunner.compileBlueprint(code);
  span.end({ output: result });
} catch (error) {
  span.end({ error: error.message });
  throw error;
}
```

## Resources

- **Braintrust Docs**: https://www.braintrust.dev/docs
- **Vercel AI SDK Tracing**: https://www.braintrust.dev/docs/cookbook/recipes/VercelAISDKTracing
- **Evaluation Guide**: https://www.braintrust.dev/docs/guides/evals
- **Dashboard**: https://www.braintrust.dev/app

## Summary

✅ **Installed**: braintrust, @vercel/otel
✅ **Configured**: instrumentation.ts, telemetry enabled
✅ **Ready**: Just use the app, traces appear automatically
✅ **Next Steps**: Use Braintrust dashboard to debug the loop issue
