"""
Unified tools provider for blueprint and dApp development.

Provides tools for both Hathor nano contracts (blueprints) and Next.js dApps,
with automatic tool selection based on project environment.
"""

from typing import Dict, List, Optional, Any
import re
import structlog
from api.ai_tools import FileTools  # Reuse existing dApp tools

logger = structlog.get_logger()

# Pre-compiled regex patterns for blueprint validation
CONTAINER_PATTERNS = [
    re.compile(r'^\s*self\.\w+\s*=\s*\{\}', re.MULTILINE),  # dict
    re.compile(r'^\s*self\.\w+\s*=\s*\[\]', re.MULTILINE),  # list
    re.compile(r'^\s*self\.\w+\s*=\s*set\(\)', re.MULTILINE),  # set
]


class UnifiedTools:
    """
    Unified tool provider that combines blueprint and dApp tools.

    Tools are conditionally available based on environment:
    - Blueprint tools: For Hathor nano contracts (Pyodide execution)
    - dApp tools: For Next.js applications (BEAM cloud execution)
    - Shared tools: Available in both environments
    """

    def __init__(
        self,
        project_files: Dict[str, str],
        project_id: str,
        enable_blueprint_tools: bool = True,
        enable_dapp_tools: bool = True
    ):
        """
        Initialize unified tools.

        Args:
            project_files: All project files (blueprints + dApps)
            project_id: Project identifier for BEAM operations
            enable_blueprint_tools: Whether to enable blueprint-specific tools
            enable_dapp_tools: Whether to enable dApp-specific tools
        """
        self.project_files = project_files
        self.project_id = project_id
        self.enable_blueprint_tools = enable_blueprint_tools
        self.enable_dapp_tools = enable_dapp_tools

        # Track tool calls for frontend display
        self.tool_calls: List[Dict[str, Any]] = []

        # Reuse existing FileTools for dApp operations
        self.file_tools = FileTools(
            project_files=project_files.copy(),
            project_id=project_id
        ) if enable_dapp_tools else None

        logger.info(
            "Initialized unified tools",
            blueprint_tools=enable_blueprint_tools,
            dapp_tools=enable_dapp_tools,
            file_count=len(project_files)
        )

    def _track_tool_call(self, tool_name: str, args: Dict[str, Any], result: str) -> None:
        """Track a tool call for frontend display"""
        self.tool_calls.append({
            "tool": tool_name,
            "args": args,
            "result": result
        })

    # ============ BLUEPRINT TOOLS ============

    async def validate_blueprint(self, file_path: str) -> str:
        """
        Validate blueprint syntax and structure (static analysis).

        Checks:
        - File exists and has correct path (/blueprints/*.py)
        - Python syntax is valid
        - Has Blueprint class
        - Has __blueprint__ export
        - Has @public or @view methods
        - No common errors (container assignments, etc.)

        Args:
            file_path: Path to blueprint file (e.g., /blueprints/Counter.py)

        Returns:
            Validation results with issues found
        """
        logger.info(f"Tool: validate_blueprint({file_path})")

        # Check path
        if not (file_path.startswith("/blueprints/") or file_path.startswith("/contracts/")):
            return (
                f"❌ Blueprint files must be in /blueprints/ or /contracts/ directory.\n"
                f"Got: {file_path}\n"
                f"Expected: /blueprints/*.py or /contracts/*.py"
            )

        # Check file exists
        if file_path not in self.project_files:
            available = [p for p in self.project_files.keys()
                        if p.startswith('/blueprints/') or p.startswith('/contracts/')]
            return (
                f"❌ File not found: {file_path}\n"
                f"Available blueprints: {available or 'None'}"
            )

        code = self.project_files[file_path]
        issues = []

        # Check 1: Python syntax
        try:
            compile(code, file_path, 'exec')
        except SyntaxError as e:
            return f"❌ Syntax Error on line {e.lineno}: {e.msg}"

        # Check 2: Hathor imports
        if 'from hathor' not in code and 'import hathor' not in code:
            issues.append("⚠️ Missing Hathor imports (from hathor.nanocontracts...)")

        # Check 3: Blueprint class
        if 'class ' not in code:
            issues.append("❌ No class definition found (blueprints must be classes)")
        elif 'Blueprint' not in code:
            issues.append("⚠️ Class should inherit from Blueprint")

        # Check 4: __blueprint__ export
        if '__blueprint__' not in code:
            issues.append("❌ Missing __blueprint__ export (required!)")

        # Check 5: Methods
        if '@public' not in code and '@view' not in code:
            issues.append("⚠️ No @public or @view methods found")

        # Check 6: Initialize method
        if 'def initialize' not in code:
            issues.append("⚠️ No initialize() method found")
        if 'def __init__' in code:
            issues.append("❌ Don't use __init__! Use initialize() instead")

        # Check 7: Container field assignments (critical error)
        # Use pre-compiled patterns and filter out comments
        for pattern in CONTAINER_PATTERNS:
            for line in code.split('\n'):
                line_stripped = line.strip()
                # Skip comment lines
                if line_stripped.startswith('#'):
                    continue
                # Check for pattern match
                if pattern.search(line):
                    issues.append(
                        f"❌ CRITICAL: Container field assignment detected: {line_stripped}\n"
                        f"   Container fields (dict, list, set) are auto-initialized.\n"
                        f"   Never write: self.balances = {{}}\n"
                        f"   Just use: self.balances[key] = value"
                    )
                    break  # Only report first occurrence per pattern

        # Check 8: Context usage
        if '@public' in code and 'ctx.address' in code:
            issues.append(
                "❌ Don't use ctx.address! Use ctx.vertex.hash instead for caller identity"
            )

        # Return results
        if not issues:
            return f"✅ {file_path} passed validation! Ready for compilation."

        return (
            f"🔍 Validation results for {file_path}:\n\n" +
            "\n".join(f"  {issue}" for issue in issues) +
            "\n\nFix these issues before compiling."
        )

    async def compile_blueprint(self, file_path: str) -> str:
        """
        Prepare blueprint for compilation.

        NOTE: Actual compilation happens in browser via Pyodide.
        This tool validates and prepares, user triggers compilation via UI.

        Args:
            file_path: Path to blueprint file

        Returns:
            Instructions for user to compile via UI
        """
        logger.info(f"Tool: compile_blueprint({file_path})")

        # Validate first
        validation_result = await self.validate_blueprint(file_path)
        if "❌" in validation_result:
            return (
                f"Cannot compile due to validation errors:\n\n{validation_result}\n\n"
                f"Fix these issues first, then try compiling again."
            )

        return (
            f"✅ Blueprint ready for compilation: {file_path}\n\n"
            f"Validation passed! To compile:\n"
            f"1. Save your changes\n"
            f"2. Click the 'Compile' button in the IDE\n"
            f"3. View compilation results in the console\n\n"
            f"Note: Compilation happens in your browser via Pyodide for security."
        )

    async def run_blueprint_tests(self, test_file_path: str) -> str:
        """
        Prepare blueprint tests for execution.

        Tests run via pytest in Pyodide (browser).
        User triggers test execution manually.

        Args:
            test_file_path: Path to test file (e.g., /blueprints/test_counter.py)

        Returns:
            Instructions for running tests
        """
        logger.info(f"Tool: run_blueprint_tests({test_file_path})")

        if test_file_path not in self.project_files:
            return f"❌ Test file not found: {test_file_path}"

        # Check if test file looks valid
        test_content = self.project_files[test_file_path]
        if 'def test_' not in test_content and 'class Test' not in test_content:
            return (
                f"⚠️ {test_file_path} doesn't look like a pytest test file.\n"
                f"Test functions should start with 'test_' or be in a class starting with 'Test'"
            )

        return (
            f"✅ Test file ready: {test_file_path}\n\n"
            f"To run tests:\n"
            f"1. Make sure your blueprint is compiled\n"
            f"2. Click 'Run Tests' in the IDE\n"
            f"3. View test results in the console\n\n"
            f"Note: Tests run in browser via Pyodide pytest."
        )

    def list_blueprint_methods(self, file_path: str) -> str:
        """
        List all @public and @view methods in a blueprint.

        Parses the blueprint code to extract method signatures.

        Args:
            file_path: Path to blueprint file

        Returns:
            Formatted list of methods with their decorators
        """
        logger.info(f"Tool: list_blueprint_methods({file_path})")

        if file_path not in self.project_files:
            return f"❌ File not found: {file_path}"

        code = self.project_files[file_path]
        lines = code.split('\n')

        public_methods = []
        view_methods = []

        for i, line in enumerate(lines):
            if '@public' in line or '@view' in line:
                decorator = 'public' if '@public' in line else 'view'

                # Find method definition in next few lines
                for j in range(i + 1, min(i + 5, len(lines))):
                    if lines[j].strip().startswith('def '):
                        method_line = lines[j].strip()

                        if decorator == 'public':
                            public_methods.append(method_line)
                        else:
                            view_methods.append(method_line)
                        break

        if not public_methods and not view_methods:
            return f"No @public or @view methods found in {file_path}"

        output = f"Methods in {file_path}:\n\n"

        if public_methods:
            output += "📝 @public methods (state-changing):\n"
            output += "\n".join(f"  {m}" for m in public_methods)
            output += "\n\n"

        if view_methods:
            output += "👁️  @view methods (read-only):\n"
            output += "\n".join(f"  {m}" for m in view_methods)

        return output

    # ============ SHARED FILE TOOLS ============

    def list_files(self, path: str = "/") -> List[Dict[str, Any]]:
        """List files in a directory (works for both blueprints and dApps)"""
        if self.file_tools:
            return self.file_tools.list_files(path)

        # Fallback if dApp tools not enabled
        files = []
        for file_path in self.project_files.keys():
            if file_path.startswith(path):
                files.append({
                    'path': file_path,
                    'name': file_path.split('/')[-1],
                    'type': 'file'
                })
        return files

    def read_file(self, path: str) -> str:
        """Read a file (works for both blueprints and dApps)"""
        # Normalize path: ensure it starts with /
        if not path.startswith('/'):
            path = '/' + path

        if path in self.project_files:
            return self.project_files[path]

        # Try smart file matching
        filename = path.split('/')[-1]
        for file_path, content in self.project_files.items():
            if file_path.endswith(filename):
                return f"⚠️ Found at {file_path}:\n\n{content}"

        return f"❌ File not found: {path}"

    def write_file(self, path: str, content: str) -> str:
        """Create or update a file"""
        # Normalize path: ensure it starts with /
        if not path.startswith('/'):
            path = '/' + path

        # Validate path prefix
        if path.startswith('/dapp/'):
            if not self.enable_dapp_tools:
                return "❌ dApp tools are not enabled for this project"
            if self.file_tools:
                return self.file_tools.write_file(path, content)

        elif path.startswith(('/blueprints/', '/contracts/', '/tests/')):
            if not self.enable_blueprint_tools:
                return "❌ Blueprint tools are not enabled for this project"

            action = "Updated" if path in self.project_files else "Created"
            self.project_files[path] = content
            # Also update file_tools if available
            if self.file_tools:
                self.file_tools.files[path] = content
            return f"✅ {action} {path}"

        else:
            return (
                f"❌ Invalid path: {path}\n"
                f"Files must be in /blueprints/, /contracts/, /tests/, or /dapp/ directories"
            )

    def get_project_structure(self) -> str:
        """Get tree view of entire project"""
        blueprints = [p for p in self.project_files.keys()
                     if p.startswith('/blueprints/') or p.startswith('/contracts/')]
        dapps = [p for p in self.project_files.keys() if p.startswith('/dapp/')]

        output = "Project Structure:\n\n"

        if blueprints:
            output += "📜 Blueprints:\n"
            output += "\n".join(f"  {b}" for b in sorted(blueprints))
            output += "\n\n"

        if dapps:
            output += "🌐 dApp:\n"
            output += "\n".join(f"  {d}" for d in sorted(dapps))
            output += "\n\n"

        if not blueprints and not dapps:
            output += "  (empty project)\n"

        return output

    # ============ DAPP TOOLS (delegated to FileTools) ============

    def grep(self, pattern: str, path: str = "/") -> List[Dict[str, Any]]:
        """Search for pattern in files"""
        if self.file_tools:
            return self.file_tools.grep(pattern, path)
        return []

    async def run_command(self, command: str) -> str:
        """Execute command in BEAM sandbox"""
        if not self.enable_dapp_tools or not self.file_tools:
            return "❌ dApp tools are not enabled (no BEAM sandbox available)"
        return await self.file_tools.run_command(command)

    async def get_sandbox_logs(self, lines: int = 30) -> str:
        """Get dev server logs"""
        if not self.enable_dapp_tools or not self.file_tools:
            return "❌ dApp tools are not enabled (no BEAM sandbox available)"
        return await self.file_tools.get_sandbox_logs(lines)

    async def restart_dev_server(self) -> str:
        """Restart Next.js dev server"""
        if not self.enable_dapp_tools or not self.file_tools:
            return "❌ dApp tools are not enabled (no BEAM sandbox available)"
        return await self.file_tools.restart_dev_server()

    async def bootstrap_nextjs_project(
        self,
        use_typescript: bool = True,
        use_tailwind: bool = True
    ) -> str:
        """Bootstrap new Next.js project"""
        if not self.enable_dapp_tools or not self.file_tools:
            return "❌ dApp tools are not enabled (no BEAM sandbox available)"
        return await self.file_tools.bootstrap_nextjs_project(use_typescript, use_tailwind)

    async def download_sandbox_files(self) -> str:
        """Download files from sandbox"""
        if not self.enable_dapp_tools or not self.file_tools:
            return "❌ dApp tools are not enabled (no BEAM sandbox available)"
        return await self.file_tools.download_sandbox_files()
