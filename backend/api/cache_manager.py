"""
Cache manager for context caching and Hathor docs integration.

Implements Anthropic's context caching to reduce LLM costs by 75%+.
Manages static knowledge (Hathor docs) vs dynamic context (user files).
"""

import os
from pathlib import Path
from typing import Optional, List, Dict, Any
import structlog

logger = structlog.get_logger()


class CacheManager:
    """
    Manages context caching for Anthropic API.

    Separates static content (cached) from dynamic content (ephemeral):
    - CACHED: Hathor documentation, core knowledge
    - NOT CACHED: User files, conversation history, current message
    """

    def __init__(self):
        self.hathor_docs: Optional[str] = None
        self.docs_loaded = False
        self._load_hathor_docs()

    def _load_hathor_docs(self) -> None:
        """
        Load Hathor documentation from local filesystem.

        Checks for docs in these locations (in order):
        1. HATHOR_DOCS_PATH environment variable
        2. ./hathor-docs-website/
        3. ../hathor-docs-website/
        4. Skip if not found (logs warning)
        """
        # DISABLED BY DEFAULT: Loading full docs wastes tokens!
        # Enable by setting ENABLE_HATHOR_DOCS=true in .env
        if os.getenv("ENABLE_HATHOR_DOCS", "false").lower() != "true":
            logger.info("Using concise Hathor docs summary (~1600 tokens)")
            self.docs_loaded = True  # Using summary, not full docs
            self.hathor_docs = """# Hathor Nano Contracts - Blueprint Development Guide

## Core Concepts

**Nano contracts** are Hathor's smart contracts with separated code (blueprints) and state. A **blueprint** is a template/class that multiple contract instances share. You develop blueprints, users create contract instances from them.

## Blueprint Structure

Every blueprint is a Python class that defines:
- **Attributes**: Contract data (NOT the multi-token balance)
- **Methods**: Public, view, internal, initialize, and optionally fallback
- **State**: All attribute values + multi-token balance + blueprint ID

### Multi-Token Balance vs Attributes
- **Multi-token balance**: Managed by Hathor protocol (like a wallet). NOT an attribute. Cannot be directly modified by methods.
- **Attributes**: All other contract data. Can be modified by public methods. Use container types (dict, list, set) which are auto-initialized.

## Method Types

### 1. Public Methods (@public decorator)
**Purpose**: Create or execute contracts. Only methods that can change contract state.

**Rules**:
- Can change contract attributes (self.attribute = value)
- CANNOT directly change balance (no balance += x)
- Instead, they authorize/deny actions (deposits/withdrawals) in the actions batch
- Called by users via NC transactions or by other contracts
- Must handle Context object containing actions batch
- Execution is atomic: all changes or no changes
- If method raises exception = failure, all changes discarded

**Example**:
```python
@public
def increment(self, ctx: Context, amount: int) -> None:
    if amount <= 0:
        raise NegativeIncrement("Amount must be positive")
    self.count += amount  # Modifying attribute is OK
```

### 2. View Methods (@view decorator)
**Purpose**: Read-only queries. Return computed data without state changes.

**Rules**:
- CANNOT change any attributes
- CANNOT change balance
- Can be called by: other methods, other contracts, users via full node API
- Cannot be called from blockchain transactions
- Only effect is return value
- Use for credit checks, balance queries, computed data

**Example**:
```python
@view
def get_count(self) -> int:
    return self.count
```

### 3. Internal Methods (no decorator, just regular methods)
**Purpose**: Helper methods for internal logic.

**Rules**:
- Can only be called by other methods in SAME contract
- Cannot be called externally (not by users, not by other contracts, not via API)
- Use for code organization and reusability

### 4. initialize Method (MANDATORY)
**Purpose**: Create a new contract instance. Called on blueprint, not on contract.

**Rules**:
- Every blueprint MUST have exactly ONE initialize method
- Must be @public decorated
- Called once per contract (at creation)
- Sets initial attribute values
- Receives Context with initial deposit actions

**Example**:
```python
@public
def initialize(self, ctx: Context) -> None:
    self.count = 0
```

### 5. fallback Method (OPTIONAL)
**Purpose**: Invoked when someone calls a non-existent public method.

**Rules**:
- Optional (can have zero or one)
- NOT @public, @view, or internal - special type
- Cannot be called directly
- Only invoked by Hathor engine when caller tries to call non-existent method

## Context Object

Every public method receives a `Context` object with:
- `ctx.actions`: Batch of DEPOSIT/WITHDRAWAL/GRANT_AUTHORITY/ACQUIRE_AUTHORITY actions
- `ctx.caller`: Who called the method (user address or contract ID)
- Other transaction metadata

## Actions

Actions describe token/authority transfers between caller and contract:

### DEPOSIT
Transfer tokens FROM caller TO contract. Defined by: token UID, amount.

### WITHDRAWAL
Transfer tokens FROM contract TO caller. Defined by: token UID, amount.

### GRANT_AUTHORITY
Caller grants mint/melt authority TO contract. Defined by: token UID, operations (mint/melt/both).

### ACQUIRE_AUTHORITY
Caller acquires mint/melt authority FROM contract. Defined by: token UID, operations (mint/melt/both).

## Critical Rules

1. **Container Fields Auto-Initialize**: dict, list, set fields are auto-initialized. NEVER write:
   ```python
   self.balances = {}  # ❌ WRONG! Will break
   ```
   Just use them:
   ```python
   self.balances[key] = value  # ✅ Correct
   ```

2. **No Direct Balance Modification**: Methods don't change contract balance directly. They authorize actions.

3. **Atomic Execution**: Entire call chain succeeds or fails together. If any method raises exception, all changes discarded.

4. **Multi-Token Support**: Contracts can hold any tokens. Specify which tokens to accept in your attributes/logic.

5. **Inter-Contract Calls**: Contracts can call other contracts' public/view methods during execution.

6. **Context Usage**: Use `ctx.caller` for caller identity, NOT ctx.address (doesn't exist).

## Blueprint Rewards

30% of all fees from contract creation and execution go to blueprint developer.

## Example Blueprint Structure

```python
from hathor.nanocontracts import Blueprint
from hathor.nanocontracts.context import Context
from hathor.nanocontracts.types import public, view
from hathor.nanocontracts.exception import NCFail

class Counter(Blueprint):
    '''A simple counter that can be incremented'''

    # Attributes (auto-initialized containers)
    count: int

    @public
    def initialize(self, ctx: Context) -> None:
        '''Create new counter at 0'''
        self.count = 0

    @public
    def increment(self, ctx: Context, amount: int) -> None:
        '''Increment counter by amount'''
        if amount <= 0:
            raise NCFail("Amount must be positive")
        self.count += amount

    @view
    def get_count(self) -> int:
        '''Get current counter value'''
        return self.count

# Export blueprint
__blueprint__ = Counter
```

## Transaction Flow

1. User submits NC transaction with entry point call
2. Hathor validates transaction
3. When confirmed, Hathor engine executes entry point
4. Entry point may call other methods (call chain)
5. If no exception: changes committed, transaction marked 'success'
6. If exception raised: changes discarded, transaction marked 'failure'
7. Transaction added to blockchain (gas fees paid either way)

## Common Patterns

**Token Deposits**: Check ctx.actions for DEPOSIT actions
**Token Withdrawals**: Authorize in logic, specified in caller's actions batch
**Access Control**: Check ctx.caller to restrict who can call methods
**State Queries**: Use @view methods for read-only data access
"""
            return

        # Check environment variable first
        docs_path_env = os.getenv("HATHOR_DOCS_PATH")
        if docs_path_env and os.path.exists(docs_path_env):
            docs_path = Path(docs_path_env)
        else:
            # Check common locations
            possible_paths = [
                Path("./hathor-docs-website"),
                Path("../hathor-docs-website"),
                Path("./hathor-docs-website/docs"),
                Path("../hathor-docs-website/docs"),
            ]

            docs_path = None
            for path in possible_paths:
                if path.exists():
                    docs_path = path
                    break

        if not docs_path:
            logger.warning(
                "Hathor docs not found. Set HATHOR_DOCS_PATH or place docs in hathor-docs-website/"
            )
            self.docs_loaded = False
            return

        logger.info(f"Loading Hathor docs from: {docs_path}")

        try:
            docs_content = []
            file_count = 0

            # Load all markdown files
            for file_path in docs_path.rglob("*.md"):
                try:
                    with open(file_path, 'r', encoding='utf-8') as f:
                        content = f.read()

                    # Create section header from file path
                    relative_path = file_path.relative_to(docs_path)
                    section_title = str(relative_path).replace('.md', '').replace('/', ' > ')

                    docs_content.append(f"## {section_title}\n\n{content}\n")
                    file_count += 1

                except UnicodeDecodeError as e:
                    logger.warning(f"Encoding error reading {file_path}: {e}")
                    continue
                except PermissionError as e:
                    logger.warning(f"Permission denied reading {file_path}: {e}")
                    continue
                except Exception as e:
                    logger.error(f"Unexpected error reading {file_path}: {e}", exc_info=True)
                    continue

            if docs_content:
                self.hathor_docs = "\n\n---\n\n".join(docs_content)
                self.docs_loaded = True
                logger.info(
                    f"Loaded Hathor docs successfully",
                    files=file_count,
                    size_kb=len(self.hathor_docs) // 1024
                )
            else:
                logger.warning("No markdown files found in Hathor docs")
                self.docs_loaded = False

        except Exception as e:
            logger.error(f"Failed to load Hathor docs: {e}", exc_info=True)
            self.docs_loaded = False

    def get_cached_system_prompt(self) -> List[Dict[str, Any]]:
        """
        Get system prompt with cache control markers for Anthropic API.

        Returns list of content blocks with cache_control for static content.
        This enables 90% cost reduction on input tokens after first request.

        Structure:
        1. Core knowledge (small, always included)
        2. Hathor documentation (large, cached if available)

        Returns:
            List of content blocks for system message
        """
        content_blocks = []

        # Block 1: Core knowledge (always included, not cached)
        core_knowledge = self._get_core_knowledge()
        content_blocks.append({
            "type": "text",
            "text": core_knowledge
        })

        # Block 2: Hathor documentation (large, cached)
        if self.docs_loaded and self.hathor_docs:
            content_blocks.append({
                "type": "text",
                "text": f"# Hathor Documentation\n\n{self.hathor_docs}",
                "cache_control": {"type": "ephemeral"}  # Cache this block
            })
            logger.info("Using cached Hathor docs", size_kb=len(self.hathor_docs) // 1024)

        return content_blocks

    def _get_core_knowledge(self) -> str:
        """
        Get core knowledge that's always included (not cached).

        This is the essential context for both blueprints and dApps.
        Kept small to minimize non-cached tokens.
        """
        return """You are a unified AI assistant for Hathor blockchain development.

You can help with:
- **Blueprints**: Hathor nano contracts (Python smart contracts)
- **dApps**: Next.js applications that interact with blueprints

You automatically detect what the user needs based on their project files and message.

# Core Principles

1. **Explore First**: Use read_file() to understand code before modifying
2. **Path Conventions**:
   - Blueprints: /blueprints/*.py (single Python files)
   - dApps: /dapp/* (multi-file Next.js projects)
3. **Tool Usage**: Use appropriate tools based on file type
4. **Clear Communication**: Explain what you're doing and why

# Available Tools

You have access to different tools based on the project type. I'll tell you which tools are available in each conversation."""

    def build_user_context(
        self,
        files: Dict[str, str],
        message: str,
        conversation_history: List[Dict[str, str]] = None,
        execution_logs: Optional[str] = None,
        environment_info: Optional[str] = None
    ) -> str:
        """
        Build ephemeral user context (not cached).

        This changes with each request and includes:
        - Current project files
        - User's message
        - Recent conversation history
        - Execution logs (if any)
        - Detected environment information

        Args:
            files: Current project files (path -> content)
            message: User's current message
            conversation_history: (DEPRECATED - use message_history param in agent.run() instead)
            execution_logs: Logs from recent executions
            environment_info: Detected environment context

        Returns:
            Formatted context string
        """
        context_parts = []

        # Environment information
        if environment_info:
            context_parts.append(f"## Environment Detection\n\n{environment_info}\n")

        # Project files
        if files:
            context_parts.append("## Current Project Files\n")
            for path in sorted(files.keys()):
                content_preview = files[path][:200] + "..." if len(files[path]) > 200 else files[path]
                context_parts.append(f"\n### {path}\n```\n{content_preview}\n```\n")

        # Conversation history (NOTE: This is now handled via message_history parameter,
        # so this section should not be used. Keeping for backward compatibility.)
        if conversation_history:
            context_parts.append("## Recent Conversation\n")
            for msg in conversation_history[-10:]:  # Keep recent messages
                role = msg.get('role', 'unknown')
                content = msg.get('content', '')
                context_parts.append(f"\n**{role}**: {content}\n")

        # Execution logs
        if execution_logs:
            context_parts.append(f"## Recent Execution Logs\n\n```\n{execution_logs}\n```\n")

        # Current message
        context_parts.append(f"## User's Current Message\n\n{message}")

        return "\n\n---\n\n".join(context_parts)

    def get_cache_stats(self) -> Dict[str, Any]:
        """
        Get statistics about cache usage.

        Returns:
            Dictionary with cache statistics
        """
        if not self.docs_loaded:
            return {
                "docs_loaded": False,
                "docs_size_kb": 0,
                "cache_enabled": False
            }

        docs_size = len(self.hathor_docs) if self.hathor_docs else 0
        return {
            "docs_loaded": True,
            "docs_size_kb": docs_size // 1024,
            "cache_enabled": True,
            "estimated_cache_tokens": docs_size // 4  # Rough estimate: 1 token ≈ 4 chars
        }


# Global cache manager instance
cache_manager = CacheManager()
