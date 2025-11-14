"""
Beam Cloud API endpoints for dApp deployment and preview
"""
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Dict, Optional
import structlog

from api.beam_service import beam_service

logger = structlog.get_logger()

router = APIRouter()


class CreateSandboxRequest(BaseModel):
    """Request to create a new sandbox"""
    project_id: str


class UploadFilesRequest(BaseModel):
    """Request to upload files to sandbox"""
    project_id: str
    files: Dict[str, str]  # path -> content mapping
    auto_start: bool = True  # Whether to auto-start dev server after upload


class SandboxResponse(BaseModel):
    """Response with sandbox information"""
    url: str
    sandbox_id: str
    project_id: str


class UploadResponse(BaseModel):
    """Response after file upload"""
    status: str
    project_id: str
    files_uploaded: int


@router.post("/sandbox/create", response_model=SandboxResponse)
async def create_sandbox(request: CreateSandboxRequest):
    """
    Create a new Beam sandbox for a project

    Args:
        request: CreateSandboxRequest with project_id

    Returns:
        SandboxResponse with URL and sandbox ID
    """
    try:
        result = await beam_service.create_sandbox(request.project_id)
        return SandboxResponse(**result)
    except Exception as e:
        logger.error("Failed to create sandbox", project_id=request.project_id, error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to create sandbox: {str(e)}")


@router.get("/sandbox/{project_id}", response_model=Optional[SandboxResponse])
async def get_sandbox_info(project_id: str):
    """
    Get information about an existing sandbox

    Args:
        project_id: Project identifier

    Returns:
        SandboxResponse or None if not found
    """
    try:
        result = await beam_service.get_sandbox_info(project_id)
        if result is None:
            return None
        return SandboxResponse(**result)
    except Exception as e:
        logger.error("Failed to get sandbox info", project_id=project_id, error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to get sandbox info: {str(e)}")


@router.post("/sandbox/upload", response_model=UploadResponse)
async def upload_files(request: UploadFilesRequest):
    """
    Upload files to a project's sandbox

    Args:
        request: UploadFilesRequest with project_id, files, and auto_start

    Returns:
        UploadResponse with status
    """
    try:
        result = await beam_service.upload_files(
            request.project_id,
            request.files,
            auto_start=request.auto_start
        )
        return UploadResponse(**result)
    except Exception as e:
        logger.error(
            "Failed to upload files",
            project_id=request.project_id,
            error=str(e)
        )
        raise HTTPException(status_code=500, detail=f"Failed to upload files: {str(e)}")


@router.post("/sandbox/{project_id}/start")
async def start_dev_server(project_id: str):
    """
    Start the development server in a sandbox

    Args:
        project_id: Project identifier

    Returns:
        Status with URL
    """
    try:
        result = await beam_service.start_dev_server(project_id)
        return result
    except Exception as e:
        logger.error("Failed to start dev server", project_id=project_id, error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to start dev server: {str(e)}")


@router.get("/sandbox/{project_id}/logs")
async def stream_logs(project_id: str):
    """
    Stream logs from the sandbox dev server using Server-Sent Events

    Args:
        project_id: Project identifier

    Returns:
        StreamingResponse with SSE logs
    """
    def event_generator():
        """Generate SSE events with proper error handling"""
        try:
            # Check if there's a process running
            if project_id not in beam_service.processes:
                # Send a single message and close cleanly
                yield f"data: No active dev server found for project {project_id}\n\n"
                yield f"data: Start the dev server first to see logs\n\n"
                return

            # Stream logs from the process
            for log_line in beam_service.stream_logs(project_id):
                # Format as SSE event
                yield f"data: {log_line}\n\n"

        except GeneratorExit:
            # Client disconnected - this is normal
            logger.info("Client disconnected from log stream", project_id=project_id)
        except Exception as e:
            # Send error as SSE event
            logger.error("Error streaming logs", project_id=project_id, error=str(e))
            yield f"data: ERROR: {str(e)}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Disable nginx buffering
        }
    )


@router.get("/sandbox/{project_id}/events")
async def stream_sandbox_events(project_id: str):
    """
    Stream sandbox state changes via Server-Sent Events

    Events include:
    - sandbox_created: When a new sandbox is created
    - sandbox_ready: When sandbox is ready to receive requests
    - dev_server_started: When Next.js dev server starts
    - dev_server_ready: When dev server is accepting connections
    - files_synced: When files are uploaded/synced

    Args:
        project_id: Project identifier

    Returns:
        StreamingResponse with SSE events
    """
    import asyncio
    import json

    async def event_generator():
        """Generate SSE events for sandbox state changes"""
        try:
            # Send initial state
            sandbox_info = await beam_service.get_sandbox_info(project_id)
            if sandbox_info:
                initial_event = {
                    "type": "sandbox_ready",
                    "url": sandbox_info.get("url"),
                    "sandbox_id": sandbox_info.get("sandbox_id")
                }
                yield f"data: {json.dumps(initial_event)}\n\n"
            else:
                yield f"data: {json.dumps({'type': 'no_sandbox'})}\n\n"

            # Poll for changes every 2 seconds
            last_url = sandbox_info.get("url") if sandbox_info else None

            while True:
                await asyncio.sleep(2)

                current_info = await beam_service.get_sandbox_info(project_id)
                if current_info:
                    current_url = current_info.get("url")

                    # URL changed (new sandbox created)
                    if current_url != last_url:
                        event = {
                            "type": "sandbox_updated",
                            "url": current_url,
                            "sandbox_id": current_info.get("sandbox_id")
                        }
                        yield f"data: {json.dumps(event)}\n\n"
                        last_url = current_url

                    # Heartbeat to keep connection alive
                    yield f": heartbeat\n\n"
                else:
                    # Sandbox disappeared
                    if last_url is not None:
                        yield f"data: {json.dumps({'type': 'sandbox_removed'})}\n\n"
                        last_url = None

        except GeneratorExit:
            logger.info("Client disconnected from sandbox events", project_id=project_id)
        except Exception as e:
            logger.error("Error streaming sandbox events", project_id=project_id, error=str(e))
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )


class CommandRequest(BaseModel):
    """Request to run a command in sandbox"""
    command: str


@router.post("/sandbox/{project_id}/command")
async def run_command(project_id: str, request: CommandRequest):
    """
    Execute a shell command in the sandbox

    Args:
        project_id: Project identifier
        request: CommandRequest with command to run

    Returns:
        Command output with stdout, stderr, and exit code
    """
    try:
        result = await beam_service.run_command(project_id, request.command)
        return result
    except Exception as e:
        logger.error("Failed to run command", project_id=project_id, command=request.command, error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to run command: {str(e)}")


@router.get("/sandbox/{project_id}/files")
async def download_files(project_id: str, path: str = "/app"):
    """
    Download files from the sandbox

    Args:
        project_id: Project identifier
        path: Directory path to download from (default: /app)

    Returns:
        Dictionary mapping file paths to content
    """
    try:
        files = await beam_service.download_files(project_id, path)
        return {"files": files}
    except Exception as e:
        logger.error("Failed to download files", project_id=project_id, path=path, error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to download files: {str(e)}")


@router.get("/sandbox/{project_id}/recent-logs")
async def get_recent_logs(project_id: str, lines: int = 50):
    """
    Get recent logs from the dev server

    Args:
        project_id: Project identifier
        lines: Number of recent log lines to return (default: 50)

    Returns:
        Recent logs as string
    """
    try:
        logs = await beam_service.get_recent_logs(project_id, lines)
        return {"logs": logs}
    except Exception as e:
        logger.error("Failed to get recent logs", project_id=project_id, error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to get recent logs: {str(e)}")
