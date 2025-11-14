"""
AI Tools for agentic file operations
"""
from typing import List, Dict, Optional
import os
from pathlib import Path
import structlog
from pydantic import BaseModel

logger = structlog.get_logger()


class FileInfo(BaseModel):
    """Information about a file"""
    path: str
    name: str
    type: str  # 'file' or 'directory'
    size: Optional[int] = None


class GrepMatch(BaseModel):
    """A match from grep search"""
    file: str
    line_number: int
    line: str
    match: str


class FileTools:
    """Tools for AI to interact with project files and sandbox"""

    def __init__(self, project_files: Dict[str, str], project_id: Optional[str] = None):
        """
        Initialize with project files

        Args:
            project_files: Dict mapping file path -> content
            project_id: Optional project ID for sandbox operations
        """
        self.files = project_files  # path -> content mapping
        self.project_id = project_id  # for sandbox operations

    def list_files(self, path: str = "/") -> List[FileInfo]:
        """
        List files in a directory

        Args:
            path: Directory path to list (default: root)

        Returns:
            List of file information
        """
        logger.info(f"Tool: list_files({path})")

        # Normalize path
        if not path.startswith("/"):
            path = "/" + path
        if not path.endswith("/") and path != "/":
            path = path + "/"

        files_in_dir = []
        subdirs = set()

        for file_path, content in self.files.items():
            # Check if file is in this directory
            if file_path.startswith(path) or (path == "/" and file_path.startswith("/")):
                # Get relative path
                rel_path = file_path[len(path):] if path != "/" else file_path[1:]

                # If it contains /, it's in a subdirectory
                if "/" in rel_path:
                    subdir_name = rel_path.split("/")[0]
                    subdirs.add(subdir_name)
                else:
                    # It's a file in this directory
                    files_in_dir.append(FileInfo(
                        path=file_path,
                        name=rel_path,
                        type="file",
                        size=len(content)
                    ))

        # Add subdirectories
        for subdir in sorted(subdirs):
            files_in_dir.append(FileInfo(
                path=f"{path}{subdir}",
                name=subdir,
                type="directory"
            ))

        # Sort: directories first, then files
        files_in_dir.sort(key=lambda f: (f.type != "directory", f.name))

        logger.info(f"Found {len(files_in_dir)} items in {path}")
        return files_in_dir

    def read_file(self, path: str) -> str:
        """
        Read the content of a file

        Args:
            path: File path to read

        Returns:
            File content as string with path info if found via fallback
        """
        logger.info(f"Tool: read_file({path})")

        # Normalize path
        if not path.startswith("/"):
            path = "/" + path

        # Try exact match first
        if path in self.files:
            content = self.files[path]
            logger.info(f"Read {len(content)} chars from {path}")
            return content

        # Try finding by filename (case-insensitive, searches all paths)
        filename = path.split("/")[-1].lower()
        for file_path, content in self.files.items():
            if file_path.split("/")[-1].lower() == filename:
                logger.info(f"Found file at {file_path} (searched for {path})")
                logger.info(f"Read {len(content)} chars from {file_path}")

                # ⚠️ IMPORTANT: Return content with WARNING about correct path
                # This helps the AI use the correct path when writing
                warning = (
                    f"⚠️ NOTE: File found at '{file_path}' (you searched for '{path}')\n"
                    f"When modifying this file, use: write_file('{file_path}', content)\n"
                    f"DO NOT use: write_file('{path}', content)\n\n"
                )
                return warning + content

        # File not found
        logger.warning(f"File not found: {path}")
        logger.warning(f"Available files: {list(self.files.keys())}")
        raise FileNotFoundError(f"File not found: {path}. Available files: {list(self.files.keys())}")

    def write_file(self, path: str, content: str) -> str:
        """
        Create or update a file

        Args:
            path: File path to write
            content: File content

        Returns:
            Success message
        """
        logger.info(f"Tool: write_file({path}, {len(content)} chars)")

        # Normalize path
        if not path.startswith("/"):
            path = "/" + path

        # 🚨 CRITICAL VALIDATION: All dApp files MUST be under /dapp/
        # This prevents the AI from creating files in the wrong location
        if not path.startswith("/dapp/"):
            error_msg = (
                f"❌ INVALID PATH: '{path}'\n\n"
                f"All dApp files MUST start with '/dapp/'\n\n"
                f"Examples:\n"
                f"  ✅ CORRECT: /dapp/components/IncrementCounter.tsx\n"
                f"  ✅ CORRECT: /dapp/app/page.tsx\n"
                f"  ❌ WRONG: /IncrementCounter.tsx\n"
                f"  ❌ WRONG: /components/IncrementCounter.tsx\n\n"
                f"Please use the correct path starting with /dapp/"
            )
            logger.error(f"Invalid path rejected: {path}")
            return error_msg

        # Check if file exists BEFORE writing
        action = "Updated" if path in self.files else "Created"

        self.files[path] = content

        logger.info(f"{action} file: {path}")
        return f"{action} {path} ({len(content)} chars)"

    def grep(self, pattern: str, path: str = "/") -> List[GrepMatch]:
        """
        Search for a pattern in files

        Args:
            pattern: Text or regex pattern to search for
            path: Directory or file to search in

        Returns:
            List of matches
        """
        logger.info(f"Tool: grep('{pattern}', '{path}')")

        import re

        # Normalize path
        if not path.startswith("/"):
            path = "/" + path

        matches = []

        # Determine which files to search
        files_to_search = []
        if path in self.files:
            # Single file
            files_to_search = [path]
        else:
            # Directory - search all files under it
            for file_path in self.files:
                if file_path.startswith(path) or path == "/":
                    files_to_search.append(file_path)

        # Search through files
        try:
            pattern_re = re.compile(pattern, re.IGNORECASE)
        except re.error:
            # If regex fails, use literal search
            pattern_re = None

        for file_path in files_to_search:
            content = self.files[file_path]
            lines = content.split('\n')

            for line_num, line in enumerate(lines, 1):
                if pattern_re:
                    if pattern_re.search(line):
                        matches.append(GrepMatch(
                            file=file_path,
                            line_number=line_num,
                            line=line.strip(),
                            match=pattern
                        ))
                else:
                    # Literal search
                    if pattern.lower() in line.lower():
                        matches.append(GrepMatch(
                            file=file_path,
                            line_number=line_num,
                            line=line.strip(),
                            match=pattern
                        ))

        logger.info(f"Found {len(matches)} matches")
        return matches[:100]  # Limit to 100 matches

    def delete_file(self, path: str) -> str:
        """
        Delete a file

        Args:
            path: File path to delete

        Returns:
            Success message
        """
        logger.info(f"Tool: delete_file({path})")

        # Normalize path
        if not path.startswith("/"):
            path = "/" + path

        if path not in self.files:
            raise FileNotFoundError(f"File not found: {path}")

        del self.files[path]
        logger.info(f"Deleted file: {path}")
        return f"Deleted {path}"

    def get_project_structure(self) -> str:
        """
        Get a tree view of the project structure

        Returns:
            Tree representation as string
        """
        logger.info("Tool: get_project_structure()")

        def build_tree(files, prefix="", is_last=True):
            lines = []
            sorted_files = sorted(files)

            for i, file_path in enumerate(sorted_files):
                is_last_item = (i == len(sorted_files) - 1)
                marker = "└── " if is_last_item else "├── "

                # Get file name
                name = file_path.split("/")[-1]
                lines.append(f"{prefix}{marker}{name}")

            return "\n".join(lines)

        # Group files by directory
        tree = "Project Structure:\n"
        tree += build_tree(list(self.files.keys()))

        return tree

    async def run_command(self, command: str) -> str:
        """
        Execute a shell command in the sandbox (npm install, build, etc)

        Args:
            command: Shell command to execute

        Returns:
            Command output (stdout + stderr)
        """
        if not self.project_id:
            return "Error: No project_id available for sandbox operations"

        logger.info(f"Tool: run_command('{command}')")

        # Import here to avoid circular dependency
        from api.beam_service import beam_service

        try:
            result = await beam_service.run_command(self.project_id, command)
            output = []

            if result['stdout']:
                output.append("STDOUT:")
                output.append(result['stdout'])

            if result['stderr']:
                output.append("\nSTDERR:")
                output.append(result['stderr'])

            if not result['stdout'] and not result['stderr']:
                output.append("Command completed with no output")

            return "\n".join(output)

        except Exception as e:
            logger.error(f"Failed to run command: {e}")
            return f"Error running command: {str(e)}"

    async def get_sandbox_logs(self, lines: int = 30) -> str:
        """
        Get recent logs from the dev server

        Args:
            lines: Number of recent lines to return (default: 30)

        Returns:
            Recent log output
        """
        if not self.project_id:
            return "Error: No project_id available for sandbox operations"

        logger.info(f"Tool: get_sandbox_logs({lines})")

        # Import here to avoid circular dependency
        from api.beam_service import beam_service

        try:
            logs = await beam_service.get_recent_logs(self.project_id, lines)
            return f"Recent logs ({lines} lines):\n\n{logs}"
        except Exception as e:
            logger.error(f"Failed to get logs: {e}")
            return f"Error getting logs: {str(e)}"

    async def restart_dev_server(self) -> str:
        """
        Restart the Next.js development server

        Returns:
            Status message
        """
        if not self.project_id:
            return "Error: No project_id available for sandbox operations"

        logger.info("Tool: restart_dev_server()")

        # Import here to avoid circular dependency
        from api.beam_service import beam_service

        try:
            result = await beam_service.restart_dev_server(self.project_id)
            return f"Dev server restarted successfully!\nURL: {result.get('url', 'N/A')}"
        except Exception as e:
            logger.error(f"Failed to restart server: {e}")
            return f"Error restarting server: {str(e)}"

    async def bootstrap_nextjs_project(
        self,
        use_typescript: bool = True,
        use_tailwind: bool = True
    ) -> str:
        """
        Bootstrap a new Next.js project using create-next-app and sync files back

        This is MUCH more efficient than manually creating all Next.js files!
        It uses the official create-next-app tool to scaffold a complete project,
        then downloads all generated files back to the IDE.

        Args:
            use_typescript: Use TypeScript (default: True)
            use_tailwind: Use Tailwind CSS (default: True)

        Returns:
            Status message with file count
        """
        if not self.project_id:
            return "Error: No project_id available for sandbox operations"

        logger.info("Tool: bootstrap_nextjs_project()")

        # Import here to avoid circular dependency
        from api.beam_service import beam_service

        try:
            # Bootstrap Next.js project in sandbox and download files
            generated_files = await beam_service.bootstrap_nextjs(
                project_id=self.project_id,
                app_name="dapp",
                use_typescript=use_typescript,
                use_tailwind=use_tailwind,
                use_app_router=True
            )

            # Merge generated files into our file system
            self.files.update(generated_files)

            file_list = "\n".join(f"  - {path}" for path in sorted(generated_files.keys())[:20])
            if len(generated_files) > 20:
                file_list += f"\n  ... and {len(generated_files) - 20} more files"

            return (
                f"✅ Successfully bootstrapped Next.js project!\n\n"
                f"Generated {len(generated_files)} files:\n{file_list}\n\n"
                f"The project includes:\n"
                f"  - Next.js 14 with App Router\n"
                f"  - {'TypeScript' if use_typescript else 'JavaScript'}\n"
                f"  - {'Tailwind CSS' if use_tailwind else 'No styling'}\n"
                f"  - package.json with all dependencies\n"
                f"  - Complete configuration files\n\n"
                f"You can now modify these files or add new features on top!"
            )

        except Exception as e:
            logger.error(f"Failed to bootstrap Next.js: {e}")
            return f"Error bootstrapping Next.js project: {str(e)}"

    async def download_sandbox_files(self) -> str:
        """
        Download all files from the sandbox back to the IDE (bidirectional sync)

        Useful after running commands that generate/modify files in the sandbox
        (like npm install, build tools, code generators, etc)

        Returns:
            Status message with downloaded file count
        """
        if not self.project_id:
            return "Error: No project_id available for sandbox operations"

        logger.info("Tool: download_sandbox_files()")

        # Import here to avoid circular dependency
        from api.beam_service import beam_service

        try:
            downloaded_files = await beam_service.download_files(self.project_id)

            # Merge downloaded files into our file system
            self.files.update(downloaded_files)

            return (
                f"✅ Downloaded {len(downloaded_files)} files from sandbox\n\n"
                f"Files are now synced to the IDE!"
            )

        except Exception as e:
            logger.error(f"Failed to download files: {e}")
            return f"Error downloading files from sandbox: {str(e)}"
