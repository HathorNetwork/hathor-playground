"""
Streaming endpoint for unified chat with AI SDK compatibility.

Returns Server-Sent Events (SSE) stream compatible with Vercel AI SDK.
"""

from typing import Dict, Any, AsyncIterator
from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
import structlog
import json

from api.unified_chat import (
    UnifiedChatRequest,
    get_ai_model,
    build_system_prompt,
    cache_manager,
)
from api.environment_detector import (
    detect_environment,
    should_enable_blueprint_tools,
    should_enable_dapp_tools,
)
from api.unified_tools import UnifiedTools
from pydantic_ai import Agent, RunContext
from pydantic_ai.messages import ModelRequest, ModelResponse, UserPromptPart, TextPart
from middleware.rate_limit import limiter

logger = structlog.get_logger()
router = APIRouter()


async def stream_unified_chat(chat_request: UnifiedChatRequest) -> AsyncIterator[str]:
    """
    Stream responses from unified agent in AI SDK format.

    AI SDK streaming format:
    - Text: 0:"text content"\n
    - Tool call: 9:[{toolCallId, toolName, args}]\n
    - Tool result: a:[{toolCallId, result}]\n
    - Finish: d:{finishReason}\n
    """
    try:
        logger.info(
            "Stream generator started",
            project_id=chat_request.project_id,
            message=chat_request.message[:100]
        )

        # Step 1: Detect environment
        env_context = detect_environment(chat_request.files, chat_request.message)
        enable_blueprints = should_enable_blueprint_tools(env_context)
        enable_dapps = should_enable_dapp_tools(env_context)

        # Step 2: Initialize tools
        unified_tools = UnifiedTools(
            project_files=chat_request.files.copy(),
            project_id=chat_request.project_id,
            enable_blueprint_tools=enable_blueprints,
            enable_dapp_tools=enable_dapps
        )

        # Step 3: Get AI model
        try:
            model = get_ai_model()
        except ValueError as e:
            yield f'0:"{str(e)}"\n'
            yield 'd:{"finishReason":"error"}\n'
            return

        # Step 4: Build system prompt
        system_prompt = build_system_prompt(
            env_context.env_type,
            enable_blueprints,
            enable_dapps
        )

        cached_blocks = cache_manager.get_cached_system_prompt()
        cached_text_parts = []
        for block in cached_blocks:
            if isinstance(block, dict) and "text" in block:
                cached_text_parts.append(block["text"])
            elif isinstance(block, str):
                cached_text_parts.append(block)

        full_system_prompt = "\n\n".join(cached_text_parts) + "\n\n" + system_prompt

        # Step 5: Build user context and message history
        user_context = cache_manager.build_user_context(
            files=chat_request.files,
            message=chat_request.message,
            conversation_history=None,
            environment_info=f"Detected: {env_context.env_type.value} (confidence: {env_context.confidence:.0%})\nReason: {env_context.reason}"
        )

        message_history = []
        if chat_request.conversation_history:
            for msg in chat_request.conversation_history:
                role = msg.get('role')
                content = msg.get('content', '')
                if role == 'user':
                    message_history.append(ModelRequest(parts=[UserPromptPart(content=content)]))
                elif role == 'assistant':
                    message_history.append(ModelResponse(parts=[TextPart(content=content)]))

        # Step 6: Create agent with tools
        agent = Agent(
            model=model,
            system_prompt=full_system_prompt,
            deps_type=UnifiedTools
        )

        # Register all tools (same as unified_chat.py)
        # Shared tools
        @agent.tool
        def list_files(ctx: RunContext[UnifiedTools], path: str = "/"):
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

        # Blueprint tools
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

        # dApp tools
        if enable_dapps:
            @agent.tool
            def grep(ctx: RunContext[UnifiedTools], pattern: str, path: str = "/"):
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

        # Step 7: Stream the response with tool calls
        logger.info("Starting agent streaming with tool support")

        try:
            # Use run() instead of run_stream() to get full tool execution
            # Then stream the result
            result = await agent.run(
                user_prompt=user_context,
                message_history=message_history if message_history else None,
                deps=unified_tools
            )

            logger.info("Agent execution completed, streaming response...")

            # Stream the final text output
            # AgentRunResult has 'output' not 'data'
            text_output = str(result.output)
            chunk_size = 10  # Stream in small chunks for better UX

            for i in range(0, len(text_output), chunk_size):
                chunk = text_output[i:i+chunk_size]
                escaped_text = json.dumps(chunk)
                yield f'0:{escaped_text}\n'

            logger.info(f"Streamed {len(text_output)} characters")

        except Exception as stream_err:
            logger.error(f"Error during agent execution: {stream_err}", exc_info=True)
            yield f'0:{json.dumps(f"Error: {str(stream_err)}")}\n'

        # Send finish signal
        yield 'd:{"finishReason":"stop"}\n'
        logger.info("Finish signal sent")

        logger.info("Streaming completed successfully")

    except Exception as e:
        import traceback
        logger.error("Streaming failed", error=str(e), traceback=traceback.format_exc(), exc_info=True)
        error_msg = f"Error: {str(e)}"
        yield f'0:{json.dumps(error_msg)}\n'
        yield 'd:{"finishReason":"error"}\n'


@router.post("/unified-chat-stream")
@limiter.limit("50/hour")
async def unified_chat_stream(chat_request: UnifiedChatRequest, request: Request):
    """
    Streaming endpoint for unified chat.

    Returns Server-Sent Events (SSE) compatible with Vercel AI SDK.
    """
    logger.info(
        "Streaming unified chat endpoint called",
        project_id=chat_request.project_id,
        message=chat_request.message[:50]
    )

    return StreamingResponse(
        stream_unified_chat(chat_request),
        media_type="text/plain; charset=utf-8",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # Disable nginx buffering
        }
    )
