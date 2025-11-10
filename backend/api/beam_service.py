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
beam_api_key = os.getenv("BEAM_API_KEY")
if beam_api_key:
    os.environ["BEAM_API_KEY"] = beam_api_key
else:
    logger = structlog.get_logger()
    logger.warning("BEAM_API_KEY not set - Beam SDK may fail to authenticate")

from beam import Image, Sandbox

logger = structlog.get_logger()

# Beam image with Node.js 20 and Next.js setup
image = (
    Image()
    .from_registry("node:20")
    .add_commands(
        [
            "apt-get update && apt-get install -y git curl",
            "npm install -g pnpm",
        ]
    )
)

DEFAULT_CODE_PATH = "/app"
DEFAULT_PORT = 3000


class BeamService:
    """Service for managing Beam Cloud sandboxes for dApp projects"""

    def __init__(self):
        self.sandboxes: Dict[str, str] = {}  # project_id -> sandbox_id mapping
        self.processes: Dict[str, any] = {}  # project_id -> process handle mapping
        self.urls: Dict[str, str] = {}  # project_id -> exposed URL mapping

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

            # Store sandbox ID and URL for this project
            self.sandboxes[project_id] = sandbox_id
            self.urls[project_id] = url

            logger.info(
                "Sandbox created successfully",
                project_id=project_id,
                sandbox_id=sandbox_id,
                url=url,
            )

            return {
                "url": url,
                "sandbox_id": sandbox_id,
                "project_id": project_id,
            }

        except Exception as e:
            logger.error(
                "Failed to create sandbox", project_id=project_id, error=str(e)
            )
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
                error=str(e),
            )
            # Remove invalid sandbox from cache
            del self.sandboxes[project_id]
            return None

    async def upload_files(
        self, project_id: str, files: Dict[str, str], auto_start: bool = True
    ) -> Dict[str, str]:
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
            raise ValueError(
                f"Could not get or create sandbox for project {project_id}"
            )

        logger.info(
            "Uploading files to sandbox", project_id=project_id, file_count=len(files)
        )

        try:
            for sandbox_path, content in files.items():
                # Convert /dapp/... paths to /app/...
                if sandbox_path.startswith("/dapp/"):
                    sandbox_path = sandbox_path.replace(
                        "/dapp/", f"{DEFAULT_CODE_PATH}/"
                    )
                elif not sandbox_path.startswith(DEFAULT_CODE_PATH):
                    sandbox_path = f"{DEFAULT_CODE_PATH}{sandbox_path}"

                with tempfile.NamedTemporaryFile(mode="w", delete=False) as temp_file:
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
                logger.info(
                    "Auto-starting dev server after file upload", project_id=project_id
                )
                try:
                    await self.start_dev_server(project_id)
                except Exception as e:
                    logger.warning(
                        "Failed to auto-start dev server",
                        project_id=project_id,
                        error=str(e),
                    )
                    # Don't fail the upload if dev server fails to start

            return {
                "status": "success",
                "project_id": project_id,
                "files_uploaded": len(files),
            }

        except Exception as e:
            logger.error("Failed to upload files", project_id=project_id, error=str(e))
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
                logger.info(
                    "Found package.json, installing dependencies", project_id=project_id
                )
                # Install dependencies in background (non-blocking)
                install_cmd = f"cd {DEFAULT_CODE_PATH} && pnpm install"
                install_process = sandbox.process.exec("sh", "-c", install_cmd)
                # Wait for install to complete
                install_process.wait()
                logger.info("Dependencies installed", project_id=project_id)
            except Exception:
                logger.info(
                    "No package.json found, skipping dependency installation",
                    project_id=project_id,
                )

            # Start Next.js dev server using sandbox process API
            dev_cmd = f"cd {DEFAULT_CODE_PATH} && npx next dev --port {DEFAULT_PORT}"
            process = sandbox.process.exec("sh", "-c", dev_cmd)

            # Store process handle for log streaming
            self.processes[project_id] = process

            # Use cached URL (already exposed during sandbox creation)
            url = self.urls.get(project_id)
            if not url:
                # Fallback: expose port if URL not cached
                url = sandbox.expose_port(DEFAULT_PORT)
                self.urls[project_id] = url

            logger.info("Dev server started", project_id=project_id, url=url)

            return {"status": "success", "url": url, "project_id": project_id}

        except Exception as e:
            logger.error(
                "Failed to start dev server", project_id=project_id, error=str(e)
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
            # Use cached URL if available
            url = self.urls.get(project_id)
            if not url:
                # Fallback: expose port if URL not cached
                url = sandbox.expose_port(DEFAULT_PORT)
                self.urls[project_id] = url

            return {
                "sandbox_id": sandbox.sandbox_id(),
                "url": url,
                "project_id": project_id,
            }
        except Exception as e:
            logger.error(
                "Failed to get sandbox info", project_id=project_id, error=str(e)
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
            logger.error("Failed to stream logs", project_id=project_id, error=str(e))
            yield f"Error streaming logs: {str(e)}\n"

    async def run_command(
        self, project_id: str, command: str, timeout: int = 30
    ) -> Dict[str, str]:
        """
        Execute a command in the sandbox and return output

        NOTE: Uses Beam SDK's sandbox.process.exec() which safely passes arguments
        separately to prevent command injection (similar to subprocess with shell=False)

        Args:
            project_id: Project identifier
            command: Shell command to execute (will be passed to sh -c safely by Beam)
            timeout: Maximum execution time in seconds (default: 30)

        Returns:
            Dictionary with stdout, stderr, exit_code
        """
        sandbox = await self.get_sandbox(project_id)
        if not sandbox:
            raise ValueError(f"No sandbox found for project {project_id}")

        logger.info(
            "Running command in sandbox", project_id=project_id, command=command
        )

        try:
            # Execute command in /app directory
            # Beam SDK's process.exec passes args separately (safe from injection)
            full_command = f"cd {DEFAULT_CODE_PATH} && {command}"
            process = sandbox.process.exec("sh", "-c", full_command)

            # Wait for process to complete
            process.wait()

            # Collect output
            stdout_lines = []
            stderr_lines = []

            for log_line in process.logs:
                # Simple heuristic: lines with "error" are stderr
                if "error" in log_line.lower() or "fail" in log_line.lower():
                    stderr_lines.append(log_line)
                else:
                    stdout_lines.append(log_line)

            stdout = "\n".join(stdout_lines)
            stderr = "\n".join(stderr_lines)

            logger.info(
                "Command completed",
                project_id=project_id,
                command=command,
                output_length=len(stdout) + len(stderr),
            )

            return {
                "stdout": stdout,
                "stderr": stderr,
                "exit_code": "0",  # Beam doesn't expose exit code directly
                "command": command,
            }

        except Exception as e:
            logger.error(
                "Failed to run command",
                project_id=project_id,
                command=command,
                error=str(e),
            )
            return {
                "stdout": "",
                "stderr": f"Error: {str(e)}",
                "exit_code": "1",
                "command": command,
            }

    async def get_recent_logs(self, project_id: str, lines: int = 50) -> str:
        """
        Get recent logs from dev server process

        Args:
            project_id: Project identifier
            lines: Number of recent lines to return (default: 50)

        Returns:
            Recent log output as string
        """
        process = self.processes.get(project_id)
        if not process:
            return "No active process found. Start the dev server first."

        try:
            log_lines = []
            count = 0
            for log_line in process.logs:
                log_lines.append(log_line)
                count += 1
                if count >= lines:
                    break

            return "\n".join(log_lines) if log_lines else "No logs available yet."

        except Exception as e:
            logger.error("Failed to get logs", project_id=project_id, error=str(e))
            return f"Error getting logs: {str(e)}"

    async def restart_dev_server(self, project_id: str) -> Dict[str, str]:
        """
        Restart the dev server for a project

        Args:
            project_id: Project identifier

        Returns:
            Status dictionary
        """
        logger.info("Restarting dev server", project_id=project_id)

        # Stop existing process if any
        if project_id in self.processes:
            try:
                # Beam processes don't have a kill method, so we just remove the reference
                # The process will be cleaned up by Beam
                del self.processes[project_id]
                logger.info(
                    "Stopped existing dev server process", project_id=project_id
                )
            except Exception as e:
                logger.warning(
                    "Failed to stop process", project_id=project_id, error=str(e)
                )

        # Start new dev server
        return await self.start_dev_server(project_id)

    async def download_files(
        self, project_id: str, path: str = DEFAULT_CODE_PATH
    ) -> Dict[str, str]:
        """
        Download files from sandbox back to backend (bidirectional sync)

        NOTE: Uses Beam SDK's sandbox.process.exec() which safely passes arguments
        separately to prevent command injection (similar to subprocess with shell=False)

        Args:
            project_id: Project identifier
            path: Directory path to download from (default: /app)

        Returns:
            Dictionary mapping file paths to content
        """
        sandbox = await self.get_sandbox(project_id)
        if not sandbox:
            raise ValueError(f"No sandbox found for project {project_id}")

        logger.info("Downloading files from sandbox", project_id=project_id, path=path)

        try:
            files = {}

            # List all files recursively in the path
            # Using find command to get all files
            # Beam SDK's process.exec passes args separately (safe from injection)
            find_cmd = f"find {path} -type f"
            process = sandbox.process.exec("sh", "-c", find_cmd)
            process.wait()

            file_paths = []
            for log_line in process.logs:
                file_path = log_line.strip()
                if file_path and file_path.startswith(path):
                    file_paths.append(file_path)

            logger.info(
                f"Found {len(file_paths)} files to download", project_id=project_id
            )

            # Download each file
            for sandbox_file_path in file_paths:
                try:
                    # Skip node_modules and .next directories
                    if (
                        "node_modules" in sandbox_file_path
                        or "/.next/" in sandbox_file_path
                    ):
                        continue

                    # Download file to temp location
                    with tempfile.NamedTemporaryFile(
                        mode="r", delete=False
                    ) as temp_file:
                        temp_file_path = temp_file.name

                    try:
                        # Download from sandbox
                        sandbox.fs.download_file(sandbox_file_path, temp_file_path)

                        # Read content
                        with open(temp_file_path, "r", encoding="utf-8") as f:
                            content = f.read()

                        # Convert /app/... paths to /dapp/...
                        frontend_path = sandbox_file_path.replace(
                            f"{DEFAULT_CODE_PATH}/", "/dapp/"
                        )
                        files[frontend_path] = content

                        logger.debug(
                            "Downloaded file",
                            sandbox_path=sandbox_file_path,
                            frontend_path=frontend_path,
                        )

                    finally:
                        # Clean up temp file
                        if os.path.exists(temp_file_path):
                            os.unlink(temp_file_path)

                except Exception as e:
                    logger.warning(
                        "Failed to download file", file=sandbox_file_path, error=str(e)
                    )
                    # Continue with other files
                    continue

            logger.info(
                "Files downloaded successfully",
                project_id=project_id,
                file_count=len(files),
            )

            return files

        except Exception as e:
            logger.error(
                "Failed to download files", project_id=project_id, error=str(e)
            )
            raise

    async def bootstrap_nextjs(
        self,
        project_id: str,
        app_name: str = "dapp",
        use_typescript: bool = True,
        use_tailwind: bool = True,
        use_app_router: bool = True,
    ) -> Dict[str, str]:
        """
        Bootstrap a new Next.js project using create-next-app and return generated files

        NOTE: Uses Beam SDK's sandbox.process.exec() which safely passes arguments
        separately to prevent command injection (similar to subprocess with shell=False)

        Args:
            project_id: Project identifier
            app_name: Name of the app (default: "dapp")
            use_typescript: Use TypeScript (default: True)
            use_tailwind: Use Tailwind CSS (default: True)
            use_app_router: Use App Router (default: True)

        Returns:
            Dictionary mapping file paths to content (downloaded from sandbox)
        """
        sandbox = await self.get_sandbox(project_id)
        if not sandbox:
            # Create sandbox if it doesn't exist
            await self.create_sandbox(project_id)
            sandbox = await self.get_sandbox(project_id)

        if not sandbox:
            raise ValueError(
                f"Could not get or create sandbox for project {project_id}"
            )

        logger.info(
            "Bootstrapping Next.js project", project_id=project_id, app_name=app_name
        )

        try:
            # Build create-next-app command with flags (fully non-interactive)
            # Beam SDK's process.exec passes args separately (safe from injection)
            cmd_parts = [
                "cd /tmp",
                "&&",
                "npx create-next-app@latest",
                app_name,
                "--no-git",  # Don't initialize git
                "--eslint",  # Use ESLint (required to avoid interactive prompt)
                "--no-turbopack",  # Don't use Turbopack (avoid interactive prompt)
            ]

            if use_typescript:
                cmd_parts.append("--typescript")
            else:
                cmd_parts.append("--js")

            if use_tailwind:
                cmd_parts.append("--tailwind")
            else:
                cmd_parts.append("--no-tailwind")

            if use_app_router:
                cmd_parts.append("--app")
            else:
                cmd_parts.append("--no-app")

            cmd_parts.extend(
                [
                    "--no-src-dir",  # Don't use src/ directory
                    "--import-alias '@/*'",  # Use @/* import alias
                ]
            )

            create_cmd = " ".join(cmd_parts)

            logger.info("Running create-next-app", command=create_cmd)

            # Run create-next-app
            process = sandbox.process.exec("sh", "-c", create_cmd)
            process.wait()

            # Log output
            output_lines = []
            for log_line in process.logs:
                output_lines.append(log_line.strip())
                logger.debug(f"create-next-app: {log_line.strip()}")

            # Check if create-next-app succeeded
            if not any(
                "success" in line.lower() or "created" in line.lower()
                for line in output_lines
            ):
                logger.warning(
                    "create-next-app may have failed",
                    output="\n".join(output_lines[-10:]),
                )

            # List what was created in /tmp
            ls_tmp_cmd = f"ls -la /tmp/{app_name}"
            ls_process = sandbox.process.exec("sh", "-c", ls_tmp_cmd)
            ls_process.wait()

            logger.info("Files in /tmp/{app_name}:")
            for log_line in ls_process.logs:
                logger.info(f"  {log_line.strip()}")

            # Create /app directory if it doesn't exist, then move generated files
            move_cmd = f"mkdir -p {DEFAULT_CODE_PATH} && rm -rf {DEFAULT_CODE_PATH}/* && mv /tmp/{app_name}/* {DEFAULT_CODE_PATH}/ && mv /tmp/{app_name}/.* {DEFAULT_CODE_PATH}/ 2>/dev/null || true"
            move_process = sandbox.process.exec("sh", "-c", move_cmd)
            move_process.wait()

            # Verify files were moved
            ls_app_cmd = f"ls -la {DEFAULT_CODE_PATH}"
            ls_app_process = sandbox.process.exec("sh", "-c", ls_app_cmd)
            ls_app_process.wait()

            logger.info(f"Files in {DEFAULT_CODE_PATH}:")
            for log_line in ls_app_process.logs:
                logger.info(f"  {log_line.strip()}")

            logger.info("Next.js project created, downloading files...")

            # Download generated files back to backend
            files = await self.download_files(project_id, DEFAULT_CODE_PATH)

            logger.info(
                "Next.js bootstrap completed",
                project_id=project_id,
                file_count=len(files),
            )

            return files

        except Exception as e:
            logger.error(
                "Failed to bootstrap Next.js project",
                project_id=project_id,
                error=str(e),
            )
            raise


# Global service instance
beam_service = BeamService()
