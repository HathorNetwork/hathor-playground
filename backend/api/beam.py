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
        request: UploadFilesRequest with project_id and files

    Returns:
        UploadResponse with status
    """
    try:
        result = await beam_service.upload_files(request.project_id, request.files)
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
    try:
        def event_generator():
            for log_line in beam_service.stream_logs(project_id):
                # Format as SSE event
                yield f"data: {log_line}\n\n"

        return StreamingResponse(
            event_generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",  # Disable nginx buffering
            }
        )
    except Exception as e:
        logger.error("Failed to stream logs", project_id=project_id, error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to stream logs: {str(e)}")
