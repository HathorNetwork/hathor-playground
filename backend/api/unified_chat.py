"""
Unified chat API endpoint for blueprint and dApp development.

Automatically detects project type and provides appropriate tools.
Implements context caching for 75% cost reduction.
"""

from typing import List, Dict, Any, Optional
from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from pydantic_ai import Agent, RunContext
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.models.gemini import GeminiModel
from pydantic_ai.messages import ModelRequest, ModelResponse, UserPromptPart, TextPart
import structlog
import os
import json
import asyncio

from api.environment_detector import (
    detect_environment,
    should_enable_blueprint_tools,
    should_enable_dapp_tools,
    EnvironmentType
)
from api.cache_manager import cache_manager
from api.unified_tools import UnifiedTools
from api.beam_service import beam_service
from middleware.rate_limit import limiter

logger = structlog.get_logger()
router = APIRouter()

# Input validation limits
MAX_FILES = 100
MAX_FILE_SIZE = 1_000_000  # 1MB per file
MAX_MESSAGE_LENGTH = 10_000


class UnifiedChatRequest(BaseModel):
    """Request for unified chat"""
    message: str
    project_id: str
    files: Dict[str, str] = Field(default_factory=dict)
    conversation_history: List[Dict[str, str]] = Field(default_factory=list)
    # Optional: Manual environment override
    force_environment: Optional[str] = None


class ToolCall(BaseModel):
    """Representation of a tool call"""
    tool: str
    args: Dict[str, Any]
    result: str


class UnifiedChatResponse(BaseModel):
    """Response from unified chat"""
    success: bool
    message: str
    environment: str  # Detected environment type
    confidence: float  # Detection confidence
    tool_calls: List[ToolCall] = []
    updated_files: Dict[str, str] = {}
    sandbox_url: Optional[str] = None
    error: Optional[str] = None


def get_ai_model():
    """Get AI model based on environment configuration"""
    provider = os.getenv("AI_PROVIDER", "openai").lower()

    if provider == "openai":
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise ValueError("OpenAI API key not configured")
        # Set the API key in environment for OpenAI
        os.environ["OPENAI_API_KEY"] = api_key
        # Use gpt-4o for better performance
        return OpenAIChatModel("gpt-4o")
    elif provider == "gemini":
        api_key = os.getenv("GOOGLE_API_KEY")
        if not api_key:
            raise ValueError("Google API key not configured")
        # Set the API key in environment for Gemini
        os.environ["GOOGLE_API_KEY"] = api_key
        return GeminiModel("gemini-2.5-flash")
    else:
        raise ValueError(f"Unsupported AI provider: {provider}")


def build_system_prompt(
    environment_type: EnvironmentType,
    enable_blueprint_tools: bool,
    enable_dapp_tools: bool
) -> str:
    """
    Build system prompt based on detected environment.

    Adapts guidance to match what the user is working on.
    """
    base_prompt = """You are a helpful AI assistant for Hathor blockchain development.

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

3. **Use Appropriate Tools**
   - Blueprint tools for /blueprints/*.py files
   - dApp tools for /dapp/* files
   - File tools work for both

"""

    # Add blueprint-specific guidance if enabled
    if enable_blueprint_tools:
        base_prompt += """
# Blueprint Development (Hathor Nano Contracts)

Blueprints are Python 3.11 smart contracts for Hathor blockchain.

## Key Rules

1. **File Location**: All blueprints must be in /blueprints/*.py
2. **Structure**: Class inheriting from Blueprint
3. **Methods**: Use @public (state-changing) or @view (read-only)
4. **Export**: Must have `__blueprint__ = ClassName`
5. **Initialize**: Use `def initialize(self, ctx: Context, ...)` NOT __init__
6. **Context**: @public methods get `ctx: Context` as first parameter
7. **Container Fields**: dict, list, set are AUTO-INITIALIZED - never assign to them!

## Common Errors to Avoid

❌ NEVER: `self.balances = {}` → Container fields auto-initialize
❌ NEVER: `def __init__` → Use `initialize()` instead
❌ NEVER: `ctx.address` → Use `ctx.vertex.hash` for caller
✅ ALWAYS: Export with `__blueprint__ = ClassName`
✅ ALWAYS: Use type hints on all state variables

## Available Blueprint Tools

- `validate_blueprint(path)` - Check syntax and structure
- `compile_blueprint(path)` - Prepare for compilation (user triggers via UI)
- `list_blueprint_methods(path)` - Show all @public and @view methods

**IMPORTANT**: Blueprint tests run in the **frontend browser (Pyodide)**, NOT in any sandbox!
- Test files should be in `/tests/` directory
- User runs tests by clicking "Run Tests" button in the UI
- DO NOT try to run tests via command line or sandbox

## Blueprint Workflow

1. Read existing blueprint with `read_file()`
2. Validate with `validate_blueprint()`
3. Make changes with `write_file()`
4. Create/update test files in `/tests/` if needed
5. Tell user to click "Compile" or "Run Tests" in UI
6. Debug using error messages

"""

    # Add dApp-specific guidance if enabled
    if enable_dapp_tools:
        base_prompt += """
# dApp Development (Next.js 14+)

dApps are Next.js 14+ web applications with TypeScript and Tailwind CSS.

## Key Rules

1. **File Location**: All dApp files must be in /dapp/*
2. **App Router**: Use app/ directory structure (not pages/)
3. **'use client'**: Add as FIRST line for components with hooks/events
4. **Bootstrap**: Use `bootstrap_nextjs_project()` for new projects

## Critical: Client vs Server Components

⚠️ Components are SERVER components by default in Next.js 14+

Add 'use client' at the TOP if component uses:
- React hooks: useState, useEffect, useContext, etc.
- Event handlers: onClick, onChange, onSubmit, etc.
- Browser APIs: window, document, localStorage, etc.

Example:
```typescript
'use client'  // ← MUST be first line!

import { useState } from 'react'

export default function Counter() {
  const [count, setCount] = useState(0)
  return <button onClick={() => setCount(count + 1)}>{count}</button>
}
```

## Available dApp Tools

### File Operations
- `list_files(path)` - List files in directory
- `read_file(path)` - Read file content
- `write_file(path, content)` - Create/update file
- `grep(pattern, path)` - Search code
- `get_project_structure()` - View file tree

### Sandbox Operations (BEAM Cloud)
- `bootstrap_nextjs_project(use_typescript, use_tailwind)` - Create new project
- `run_command(cmd)` - Execute npm install, build, etc.
- `get_sandbox_logs(lines)` - View dev server logs
- `restart_dev_server()` - Restart Next.js
- `download_sandbox_files()` - Sync from sandbox to IDE

## dApp Workflow

### New Project
1. Use `bootstrap_nextjs_project(True, True)` ← Don't create files manually!
2. Modify generated files as needed
3. Run `run_command("npm run build")` to test

### Existing Project
1. Use `read_file()` to understand current code
2. Make changes with `write_file()`
3. Check logs with `get_sandbox_logs()` if issues
4. Restart server with `restart_dev_server()` if needed

"""

    # Add shared tool guidance
    base_prompt += """
# Shared Tools (Available for All Projects)

- `list_files(path="/")` - List all files
- `read_file(path)` - Read any file
- `write_file(path, content)` - Create/update any file
- `get_project_structure()` - See entire project tree

# Best Practices

1. **Always Read Before Writing**
   - Understand existing code first
   - Preserve what works
   - Make minimal changes

2. **Validate Your Work**
   - For blueprints: Use `validate_blueprint()` before compiling
   - For dApps: Use `run_command("npm run build")` to check

3. **Help Users Help Themselves**
   - Explain compilation/testing steps
   - Show how to debug errors
   - Provide clear instructions

4. **Handle Errors Gracefully**
   - Read error messages carefully
   - Use logs to understand issues
   - Fix root causes, not symptoms
"""

    return base_prompt


@router.post("/unified-chat", response_model=UnifiedChatResponse)
@limiter.limit("50/hour")
async def unified_chat(chat_request: UnifiedChatRequest, request: Request):
    """
    Unified chat endpoint for blueprint and dApp development.

    Automatically detects project type and provides appropriate tools.
    Uses context caching for cost optimization.
    """
    try:
        logger.info(
            "Unified chat request",
            project_id=chat_request.project_id,
            message=chat_request.message[:100],
            files=len(chat_request.files)
        )

        # Validate input sizes
        if len(chat_request.files) > MAX_FILES:
            return UnifiedChatResponse(
                success=False,
                error=f"Too many files (max {MAX_FILES})",
                message="",
                environment="unknown",
                confidence=0.0
            )

        if len(chat_request.message) > MAX_MESSAGE_LENGTH:
            return UnifiedChatResponse(
                success=False,
                error=f"Message too long (max {MAX_MESSAGE_LENGTH} chars)",
                message="",
                environment="unknown",
                confidence=0.0
            )

        for path, content in chat_request.files.items():
            if len(content) > MAX_FILE_SIZE:
                return UnifiedChatResponse(
                    success=False,
                    error=f"File {path} too large (max {MAX_FILE_SIZE} bytes)",
                    message="",
                    environment="unknown",
                    confidence=0.0
                )

        # Step 1: Detect environment
        env_context = detect_environment(chat_request.files, chat_request.message)
        logger.info(
            "Environment detected",
            type=env_context.env_type.value,
            confidence=env_context.confidence,
            reason=env_context.reason
        )

        # Step 2: Determine which tools to enable
        enable_blueprints = should_enable_blueprint_tools(env_context)
        enable_dapps = should_enable_dapp_tools(env_context)

        # Step 3: Initialize unified tools
        unified_tools = UnifiedTools(
            project_files=chat_request.files.copy(),
            project_id=chat_request.project_id,
            enable_blueprint_tools=enable_blueprints,
            enable_dapp_tools=enable_dapps
        )

        # Step 4: Get AI model
        try:
            model = get_ai_model()
        except ValueError as e:
            return UnifiedChatResponse(
                success=False,
                error=str(e),
                message="AI provider not configured",
                environment=env_context.env_type.value,
                confidence=env_context.confidence
            )

        # Step 5: Build system prompt with caching
        system_prompt = build_system_prompt(
            env_context.env_type,
            enable_blueprints,
            enable_dapps
        )

        # Get cached content blocks (Anthropic format)
        cached_blocks = cache_manager.get_cached_system_prompt()

        # Convert to plain text for Gemini (doesn't support cache control format)
        # Extract text from each block and combine
        cached_text_parts = []
        for block in cached_blocks:
            if isinstance(block, dict) and "text" in block:
                cached_text_parts.append(block["text"])
            elif isinstance(block, str):
                cached_text_parts.append(block)

        # Combine everything into a single text string
        full_system_prompt = "\n\n".join(cached_text_parts) + "\n\n" + system_prompt

        # Step 6: Build user context (not cached) - WITHOUT conversation history
        user_context = cache_manager.build_user_context(
            files=chat_request.files,
            message=chat_request.message,
            conversation_history=None,  # Don't include in text, we'll use message_history instead
            environment_info=f"Detected: {env_context.env_type.value} (confidence: {env_context.confidence:.0%})\nReason: {env_context.reason}"
        )

        # Step 6.5: Build proper message history (structured, not text)
        message_history = []
        if chat_request.conversation_history:
            for msg in chat_request.conversation_history:
                role = msg.get('role')
                content = msg.get('content', '')

                if role == 'user':
                    message_history.append(ModelRequest(
                        parts=[UserPromptPart(content=content)]
                    ))
                elif role == 'assistant':
                    message_history.append(ModelResponse(
                        parts=[TextPart(content=content)]
                    ))

        logger.info(f"Built message history with {len(message_history)} messages")

        # Step 7: Create agent with plain text system prompt
        agent = Agent(
            model=model,
            system_prompt=full_system_prompt,
            deps_type=UnifiedTools
        )

        # Step 8: Register tools based on enabled tool sets

        # Shared tools (always available)
        @agent.tool
        def list_files(ctx: RunContext[UnifiedTools], path: str = "/") -> List[Dict[str, Any]]:
            """List files and directories"""
            result = ctx.deps.list_files(path)
            ctx.deps._track_tool_call("list_files", {"path": path}, str(result))
            return result

        @agent.tool
        def read_file(ctx: RunContext[UnifiedTools], path: str) -> str:
            """Read a file's content"""
            result = ctx.deps.read_file(path)
            ctx.deps._track_tool_call("read_file", {"path": path}, result[:200] + "..." if len(result) > 200 else result)
            return result

        @agent.tool
        def write_file(ctx: RunContext[UnifiedTools], path: str, content: str) -> str:
            """Create or update a file"""
            result = ctx.deps.write_file(path, content)
            ctx.deps._track_tool_call("write_file", {"path": path, "content_length": len(content)}, result)
            return result

        @agent.tool
        def get_project_structure(ctx: RunContext[UnifiedTools]) -> str:
            """Get tree view of project"""
            result = ctx.deps.get_project_structure()
            ctx.deps._track_tool_call("get_project_structure", {}, result)
            return result

        # Blueprint tools (conditional)
        if enable_blueprints:
            @agent.tool
            async def validate_blueprint(ctx: RunContext[UnifiedTools], file_path: str) -> str:
                """Validate blueprint syntax and structure"""
                result = await ctx.deps.validate_blueprint(file_path)
                ctx.deps._track_tool_call("validate_blueprint", {"file_path": file_path}, result)
                return result

            @agent.tool
            async def compile_blueprint(ctx: RunContext[UnifiedTools], file_path: str) -> str:
                """Prepare blueprint for compilation"""
                result = await ctx.deps.compile_blueprint(file_path)
                ctx.deps._track_tool_call("compile_blueprint", {"file_path": file_path}, result)
                return result

            @agent.tool
            async def run_blueprint_tests(ctx: RunContext[UnifiedTools], test_file_path: str) -> str:
                """Prepare blueprint tests"""
                result = await ctx.deps.run_blueprint_tests(test_file_path)
                ctx.deps._track_tool_call("run_blueprint_tests", {"test_file_path": test_file_path}, result)
                return result

            @agent.tool
            def list_blueprint_methods(ctx: RunContext[UnifiedTools], file_path: str) -> str:
                """List all methods in blueprint"""
                result = ctx.deps.list_blueprint_methods(file_path)
                ctx.deps._track_tool_call("list_blueprint_methods", {"file_path": file_path}, result)
                return result

        # dApp tools (conditional)
        if enable_dapps:
            @agent.tool
            def grep(ctx: RunContext[UnifiedTools], pattern: str, path: str = "/") -> List[Dict[str, Any]]:
                """Search for pattern in files"""
                result = ctx.deps.grep(pattern, path)
                ctx.deps._track_tool_call("grep", {"pattern": pattern, "path": path}, str(result))
                return result

            @agent.tool
            async def run_command(ctx: RunContext[UnifiedTools], command: str) -> str:
                """Execute command in sandbox"""
                result = await ctx.deps.run_command(command)
                ctx.deps._track_tool_call("run_command", {"command": command}, result)
                return result

            @agent.tool
            async def get_sandbox_logs(ctx: RunContext[UnifiedTools], lines: int = 30) -> str:
                """Get dev server logs"""
                result = await ctx.deps.get_sandbox_logs(lines)
                ctx.deps._track_tool_call("get_sandbox_logs", {"lines": lines}, result[:300] + "..." if len(result) > 300 else result)
                return result

            @agent.tool
            async def restart_dev_server(ctx: RunContext[UnifiedTools]) -> str:
                """Restart Next.js dev server"""
                result = await ctx.deps.restart_dev_server()
                ctx.deps._track_tool_call("restart_dev_server", {}, result)
                return result

            @agent.tool
            async def bootstrap_nextjs_project(
                ctx: RunContext[UnifiedTools],
                use_typescript: bool = True,
                use_tailwind: bool = True
            ) -> str:
                """Bootstrap new Next.js project"""
                result = await ctx.deps.bootstrap_nextjs_project(use_typescript, use_tailwind)
                ctx.deps._track_tool_call("bootstrap_nextjs_project", {"use_typescript": use_typescript, "use_tailwind": use_tailwind}, result)
                return result

            @agent.tool
            async def download_sandbox_files(ctx: RunContext[UnifiedTools]) -> str:
                """Download files from sandbox"""
                result = await ctx.deps.download_sandbox_files()
                ctx.deps._track_tool_call("download_sandbox_files", {}, result)
                return result

        # Step 9: Run agent with proper message history
        try:
            result = await agent.run(
                user_prompt=user_context,
                message_history=message_history if message_history else None,
                deps=unified_tools
            )
        except Exception as e:
            error_msg = str(e)
            # Handle Gemini empty response error
            if "Field required" in error_msg and "candidates" in error_msg:
                logger.warning("Gemini returned empty response, likely due to content filtering or token limits")
                return UnifiedChatResponse(
                    success=False,
                    error="The AI model couldn't generate a response. This may be due to:\n- Conversation history is too long\n- Input contains problematic content\n- API rate limits\n\nTry:\n- Clear chat history\n- Simplify your request\n- Wait a moment and try again",
                    message="I'm having trouble processing this request. Please try clearing the chat or simplifying your message.",
                    environment=env_context.env_type.value,
                    confidence=env_context.confidence
                )
            # Re-raise other errors
            raise

        # Debug: Log result attributes
        logger.info(
            "Agent result attributes",
            has_all_messages=hasattr(result, 'all_messages'),
            has__all_messages=hasattr(result, '_all_messages'),
            has_data=hasattr(result, 'data'),
            result_type=type(result).__name__
        )

        # Step 10: Extract tool calls
        tool_calls = []
        try:
            # Try to access messages from the result
            messages = []
            if hasattr(result, 'new_messages'):
                messages = result.new_messages()
            elif hasattr(result, 'all_messages'):
                messages = result.all_messages()
            elif hasattr(result, '_all_messages'):
                messages = result._all_messages()

            logger.info(f"Found {len(messages)} messages to process")

            for i, msg in enumerate(messages):
                logger.debug(f"Message {i}: type={type(msg).__name__}, has_parts={hasattr(msg, 'parts')}, has_tool_calls={hasattr(msg, 'tool_calls')}")

                # Check if message has parts (Gemini/Anthropic format)
                if hasattr(msg, 'parts'):
                    for j, part in enumerate(msg.parts):
                        part_type = type(part).__name__
                        logger.debug(f"  Part {j}: type={part_type}, has_tool_name={hasattr(part, 'tool_name')}, has_tool_return={hasattr(part, 'tool_return')}")

                        # Tool call part
                        if hasattr(part, 'tool_name'):
                            tool_name = part.tool_name
                            tool_args = part.args if hasattr(part, 'args') else {}
                            logger.info(f"Found tool call: {tool_name} with args: {list(tool_args.keys())}")
                            tool_calls.append(ToolCall(
                                tool=tool_name,
                                args=tool_args,
                                result=str(part.content) if hasattr(part, 'content') else ""
                            ))
                        # Tool return part (result from tool execution)
                        elif hasattr(part, 'tool_return'):
                            # Find the corresponding tool call and update its result
                            if tool_calls and hasattr(part, 'content'):
                                logger.info(f"Found tool return for: {tool_calls[-1].tool}")
                                tool_calls[-1] = ToolCall(
                                    tool=tool_calls[-1].tool,
                                    args=tool_calls[-1].args,
                                    result=str(part.content)
                                )

                # Check for tool_calls attribute (OpenAI format)
                elif hasattr(msg, 'tool_calls') and msg.tool_calls:
                    for tc in msg.tool_calls:
                        tool_name = tc.function.name if hasattr(tc, 'function') else str(tc)
                        logger.info(f"Found OpenAI tool call: {tool_name}")
                        tool_calls.append(ToolCall(
                            tool=tool_name,
                            args=tc.function.arguments if hasattr(tc, 'function') else {},
                            result=""
                        ))

            logger.info(f"Extracted {len(tool_calls)} tool calls from messages")
        except Exception as e:
            logger.warning(f"Failed to extract tool calls from messages: {e}", exc_info=True)

        # Also get tool calls tracked by UnifiedTools (more reliable)
        if hasattr(unified_tools, 'tool_calls') and unified_tools.tool_calls:
            logger.info(f"Using {len(unified_tools.tool_calls)} tracked tool calls from UnifiedTools")
            # Convert tracked calls to ToolCall objects
            for tracked_call in unified_tools.tool_calls:
                tool_calls.append(ToolCall(
                    tool=tracked_call['tool'],
                    args=tracked_call['args'],
                    result=tracked_call['result']
                ))

        # Step 11: Get updated files
        updated_files = {}
        for path, content in unified_tools.project_files.items():
            if path not in chat_request.files or chat_request.files[path] != content:
                updated_files[path] = content

        # Also get files from file_tools if available
        if unified_tools.file_tools:
            for path, content in unified_tools.file_tools.files.items():
                if path not in chat_request.files or chat_request.files[path] != content:
                    updated_files[path] = content

        # Step 12: Get sandbox URL if dApp
        sandbox_url = None
        if enable_dapps:
            try:
                sandbox_info = await beam_service.get_sandbox_info(chat_request.project_id)
                if sandbox_info:
                    sandbox_url = sandbox_info.get('url')
            except Exception as e:
                logger.warning(f"Failed to get sandbox URL: {e}")

        # Step 13: Log cache stats
        cache_stats = cache_manager.get_cache_stats()
        logger.info(
            "Agent completed",
            tool_calls=len(tool_calls),
            updated_files=len(updated_files),
            cache_enabled=cache_stats.get('cache_enabled', False)
        )

        return UnifiedChatResponse(
            success=True,
            message=result.output,
            environment=env_context.env_type.value,
            confidence=env_context.confidence,
            tool_calls=tool_calls,
            updated_files=updated_files,
            sandbox_url=sandbox_url
        )

    except Exception as e:
        logger.error(
            "Unified chat failed",
            error=str(e),
            exc_info=True
        )
        return UnifiedChatResponse(
            success=False,
            error=str(e),
            message="Sorry, I encountered an error. Please try again.",
            environment="unknown",
            confidence=0.0
        )
