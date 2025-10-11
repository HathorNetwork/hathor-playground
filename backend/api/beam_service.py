"""
Beam Cloud service for managing dApp sandboxes
"""
import tempfile
import os
from pathlib import Path
from typing import Dict, Optional
import structlog

# Set Beam API key from environment
# This must be set before importing beam
beam_api_key = os.getenv('BEAM_API_KEY')
if beam_api_key:
    os.environ['BEAM_API_KEY'] = beam_api_key
else:
    logger = structlog.get_logger()
    logger.warning("BEAM_API_KEY not set - Beam SDK may fail to authenticate")

from beam import Image, Sandbox

logger = structlog.get_logger()

# Beam image with Node.js 20 and Next.js setup
image = (
    Image()
    .from_registry("node:20")
    .add_commands([
        "apt-get update && apt-get install -y git curl",
        "npm install -g pnpm",
    ])
)

DEFAULT_CODE_PATH = "/app"
DEFAULT_PORT = 3000


class BeamService:
    """Service for managing Beam Cloud sandboxes for dApp projects"""

    def __init__(self):
        self.sandboxes: Dict[str, str] = {}  # project_id -> sandbox_id mapping
        self.processes: Dict[str, any] = {}  # project_id -> process handle mapping

    async def create_sandbox(self, project_id: str) -> Dict[str, str]:
        """
        Create a new Beam sandbox for a project

        Args:
            project_id: Unique project identifier

        Returns:
            Dictionary with url and sandbox_id
        """
        logger.info("Creating sandbox for project", project_id=project_id)

        try:
            sandbox = Sandbox(
                name=f"hathor-dapp-{project_id}",
                cpu=1,
                memory=1024,
                image=image,
                keep_warm_seconds=300,
            ).create()

            # Expose port for Next.js dev server
            url = sandbox.expose_port(DEFAULT_PORT)
            sandbox_id = sandbox.sandbox_id()

            # Store sandbox ID for this project
            self.sandboxes[project_id] = sandbox_id

            logger.info(
                "Sandbox created successfully",
                project_id=project_id,
                sandbox_id=sandbox_id,
                url=url
            )

            return {
                "url": url,
                "sandbox_id": sandbox_id,
                "project_id": project_id,
            }

        except Exception as e:
            logger.error("Failed to create sandbox", project_id=project_id, error=str(e))
            raise

    async def get_sandbox(self, project_id: str) -> Optional[Sandbox]:
        """
        Get existing sandbox for a project

        Args:
            project_id: Project identifier

        Returns:
            Sandbox instance or None if not found
        """
        sandbox_id = self.sandboxes.get(project_id)
        if not sandbox_id:
            return None

        try:
            sandbox = Sandbox().connect(sandbox_id)
            sandbox.update_ttl(300)
            return sandbox
        except Exception as e:
            logger.error(
                "Failed to connect to sandbox",
                project_id=project_id,
                sandbox_id=sandbox_id,
                error=str(e)
            )
            # Remove invalid sandbox from cache
            del self.sandboxes[project_id]
            return None

    async def upload_files(self, project_id: str, files: Dict[str, str], auto_start: bool = True) -> Dict[str, str]:
        """
        Upload files to project sandbox

        Args:
            project_id: Project identifier
            files: Dictionary mapping file paths to content
            auto_start: Whether to auto-start dev server after upload (default: True)

        Returns:
            Status dictionary
        """
        sandbox = await self.get_sandbox(project_id)
        if not sandbox:
            # Create sandbox if it doesn't exist
            sandbox_info = await self.create_sandbox(project_id)
            sandbox = await self.get_sandbox(project_id)

        if not sandbox:
            raise ValueError(f"Could not get or create sandbox for project {project_id}")

        logger.info(
            "Uploading files to sandbox",
            project_id=project_id,
            file_count=len(files)
        )

        try:
            for sandbox_path, content in files.items():
                # Convert /dapp/... paths to /app/...
                if sandbox_path.startswith('/dapp/'):
                    sandbox_path = sandbox_path.replace('/dapp/', f'{DEFAULT_CODE_PATH}/')
                elif not sandbox_path.startswith(DEFAULT_CODE_PATH):
                    sandbox_path = f"{DEFAULT_CODE_PATH}{sandbox_path}"

                with tempfile.NamedTemporaryFile(mode='w', delete=False) as temp_file:
                    temp_file.write(content)
                    temp_file_path = temp_file.name

                try:
                    # Create parent directory if it doesn't exist
                    parent_dir = str(Path(sandbox_path).parent)
                    try:
                        sandbox.fs.stat_file(parent_dir)
                    except Exception:
                        logger.info("Creating parent directory", path=parent_dir)
                        # Using sandbox process API to create directories
                        # Arguments are passed separately to prevent command injection
                        mkdir_cmd = sandbox.process.exec("mkdir", "-p", parent_dir)
                        mkdir_cmd.wait()

                    # Upload file
                    sandbox.fs.upload_file(temp_file_path, sandbox_path)
                    logger.debug("File uploaded", path=sandbox_path)

                finally:
                    # Clean up temp file
                    os.unlink(temp_file_path)

            logger.info("Files uploaded successfully", project_id=project_id)

            # Auto-start dev server if not already running and auto_start is True
            if auto_start and project_id not in self.processes:
                logger.info("Auto-starting dev server after file upload", project_id=project_id)
                try:
                    await self.start_dev_server(project_id)
                except Exception as e:
                    logger.warning("Failed to auto-start dev server", project_id=project_id, error=str(e))
                    # Don't fail the upload if dev server fails to start

            return {
                "status": "success",
                "project_id": project_id,
                "files_uploaded": len(files)
            }

        except Exception as e:
            logger.error(
                "Failed to upload files",
                project_id=project_id,
                error=str(e)
            )
            raise

    async def start_dev_server(self, project_id: str) -> Dict[str, str]:
        """
        Start Next.js development server in sandbox

        Args:
            project_id: Project identifier

        Returns:
            Status dictionary with URL
        """
        sandbox = await self.get_sandbox(project_id)
        if not sandbox:
            raise ValueError(f"No sandbox found for project {project_id}")

        logger.info("Starting dev server", project_id=project_id)

        try:
            # Check if package.json exists and install dependencies if needed
            try:
                sandbox.fs.stat_file(f"{DEFAULT_CODE_PATH}/package.json")
                logger.info("Found package.json, installing dependencies", project_id=project_id)
                # Install dependencies in background (non-blocking)
                install_cmd = f"cd {DEFAULT_CODE_PATH} && pnpm install"
                install_process = sandbox.process.exec("sh", "-c", install_cmd)
                # Wait for install to complete
                install_process.wait()
                logger.info("Dependencies installed", project_id=project_id)
            except Exception:
                logger.info("No package.json found, skipping dependency installation", project_id=project_id)

            # Start Next.js dev server using sandbox process API
            dev_cmd = f"cd {DEFAULT_CODE_PATH} && npx next dev --port {DEFAULT_PORT}"
            process = sandbox.process.exec("sh", "-c", dev_cmd)

            # Store process handle for log streaming
            self.processes[project_id] = process

            url = sandbox.expose_port(DEFAULT_PORT)

            logger.info("Dev server started", project_id=project_id, url=url)

            return {
                "status": "success",
                "url": url,
                "project_id": project_id
            }

        except Exception as e:
            logger.error(
                "Failed to start dev server",
                project_id=project_id,
                error=str(e)
            )
            raise

    async def get_sandbox_info(self, project_id: str) -> Optional[Dict[str, str]]:
        """
        Get information about a project's sandbox

        Args:
            project_id: Project identifier

        Returns:
            Sandbox info dictionary or None
        """
        sandbox = await self.get_sandbox(project_id)
        if not sandbox:
            return None

        try:
            url = sandbox.expose_port(DEFAULT_PORT)
            return {
                "sandbox_id": sandbox.sandbox_id(),
                "url": url,
                "project_id": project_id
            }
        except Exception as e:
            logger.error(
                "Failed to get sandbox info",
                project_id=project_id,
                error=str(e)
            )
            return None

    def stream_logs(self, project_id: str):
        """
        Stream logs from a running process in the sandbox

        Args:
            project_id: Project identifier

        Yields:
            Log lines from the process
        """
        process = self.processes.get(project_id)
        if not process:
            logger.warning("No process found for project", project_id=project_id)
            yield "No active process found\n"
            return

        try:
            # Stream combined logs (stdout + stderr)
            for log_line in process.logs:
                yield log_line
        except Exception as e:
            logger.error(
                "Failed to stream logs",
                project_id=project_id,
                error=str(e)
            )
            yield f"Error streaming logs: {str(e)}\n"


# Global service instance
beam_service = BeamService()
