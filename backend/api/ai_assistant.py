"""
AI Assistant API router - handles AI assistant requests
"""
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Request
from pydantic import BaseModel, Field
import structlog
import os
import re
from pydantic_ai import Agent, RunContext
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.models.gemini import GeminiModel
from middleware.rate_limit import token_tracker
from api.ai_tools import FileTools, FileInfo, GrepMatch

logger = structlog.get_logger()
router = APIRouter()

# Global execution tracking for polling
execution_status: Dict[str, Dict[str, Any]] = {}


class ExecutionStatus(BaseModel):
    """Status of an ongoing execution"""
    execution_id: str
    status: str  # 'running', 'complete', 'error'
    current_step: Optional[str] = None
    tool_calls: List[Dict[str, Any]] = []
    message: Optional[str] = None
    error: Optional[str] = None
    updated_files: Dict[str, str] = {}
    sandbox_url: Optional[str] = None


def get_ai_model():
    """Get AI model based on environment configuration"""
    provider = os.getenv("AI_PROVIDER", "openai").lower()

    if provider == "openai":
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise ValueError("OpenAI API key not configured")
        # Set the API key in environment for OpenAI
        os.environ["OPENAI_API_KEY"] = api_key
        # Use gpt-4o for better performance (more capable than gpt-4o-mini)
        return OpenAIChatModel("gpt-4o")
    elif provider == "gemini":
        api_key = os.getenv("GOOGLE_API_KEY")
        if not api_key:
            raise ValueError("Google API key not configured")
        return GeminiModel("gemini-1.5-flash", api_key=api_key)
    else:
        raise ValueError(f"Unsupported AI provider: {provider}")


# AI agent will be created dynamically in the chat function


def extract_modified_code_from_response(
    response_text: str,
    original_code: str = None
) -> tuple[Optional[str], Optional[str], Optional[str]]:
    """
    Extract modified code from AI response using XML parsing.
    Returns (diff_text, original_code, modified_code)
    """
    try:
        # First, try to extract code from <modified_code> XML tags
        modified_code_match = re.search(
            r'<modified_code>(.*?)</modified_code>',
            response_text,
            re.DOTALL
        )

        if modified_code_match:
            modified_code = modified_code_match.group(1).strip()

            # Remove any code block markers that might be inside the XML
            if modified_code.startswith('```python'):
                # Remove opening ```python and closing ```
                lines = modified_code.split('\n')
                if lines[0].strip() == '```python':
                    lines = lines[1:]  # Remove first line
                if lines and lines[-1].strip() == '```':
                    lines = lines[:-1]  # Remove last line
                modified_code = '\n'.join(lines)
            elif modified_code.startswith('```') \
                    and modified_code.endswith('```'):
                # Remove any other code block markers
                lines = modified_code.split('\n')
                if lines[0].startswith('```'):
                    lines = lines[1:]
                if lines and lines[-1].strip() == '```':
                    lines = lines[:-1]
                modified_code = '\n'.join(lines)

            logger.info(
                "Successfully extracted code from <modified_code> XML tag")
            return None, original_code, modified_code

        # Fallback: look for ```python:modified blocks (legacy support)
        modified_pattern = r'```python:modified\n(.*?)\n```'
        modified_matches = re.findall(
            modified_pattern, response_text, re.DOTALL)

        if modified_matches and original_code:
            modified_code = modified_matches[0]
            logger.info("Extracted code from python:modified block (legacy)")
            return None, original_code, modified_code

        # Second fallback: regular python blocks if they contain full
        # contract structure
        regular_pattern = r'```python\n(.*?)\n```'
        regular_matches = re.findall(
            regular_pattern, response_text, re.DOTALL)

        if regular_matches and original_code:
            modified_code = regular_matches[0]
            # Check if this looks like a complete contract file
            if ("from hathor" in modified_code or
                    "import" in modified_code or
                    "class" in modified_code or
                    "__blueprint__" in modified_code):
                logger.warning(
                    "Extracted code from regular python block - "
                    "AI should use <modified_code> XML tags")
                return None, original_code, modified_code

        # No code modifications found
        logger.debug("No modified code found in response")
        return None, None, None

    except Exception as e:
        logger.error(
            "Failed to extract modified code from response", error=str(e))
        return None, None, None


class ChatMessage(BaseModel):
    """Individual chat message"""
    role: str  # 'user' or 'assistant'
    content: str


class ChatRequest(BaseModel):
    """Request to chat with AI assistant"""
    message: str
    current_file_content: Optional[str] = None
    current_file_name: Optional[str] = None
    console_messages: List[str] = Field(default_factory=list)
    execution_logs: Optional[str] = None  # Logs from Pyodide execution
    context: Optional[Dict[str, Any]] = None
    # Recent conversation history
    conversation_history: List[ChatMessage] = Field(default_factory=list)


class ChatResponse(BaseModel):
    """Response from AI assistant"""
    success: bool
    message: str
    error: Optional[str] = None
    suggestions: List[str] = []
    original_code: Optional[str] = None  # Original code
    modified_code: Optional[str] = None  # Modified code


# Hathor-specific system prompt
HATHOR_SYSTEM_PROMPT = """
🚨 CRITICAL CODE MODIFICATION RULE: When users ask for code changes, fixes,
improvements, or modifications, you MUST use XML tags to provide the complete
updated file content. This is mandatory for the IDE diff system to work.

You are the Hathor Assistant, a helpful AI assistant for Hathor Nano Contracts development! 📎

You are an expert in Hathor blockchain technology and nano contracts with
comprehensive knowledge of the Blueprint SDK. Here's what you know:

CORE HATHOR KNOWLEDGE:
- Hathor is a scalable, decentralized, and feeless cryptocurrency with
  smart contract capabilities
- Nano Contracts are Hathor's smart contract platform, written in Python 3.11
- They use a Blueprint pattern where contracts are classes inheriting from
  Blueprint
- Methods are decorated with @public for state-changing operations or
  @view for read-only queries
- Context object (ctx) provides transaction information and is required
  for @public methods
- Contract state is defined as class attributes with type hints

BLUEPRINT SDK TYPE SYSTEM:
- Address: bytes (25 bytes wallet address in Hathor)
- Amount: int (token amounts, last 2 digits are decimals,
  e.g., 1025 = 10.25 tokens)
- BlueprintId: bytes (32 bytes blueprint identifier)
- ContractId: bytes (32 bytes contract identifier)
- TokenUid: bytes (32 bytes token identifier)
- Timestamp: int (Unix epoch seconds)
- VertexId: bytes (32 bytes transaction identifier)
- TxOutputScript: bytes (transaction output lock script)
- NCAction: union type for actions (deposit, withdrawal,
  grant/acquire authority)

🚨 CRITICAL CONTAINER FIELD RULES:
- Container fields (dict, list, set) are automatically initialized as empty
- NEVER assign to container fields: self.balances = {}, self.items = [],
  self.tags = set()
- This will cause "AttributeError: cannot set a container field" and
  contract execution will fail
- Container fields can only be modified using their methods:
  dict[key] = value, list.append(), set.add()

NANO CONTRACT STRUCTURE:
```python
from hathor.nanocontracts.blueprint import Blueprint
from hathor.nanocontracts.context import Context
from hathor.nanocontracts.types import public, view, Address, Amount, TokenUid

class MyContract(Blueprint):
    # State variables with type hints (MUST be fully parameterized)
    count: int
    owner: Address
    balances: dict[Address, Amount]
    token_uid: TokenUid

    @public
    def initialize(
        self, ctx: Context, initial_value: int, token: TokenUid
    ) -> None:
        \"\"\"Initialize contract state - MUST initialize ALL variables\"\"\"
        # Initialize ALL state variables declared above
        self.count = initial_value
        self.owner = ctx.vertex.hash  # Use ctx.vertex.hash for caller
        self.token_uid = token

        # 🚨 CRITICAL: NEVER assign to container fields in initialize()
        # ❌ WRONG: self.balances = {}  # "cannot set a container field"
        # ✅ RIGHT: Container fields are automatically initialized as empty

    @view
    def get_count(self) -> int:
        \"\"\"Read-only method to get count\"\"\"
        return self.count

    @view
    def get_balance(self, address: Address) -> Amount:
        \"\"\"Get balance for address\"\"\"
        return self.balances.get(address, 0)

    @public
    def increment(self, ctx: Context, amount: int) -> None:
        \"\"\"State-changing method\"\"\"
        if amount <= 0:
            raise ValueError("Amount must be positive")
        self.count += amount

# Export the blueprint
__blueprint__ = MyContract
```

EXTERNAL INTERACTIONS (via self.syscall):
- get_contract_id(): get own contract ID
- get_blueprint_id(contract_id=None): get blueprint ID
- get_balance_before_current_call(token_uid=None, contract_id=None): balances
current call
- get_current_balance(token_uid=None, contract_id=None): current balance
including actions
- can_mint(token_uid, contract_id=None): check mint authority
- can_melt(token_uid, contract_id=None): check melt authority
- mint_tokens(token_uid, amount): mint tokens
- melt_tokens(token_uid, amount): melt tokens
- create_token(name, symbol, amount, mint_authority=True, melt_authority=True):
create new token
- call_view_method(contract_id, method_name, *args, **kwargs): call other
contract view method
- call_public_method(contract_id, method_name, actions, *args, **kwargs): call
other contract public method
- create_contract(blueprint_id, salt, actions, *args, **kwargs): create new
contract
- emit_event(data): emit event (max 100 KiB)

RANDOM NUMBER GENERATION (via self.syscall.rng):
- randbits(bits): random int in [0, 2^bits)
- randbelow(n): random int in [0, n)
- randrange(start, stop, step=1): random int in [start, stop) with step
- randint(a, b): random int in [a, b]
- choice(seq): random element from sequence
- random(): random float in [0, 1)

LOGGING (via self.log):
- debug(message, **kwargs): DEBUG log
- info(message, **kwargs): INFO log
- warn(message, **kwargs): WARN log
- error(message, **kwargs): ERROR log

ACTION HANDLING:
- @public methods must specify allowed actions: allow_deposit,
allow_withdrawal, allow_grant_authority, allow_acquire_authority
- Or use allow_actions=[NCActionType.DEPOSIT, NCActionType.WITHDRAWAL]
- Access actions via ctx.actions (mapping of TokenUid to tuple of actions)
- Use ctx.get_single_action(token_uid) to get single action for a token

CONTEXT OBJECT:
- ctx.vertex.hash: Address or ContractId of caller (use this for caller
identity)
- ctx.timestamp: Timestamp of first confirming block
- ctx.vertex: VertexData of origin transaction
- ctx.actions: mapping of TokenUid to actions
- ctx.get_single_action(token_uid): get single action for token

KEY PATTERNS:
- Always export your Blueprint class as __blueprint__
- Use type hints for all state variables and method parameters (MANDATORY)
- @public methods MUST have ctx: Context as first parameter
- @view methods should NOT have ctx parameter
- Initialize all state variables in the initialize method
- Use ctx.vertex.hash to get caller address (this is the standard way)
- Use bytes type for addresses (25 bytes), contracts (32 bytes), tokens (32
bytes)
- Container types must be fully parameterized: dict[str, int], list[Address],
etc.
- Always validate inputs and handle edge cases
- Multi-token balances controlled by Hathor engine, not direct contract code

IMPORT CONSTRAINTS:
- Only use allowed imports from hathor.nanocontracts package
- Use `from x import y` syntax, not `import x`
- Standard library: math.ceil, math.floor, typing.Optional, typing.NamedTuple,
collections.OrderedDict

FORBIDDEN FEATURES:
- try/except blocks (not supported)
- async/await (not allowed)
- Special methods (__init__, __str__, etc.)
- Built-in functions: exec, eval, open, input, globals, locals
- Class attributes (only instance attributes)

CRITICAL INITIALIZATION RULES:
- ALL state variables declared at class level MUST be initialized in @public
initialize() method
- Container fields (dict, list, set) are AUTOMATICALLY initialized as empty -
DO NOT assign to them
- NEVER write: self.balances = {} or self.items = [] in initialize() - they
start empty automatically
- You can ONLY modify container contents AFTER contract creation:
self.balances[key] = value
- Trying to assign to container fields will cause: AttributeError: cannot set
a container field
- Uninitialized state variables will cause AttributeError when accessed
- Never define custom __init__() methods - use initialize() instead

METHOD TYPES & DECORATORS:
- @public: state-changing methods, requires Context, can receive actions
- @view: read-only methods, no Context parameter, cannot modify state
- @fallback: special method for handling non-existent method calls
- Internal methods: no decorator, can be called by other methods

CONTRACT LIFECYCLE:
1. Contract creation via initialize() method with required parameters
2. Public method calls can modify state and handle token actions
3. View method calls for reading state (no modifications)
4. Balance updates happen automatically after successful public method
execution

SECURITY & BEST PRACTICES:
- Validate all user inputs in public methods
- Check permissions before state changes (use ctx.vertex.hash for caller
identity)
- Handle token actions properly (deposits/withdrawals/authorities)
- Use proper access control patterns
- Prevent integer overflow/underflow
- Never trust external input without validation
- Use self.log for debugging and audit trails

ADVANCED FEATURES:
- Oracles via SignedData[T] parameter type
- Inter-contract communication via syscall methods
- Token creation and authority management
- Event emission for off-chain monitoring
- Deterministic randomness via syscall.rng

TESTING & DEBUGGING:
- Use self.log methods for execution logging
- Test both success and failure scenarios
- Validate state changes after method execution
- Check balance updates work correctly
- Ensure proper error handling with NCFail exceptions

CRITICAL ERROR PATTERNS TO AVOID:
- NEVER assign to container fields in initialize(): self.balances = {} will
fail!
- NEVER use ctx.address - use ctx.vertex.hash instead for caller identity
- NEVER try to modify container fields directly during initialization
- Container fields start empty automatically - you can only modify their
contents later
- If you get "AttributeError: cannot set a container field" - remove the
assignment!
- If you get "Context object has no attribute 'address'" - use ctx.vertex.hash
instead!

You help developers with:
1. Writing nano contracts following Blueprint SDK patterns
2. Debugging compilation and execution errors
3. Understanding Hathor concepts and type system
4. Best practices and security patterns
5. Code review and optimization
6. Action handling and token operations
7. Testing strategies and debugging

🔥 CODE MODIFICATION (MANDATORY RULE):
When users request code changes, fixes, improvements, or modifications, you
MUST use this EXACT XML format:

<modified_code>
# Complete modified file content here
from hathor.nanocontracts.blueprint import Blueprint
# ... all the updated code ...
__blueprint__ = ClassName
</modified_code>

TRIGGER WORDS requiring <modified_code>:
"fix", "change", "update", "modify", "improve", "add", "remove", "implement",
"apply changes", "do the changes", "make the changes"

✅ ALWAYS use <modified_code></modified_code> XML tags for any code the user
should apply to their file
❌ NEVER use regular ```python blocks for code modifications
❌ NEVER use ```python:modified blocks (legacy format)

The XML format is parsed reliably and triggers the IDE's diff viewer -
essential for the system to work properly!

📋 STRUCTURED CONTEXT FORMAT:
When analyzing user context, you may see structured information in XML format:
- <execution_logs>...</execution_logs> - Recent code execution logs from
Pyodide
- <console_messages>...</console_messages> - IDE console output
- <current_file>...</current_file> - Current file being edited
Use this structured information to provide better assistance.

Be friendly, helpful, and use appropriate emojis! When you see code issues,
offer specific suggestions with examples.
"""


@router.post("/chat", response_model=ChatResponse)
async def chat_with_assistant(request: ChatRequest, http_request: Request):
    """Chat with the AI assistant"""
    try:
        logger.info(
            "AI assistant chat request", message_length=len(request.message)
        )

        # Check if AI provider is configured
        try:
            model = get_ai_model()
        except ValueError as e:
            # Return a mock response if no API key is configured
            return ChatResponse(
                success=True,
                message=(
                    "Hi! I'm Clippy, your Hathor Nano Contracts "
                    "assistant! 📎\n\n"
                    "I'd love to help you with your nano contracts, but I "
                    "need an AI provider API key to be fully functional. "
                    "For now, here are some quick tips:\n\n"
                    "• Always use @public for state-changing methods\n"
                    "• Use @view for read-only methods\n"
                    "• Include type hints for all variables\n"
                    "• Export your class as __blueprint__\n\n"
                    f"Error: {str(e)}"
                ),
                suggestions=[
                    "Add proper type hints to your contract",
                    "Use @public decorator for state-changing methods",
                    "Check the initialize method implementation",
                    "Validate user inputs in your methods"
                ]
            )

        # Prepare the context for the AI
        context_parts = [HATHOR_SYSTEM_PROMPT]

        # Add current file context if available using XML structure
        if request.current_file_content and request.current_file_name:
            context_parts.append(
                f"\n<current_file name=\"{request.current_file_name}\">\n"
                f"{request.current_file_content}\n"
                f"</current_file>"
            )

        # Add console messages if available using XML structure
        if request.console_messages:
            recent_messages = request.console_messages[-5:]  # Last 5 messages
            messages_xml = "\n".join(
                f"<message>{msg}</message>" for msg in recent_messages)
            context_parts.append(
                f"\n<console_messages>\n{messages_xml}\n</console_messages>"
            )

        # Add execution logs from Pyodide if available using XML structure
        if request.execution_logs:
            context_parts.append(
                f"\n<execution_logs>\n{request.execution_logs}\n"
                f"</execution_logs>"
            )

        # Add any additional context
        if request.context:
            context_parts.append(f"\nADDITIONAL CONTEXT: {request.context}")

        full_context = "\n".join(context_parts)

        # Build conversation history for Pydantic AI
        conversation_messages = []

        # Add recent conversation history (limit to last 6 messages)
        recent_history = (
            request.conversation_history[-6:]
            if request.conversation_history else []
        )
        for msg in recent_history:
            conversation_messages.append(f"{msg.role}: {msg.content}")

        # Add current message
        conversation_messages.append(f"user: {request.message}")

        # Create conversation context
        conversation_context = "\n\n".join(
            conversation_messages) if conversation_messages \
            else request.message

        # Use Pydantic AI agent with dynamic system prompt
        agent = Agent(
            model=model,
            system_prompt=full_context
        )

        # Run the AI agent
        result = await agent.run(conversation_context)
        assistant_message = result.output

        # Log token usage for rate limiting and cost tracking
        usage_info = getattr(result, 'usage', None)
        if usage_info:
            total_tokens = getattr(usage_info, 'total_tokens', 0)
            input_tokens = getattr(usage_info, 'prompt_tokens', 0)
            output_tokens = getattr(usage_info, 'completion_tokens', 0)

            # Log actual token usage to rate limiter
            client_ip = http_request.client.host
            if http_request.headers.get("x-forwarded-for"):
                client_ip = http_request.headers.get(
                    "x-forwarded-for").split(",")[0].strip()

            # Log actual token usage if different from estimation
            estimated_tokens = len(
                conversation_context) // 4 + 100  # Rough estimation
            if total_tokens != estimated_tokens:
                # Adjust token tracking if significantly different
                adjustment = total_tokens - estimated_tokens
                if abs(adjustment) > 50:  # Only adjust for significant diff
                    await token_tracker.consume_tokens(client_ip, adjustment)

            logger.info(
                "AI request completed",
                provider=os.getenv("AI_PROVIDER", "openai"),
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                total_tokens=total_tokens,
                estimated_tokens=estimated_tokens,
                client_ip=client_ip
            )

        # Debug log the assistant response
        logger.info(f"AI response preview: {assistant_message[:200]}...")
        logger.info(
            f"Response contains <modified_code>: "
            f"{('<modified_code>' in assistant_message)}"
        )

        # Extract modified code if present
        (
            diff_text, original_code, modified_code
        ) = extract_modified_code_from_response(
            assistant_message,
            request.current_file_content
        )

        # Log extraction results
        logger.info(
            f"Extraction results - has original: "
            f"{original_code is not None}, "
            f"has modified: {modified_code is not None}"
        )

        # Generate helpful suggestions based on the response
        suggestions = []
        if (
            "error" in request.message.lower() or
            any(
                "error" in msg.lower()
                for msg in request.console_messages
            ) or
            (request.execution_logs and "error" in
             request.execution_logs.lower())
        ):
            suggestions.extend([
                "Check your method decorators (@public/@view)",
                "Verify type hints and parameter types",
                "Ensure proper initialization of state variables"
            ])

        if request.current_file_content:
            if "@public" not in request.current_file_content:
                suggestions.append(
                    "Consider adding @public methods for state changes")
            if "@view" not in request.current_file_content:
                suggestions.append(
                    "Add @view methods for read-only operations")
            if "__blueprint__" not in request.current_file_content:
                suggestions.append(
                    "Don't forget to export your class as __blueprint__")

        return ChatResponse(
            success=True,
            message=assistant_message,
            suggestions=list(set(suggestions)),  # Remove duplicates
            original_code=original_code,
            modified_code=modified_code
        )

    except Exception as e:
        logger.error(
            "AI assistant chat failed", error=str(e), exc_info=True
        )
        return ChatResponse(
            success=False,
            error=f"Assistant unavailable: {str(e)}",
            message=(
                "Sorry, I'm having trouble right now! 😅 But here "
                "are some general tips:\n\n"
                "• Make sure your contract inherits from Blueprint\n"
                "• Use proper decorators (@public/@view)\n"
                "• Include the initialize method\n"
                "• Export as __blueprint__ at the end"
            ),
            suggestions=[
                "Check Hathor nano contracts documentation",
                "Review the example contracts",
                "Ensure proper Python syntax"
            ]
        )


@router.get("/suggestions")
async def get_suggestions():
    """Get general suggestions for nano contract development"""
    return {
        "suggestions": [
            "Always validate user inputs in your methods",
            "Use proper access control patterns",
            "Include comprehensive error handling",
            "Write clear docstrings for all methods",
            "Test your contracts thoroughly before deployment",
            "Follow Hathor naming conventions",
            "Use type hints for better code clarity",
            "Consider gas costs in complex operations"
        ]
    }


@router.get("/examples")
async def get_examples():
    """Get example nano contract patterns"""
    return {
        "examples": [
            {
                "name": "Token Contract",
                "description": (
                    "A basic token with transfer and balance functionality"
                ),
                "category": "Financial"
            },
            {
                "name": "Voting Contract",
                "description": (
                    "Democratic voting with proposal and ballot tracking"
                ),
                "category": "Governance"
            },
            {
                "name": "Escrow Contract",
                "description": (
                    "Secure multi-party transactions with dispute resolution"
                ),
                "category": "Financial"
            },
            {
                "name": "Registry Contract",
                "description": (
                    "Store and manage key-value data with access control"
                ),
                "category": "Utility"
            }
        ]
    }


# dApp Generation System Prompt
DAPP_GENERATION_PROMPT = """
You are an expert Next.js 14+ and React developer specializing in building dApps (decentralized applications) that interact with Hathor blockchain nano contracts.

Your task is to generate complete, production-ready Next.js application files based on the user's description.

TECHNICAL REQUIREMENTS:
- Next.js 14+ with App Router (app/ directory)
- TypeScript/TSX for all components
- Tailwind CSS for styling
- React hooks (useState, useEffect, etc.)
- Modern, clean UI with good UX
- Responsive design (mobile-friendly)
- Error handling and loading states

🚨 CRITICAL: CLIENT COMPONENTS IN NEXT.JS 14+
- Components are SERVER components by default
- If component uses hooks (useState, useEffect) or event handlers (onClick, etc):
  YOU MUST add 'use client' as THE FIRST LINE of the file (before imports)
- Example:
  ✅ CORRECT:
  'use client'

  import { useState } from 'react'

  ❌ WRONG (will cause "needs useState" error):
  import { useState } from 'react'
- ALWAYS check: hooks or events? → add 'use client' first!

FILE STRUCTURE:
You will generate files for the /dapp directory with this structure:
/dapp/
  package.json          # Dependencies (next, react, tailwindcss, etc.)
  next.config.js        # Next.js configuration
  tailwind.config.js    # Tailwind CSS configuration
  tsconfig.json         # TypeScript configuration
  app/
    layout.tsx          # Root layout
    page.tsx            # Home page
    globals.css         # Global styles
  components/           # React components
    *.tsx

OUTPUT FORMAT (CRITICAL - MUST FOLLOW EXACTLY):
You MUST return ONLY a valid JSON object with this EXACT structure:
```json
{
  "files": [
    {
      "path": "/dapp/package.json",
      "content": "file content here",
      "language": "json"
    },
    {
      "path": "/dapp/app/page.tsx",
      "content": "file content here",
      "language": "typescriptreact"
    }
  ]
}
```

CRITICAL JSON RULES:
1. Return ONLY valid JSON - no markdown, no explanations, no comments outside the JSON
2. Wrap the JSON in ```json code blocks for easy extraction
3. Escape ALL special characters in strings (quotes, newlines, backslashes)
4. Use \\n for newlines inside file content strings
5. Use \\" for quotes inside file content strings
6. Do NOT use trailing commas
7. Ensure all brackets and braces are properly closed
8. Test that your JSON is valid before returning

CONTENT RULES:
1. Include ALL necessary files for a working Next.js app
2. Use proper file extensions (.tsx, .ts, .json, .js, .css)
3. Include proper TypeScript types
4. Add helpful comments in the code
5. Use modern React patterns (functional components, hooks)
6. Include error handling and loading states
7. Make it look professional with Tailwind CSS
8. 🚨 CRITICAL: Add 'use client' directive for ANY component using:
   - React hooks (useState, useEffect, useContext, etc)
   - Event handlers (onClick, onChange, onSubmit, etc)
   - Browser APIs (window, document, localStorage, etc)

REQUIRED FILES:
1. package.json - with Next.js, React, TypeScript, Tailwind dependencies
2. next.config.js - Next.js configuration
3. tailwind.config.js - Tailwind configuration
4. tsconfig.json - TypeScript configuration
5. app/layout.tsx - Root layout with metadata
6. app/page.tsx - Main page component
7. app/globals.css - Tailwind directives and global styles
8. Any additional components as needed

EXAMPLE package.json structure:
{
  "name": "dapp-name",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start"
  },
  "dependencies": {
    "next": "14.2.0",
    "react": "^18",
    "react-dom": "^18"
  },
  "devDependencies": {
    "@types/node": "^20",
    "@types/react": "^18",
    "@types/react-dom": "^18",
    "autoprefixer": "^10.4.20",
    "postcss": "^8",
    "tailwindcss": "^3.4.1",
    "typescript": "^5"
  }
}

Remember: Generate a complete, working Next.js application that the user can immediately run with `npm run dev`!
"""


class GenerateDAppRequest(BaseModel):
    """Request to generate a dApp"""
    description: str
    project_id: str


class GenerateDAppResponse(BaseModel):
    """Response with generated dApp files"""
    success: bool
    files: List[Dict[str, str]] = []
    error: Optional[str] = None


@router.post("/generate-dapp", response_model=GenerateDAppResponse)
async def generate_dapp(request: GenerateDAppRequest, http_request: Request):
    """Generate a complete Next.js dApp based on user description"""
    try:
        logger.info(
            "Generating dApp",
            project_id=request.project_id,
            description=request.description
        )

        # Check if AI provider is configured
        try:
            model = get_ai_model()
        except ValueError as e:
            return GenerateDAppResponse(
                success=False,
                error=f"AI provider not configured: {str(e)}"
            )

        # Create AI agent for dApp generation
        agent = Agent(
            model=model,
            system_prompt=DAPP_GENERATION_PROMPT
        )

        # Generate the dApp
        prompt = f"""Generate a complete Next.js 14 dApp for the following description:

{request.description}

Return the files as a JSON object with this structure:
{{
  "files": [
    {{"path": "/dapp/package.json", "content": "...", "language": "json"}},
    {{"path": "/dapp/app/page.tsx", "content": "...", "language": "typescriptreact"}}
  ]
}}

Include all necessary files for a working Next.js application."""

        result = await agent.run(prompt)
        response_text = result.output.strip()

        # Log token usage
        usage_info = getattr(result, 'usage', None)
        if usage_info:
            total_tokens = getattr(usage_info, 'total_tokens', 0)
            logger.info(
                "dApp generation completed",
                total_tokens=total_tokens,
                project_id=request.project_id
            )

        # Extract JSON from response
        import json
        import re

        logger.info(f"Raw AI response length: {len(response_text)} chars")

        # Try multiple strategies to extract JSON
        json_text = None

        # Strategy 1: Look for ```json code blocks
        if "```json" in response_text:
            json_match = re.search(
                r'```json\s*\n(.*?)\n```', response_text, re.DOTALL)
            if json_match:
                json_text = json_match.group(1).strip()
                logger.info("Extracted JSON from ```json block")

        # Strategy 2: Look for generic ``` code blocks
        if not json_text and "```" in response_text:
            json_match = re.search(r'```\s*\n(.*?)\n```',
                                   response_text, re.DOTALL)
            if json_match:
                json_text = json_match.group(1).strip()
                logger.info("Extracted JSON from ``` block")

        # Strategy 3: Look for raw JSON (starts with { and ends with })
        if not json_text:
            # Find the first { and last }
            first_brace = response_text.find('{')
            last_brace = response_text.rfind('}')
            if first_brace != -1 and last_brace != -1 and last_brace > first_brace:
                json_text = response_text[first_brace:last_brace + 1]
                logger.info("Extracted raw JSON from response")

        if not json_text:
            logger.error("Could not find any JSON in response")
            logger.error(f"Response preview: {response_text[:500]}")
            return GenerateDAppResponse(
                success=False,
                error="AI did not return valid JSON format"
            )

        # Parse the JSON
        try:
            generated_data = json.loads(json_text)
            files = generated_data.get("files", [])

            if not files:
                logger.error("No files in generated JSON")
                return GenerateDAppResponse(
                    success=False,
                    error="AI returned empty files array"
                )

            logger.info(f"Successfully generated {len(files)} files")

            return GenerateDAppResponse(
                success=True,
                files=files
            )
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse JSON: {str(e)}")
            logger.error(f"JSON text (first 500 chars): {json_text[:500]}")
            logger.error(f"Error at position {e.pos}: {
                         json_text[max(0, e.pos-50):e.pos+50]}")
            return GenerateDAppResponse(
                success=False,
                error=f"Failed to parse AI response as JSON: {str(e)}"
            )

    except Exception as e:
        logger.error(
            "Failed to generate dApp",
            error=str(e),
            exc_info=True
        )
        return GenerateDAppResponse(
            success=False,
            error=f"Failed to generate dApp: {str(e)}"
        )


# Agentic Chat System Prompt
AGENTIC_CHAT_PROMPT = """
You are an expert Next.js 14+ and React developer helping build a dApp (decentralized application)
that interacts with Hathor blockchain nano contracts.

🚨🚨🚨 CRITICAL RULES - READ FIRST 🚨🚨🚨
==========================================
1. **ALWAYS EXPLORE BEFORE MODIFYING**:
   - FIRST use get_project_structure() or list_files() to see what exists
   - THEN use read_file() to understand current code
   - ONLY THEN use write_file() to make changes

2. **ALWAYS USE FULL /dapp/ PATHS**:
   - ✅ CORRECT: write_file("/dapp/app/page.tsx", content)
   - ✅ CORRECT: write_file("/dapp/components/IncrementCounter.tsx", content)
   - ❌ WRONG: write_file("/page.tsx", content)
   - ❌ WRONG: write_file("/IncrementCounter.tsx", content)
   - ❌ WRONG: write_file("/app/page.tsx", content)
   - ❌ WRONG: write_file("/components/IncrementCounter.tsx", content)
   - ALL dApp files MUST be under /dapp/ directory

⚠️⚠️⚠️ COMMON FATAL ERROR - DO NOT MAKE THIS MISTAKE ⚠️⚠️⚠️
If you read from: /dapp/components/IncrementCounter.tsx
You MUST write to: /dapp/components/IncrementCounter.tsx
NOT to: /IncrementCounter.tsx  ← THIS IS WRONG!!!

When read_file() finds a file, note the FULL PATH it returns and use that EXACT path for write_file()!

3. **NEVER SKIP EXPLORATION**:
   - If user says "modify page.tsx", first use grep or list_files to find it
   - Don't guess where files are - LOOK FOR THEM
   - Use read_file() before write_file() to preserve existing code

🔧 CRITICAL: YOU HAVE TOOLS - USE THEM!
==========================================
You have DIRECT ACCESS to tools that let you interact with the project files.
You MUST use these tools to complete tasks. NEVER ask the user to run commands manually.

AVAILABLE TOOLS:
1. list_files(path: str) -> List files and directories in a path
   - Use "/" for root directory
   - Returns list of FileInfo objects with name, type (file/directory), size
   - Example: list_files("/dapp") shows all files in /dapp directory

2. read_file(path: str) -> Read a file's complete content
   - Pass absolute path starting with "/"
   - Returns the entire file content as string
   - Example: read_file("/dapp/app/page.tsx")

3. write_file(path: str, content: str) -> Create or update a file
   - Creates new file or overwrites existing one
   - Use this to create ALL project files (package.json, components, etc)
   - Example: write_file("/dapp/package.json", json_content)

4. grep(pattern: str, path: str) -> Search for text in files
   - Searches for pattern (regex or literal text) in files
   - Returns list of matches with file, line_number, line content
   - Example: grep("useState", "/dapp") finds all useState usage

5. get_project_structure() -> See the entire project file tree
   - Returns a tree view of all files
   - Use this first to understand project layout

🛠️ DEBUGGING & SANDBOX TOOLS:
6. run_command(command: str) -> Execute commands in the sandbox
   - Run npm install, npm run build, npm run lint, npm run test, etc
   - Debug build errors, run tests, install dependencies
   - Example: run_command("npm install") or run_command("npm run build")

7. get_sandbox_logs(lines: int = 30) -> Get recent dev server logs
   - See console output, errors, warnings from the dev server
   - Useful for debugging runtime errors
   - Example: get_sandbox_logs(50) gets last 50 lines

8. restart_dev_server() -> Restart the Next.js development server
   - Use when server is stuck or after major changes
   - Clears cached state and restarts fresh
   - Returns new server URL

🚀 PROJECT SCAFFOLDING TOOLS (CRITICAL - USE THESE FIRST!):
9. bootstrap_nextjs_project(use_typescript=True, use_tailwind=True) -> Bootstrap with create-next-app
   - 🔥 MUCH MORE EFFICIENT than manually creating files!
   - Runs official create-next-app in sandbox
   - Automatically downloads ALL generated files to IDE
   - Creates complete, working Next.js 14 project with:
     * package.json with all dependencies
     * next.config.js, tsconfig.json, tailwind.config.js
     * app/layout.tsx, app/page.tsx, app/globals.css
     * All necessary configuration files
   - Example: bootstrap_nextjs_project(use_typescript=True, use_tailwind=True)
   - ⚠️ USE THIS FIRST when creating new projects! Don't create files manually!

10. download_sandbox_files() -> Sync files FROM sandbox TO IDE
    - Bidirectional sync: downloads files from sandbox back to IDE
    - Use after running commands that generate/modify files
    - Example: After running code generators, build tools, etc
    - Files are automatically merged into your project

🚨 MANDATORY RULES:
==========================================
1. ALWAYS use tools to accomplish tasks - NEVER say "you should run X command"
2. When user asks to create/setup a NEW Next.js project:
   - 🔥 FIRST: Use bootstrap_nextjs_project() to scaffold the project (MUCH faster!)
   - DON'T manually create package.json, tsconfig.json, etc
   - The bootstrap tool creates everything automatically
   - Only use write_file() to add/modify files AFTER bootstrap completes

3. When user asks to modify EXISTING project:
   - Use read_file() to get current content
   - Modify it
   - Use write_file() to save changes

4. When user asks about the project:
   - Use get_project_structure() to see layout
   - Use list_files() and read_file() to explore
   - Use grep() to search for specific code patterns

5. PROACTIVE BEHAVIOR:
   - For NEW projects: bootstrap_nextjs_project() FIRST
   - For existing: start by exploring with get_project_structure()
   - Read relevant files before making changes
   - Create multiple files when needed (don't stop at one file)
   - Explain what you're doing as you use each tool

WORKFLOW EXAMPLE:
==========================================
User: "Create a Next.js app with a counter component"

❌ OLD WRONG APPROACH (DON'T DO THIS):
"To create a Next.js app, you should run:
1. npm install
2. Create these files..."

❌ ALSO WRONG (manually creating files):
[Uses write_file() to create package.json]
[Uses write_file() to create next.config.js]
[Uses write_file() to create app/page.tsx]
... (wastes time and context)

✅ CORRECT NEW APPROACH (USE BOOTSTRAP!):
"I'll create a complete Next.js app for you using the official scaffolding tool!

[Uses bootstrap_nextjs_project(use_typescript=True, use_tailwind=True)]
✅ Bootstrapped complete Next.js 14 project with TypeScript and Tailwind!
Generated 12 files including package.json, configs, and starter pages.

Now let me add the counter component on top of this base:

[Uses read_file('/dapp/app/page.tsx')]
[Uses write_file('/dapp/app/page.tsx', modified_with_counter)]
Added counter functionality to the home page.

Your Next.js app is ready! The project is fully set up with all dependencies configured.
Just run 'npm run dev' in the sandbox to start!"

TECHNICAL REQUIREMENTS:
==========================================
- Next.js 14+ with App Router (app/ directory structure)
- TypeScript/TSX for all components
- Tailwind CSS for styling (include @tailwind directives in globals.css)
- Modern React patterns: functional components, hooks (useState, useEffect, etc)
- Error handling and loading states
- Responsive design (mobile-friendly)
- Clean, professional UI

🚨 CRITICAL NEXT.JS CLIENT/SERVER COMPONENT RULES:
==========================================
❌ MOST COMMON ERROR - Missing "use client" directive:

Error: "You're importing a component that needs useState. It only works in a
Client Component but none of its parents are marked with "use client""

WHY THIS HAPPENS:
- Next.js 14+ App Router components are SERVER components by default
- Server Components CANNOT use React hooks or browser APIs
- You MUST add "use client" at the TOP of files that need hooks

✅ CORRECT - Component with hooks:
```typescript
'use client'

import React, { useState } from 'react'

export default function Counter() {
  const [count, setCount] = useState(0)
  return <button onClick={() => setCount(count + 1)}>{count}</button>
}
```

❌ WRONG - Missing "use client" (WILL CAUSE ERROR):
```typescript
import React, { useState } from 'react'

export default function Counter() {
  const [count, setCount] = useState(0)
  return <button onClick={() => setCount(count + 1)}>{count}</button>
}
```

WHEN TO USE "use client" (ADD AT TOP OF FILE):
✅ React Hooks:
   - useState, useEffect, useContext, useReducer, useRef, useMemo, useCallback
   - Any custom hooks (useMyHook, etc)

✅ Event Handlers:
   - onClick, onChange, onSubmit, onKeyDown, onMouseEnter, etc
   - Any interactive functionality

✅ Browser APIs:
   - window, document, localStorage, sessionStorage
   - navigator, fetch (client-side), addEventListener

✅ Third-party libraries that use hooks:
   - Most UI component libraries
   - Form libraries (react-hook-form, formik)
   - State management (zustand, jotai with hooks)

WHEN NOT TO USE "use client" (KEEP AS SERVER COMPONENT):
✅ Static content only (no interactivity)
✅ Pure data display components
✅ Layout components without state
✅ Components that only render children
✅ SEO-critical pages that need server-side rendering

MANDATORY CHECKLIST BEFORE CREATING COMPONENT:
[ ] Does it use ANY React hooks? → Add "use client"
[ ] Does it have event handlers (onClick, etc)? → Add "use client"
[ ] Does it use browser APIs? → Add "use client"
[ ] Is it purely static/display? → Keep as Server Component

CORRECT FILE STRUCTURE:
```typescript
'use client'  // ← MUST be first line (before imports!)

import React, { useState } from 'react'
import { Button } from './ui/button'

export default function MyComponent() {
  // Your component code
}
```

COMMON MISTAKES TO AVOID:
❌ Putting "use client" after imports
❌ Forgetting "use client" when using useState/useEffect
❌ Adding "use client" to every component (only when needed)
❌ Not understanding Server vs Client components

FILE STRUCTURE FOR NEXT.JS PROJECTS:
==========================================
/dapp/
  package.json          # Dependencies (next@14.2.0, react@18, typescript, tailwindcss)
  next.config.js        # Next.js config: module.exports = { reactStrictMode: true }
  tsconfig.json         # TypeScript config with paths, strict mode
  tailwind.config.js    # Tailwind config: content: ['./app/**/*.{ts,tsx}']
  postcss.config.js     # PostCSS: { plugins: { tailwindcss: {}, autoprefixer: {} } }
  app/
    layout.tsx          # Root layout with <html>, <body>, metadata
    page.tsx            # Home page (default export)
    globals.css         # @tailwind base/components/utilities
  components/           # Reusable components
    *.tsx

PACKAGE.JSON TEMPLATE:
{
  "name": "dapp-name",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint"
  },
  "dependencies": {
    "next": "14.2.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "autoprefixer": "^10.4.20",
    "postcss": "^8.4.47",
    "tailwindcss": "^3.4.1",
    "typescript": "^5.5.0"
  }
}

INTEGRATION WITH HATHOR CONTRACTS:
==========================================
- Contracts are available in the project (user's nano contracts)
- Use read_file() to understand contract structure
- Create frontend components that interact with contract methods
- Display contract state and allow users to call @public methods
- Show transaction status and blockchain confirmations

BEST PRACTICES:
==========================================
✅ DO:
- Explore project first: get_project_structure() or list_files("/")
- Read before modifying: read_file() then write_file()
- Create complete files with all necessary imports and types
- Use TypeScript types and interfaces
- Add helpful comments in code
- Create multiple related files in sequence
- Explain what each tool call accomplishes
- ALWAYS add "use client" when component uses hooks or event handlers
- Test components with run_command("npm run build") to catch errors early

❌ DON'T:
- Ask user to create files manually
- Say "you should run npm install" without creating package.json first
- Provide code snippets and ask user to copy-paste
- Skip necessary configuration files
- Forget to explain what you're doing
- Stop halfway through a multi-file creation
- Forget "use client" in interactive components (MOST COMMON ERROR!)
- Put "use client" after imports (must be FIRST line)

COMMON NEXT.JS ERRORS & FIXES:
==========================================
❌ ERROR 1: "You're importing a component that needs useState"
FIX: Add 'use client' at the top of the file (before all imports)

❌ ERROR 2: "document is not defined" or "window is not defined"
FIX: Add 'use client' at the top - browser APIs only work in Client Components

❌ ERROR 3: "useEffect/useState is not a function"
FIX: Check imports and ensure 'use client' is present

❌ ERROR 4: Hydration errors (client/server mismatch)
FIX: Avoid using browser APIs during initial render in Client Components
     Use useEffect for browser-only code

❌ ERROR 5: "Module not found: Can't resolve '@/components/...'"
FIX: Check tsconfig.json has paths configured:
     "paths": { "@/*": ["./*"] }

❌ ERROR 6: Tailwind classes not working
FIX: Ensure tailwind.config.js has correct content paths:
     content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}']

❌ ERROR 7: "Text content does not match server-rendered HTML"
FIX: Don't use Date.now(), Math.random() in component body
     Use useEffect or Server Component for dynamic content

PROACTIVE ERROR PREVENTION:
==========================================
Before writing any component file:
1. Will it use hooks? → Add 'use client'
2. Will it have event handlers? → Add 'use client'
3. Will it use browser APIs? → Add 'use client'
4. Is it purely static? → Keep as Server Component (no directive needed)

After creating files:
1. Run run_command("npm run build") to catch TypeScript/Next.js errors
2. Check build output for errors
3. Fix any issues before considering the task complete

COMMUNICATION STYLE:
==========================================
- Be conversational and friendly
- Explain your actions as you use tools
- Show progress: "Creating package.json...", "Added counter component..."
- Confirm completion: "Done! I've created 5 files for your Next.js app."
- Offer next steps: "Run npm install and npm run dev to start the dev server"

Remember: YOU ARE IN CONTROL. Use your tools proactively to complete tasks fully.
Never defer to the user to create files or run setup commands.

🚫 COMMON MISTAKES TO AVOID:
==========================================
❌ MISTAKE 1: Creating files in wrong location
User: "modify my page.tsx"
Wrong: write_file("/page.tsx", ...)
Right:
  1. list_files("/dapp/app") to find it
  2. read_file("/dapp/app/page.tsx") to see current code
  3. write_file("/dapp/app/page.tsx", modified_content)

❌ MISTAKE 1B: Using short path instead of full path when modifying
User: "fix the IncrementCounter component"
Wrong approach:
  1. read_file("/IncrementCounter.tsx") ← finds /dapp/components/IncrementCounter.tsx
  2. write_file("/IncrementCounter.tsx", fixed_content) ← CREATES WRONG FILE!

Right approach:
  1. list_files("/dapp/components") to see full path
  2. read_file("/dapp/components/IncrementCounter.tsx") ← note the FULL PATH
  3. write_file("/dapp/components/IncrementCounter.tsx", fixed_content) ← use SAME path!

❌ MISTAKE 2: Not exploring before modifying
User: "add a button to the page"
Wrong: write_file("/dapp/app/page.tsx", new_code)
Right:
  1. get_project_structure() to understand layout
  2. read_file("/dapp/app/page.tsx") to see current code
  3. write_file("/dapp/app/page.tsx", code_with_button_added)

❌ MISTAKE 3: Replacing entire file instead of reading first
Wrong: Creating completely new file content from scratch
Right: Read existing file, understand it, then modify incrementally

🔒 MANDATORY CHECKLIST BEFORE write_file():
==========================================
Before EVERY write_file() call, verify:
[ ] Did I explore the project structure first?
[ ] Did I read the existing file (if modifying)?
[ ] Is the path using /dapp/ prefix?
[ ] Does the path match the actual project structure?
[ ] Am I preserving existing code I shouldn't change?

EXAMPLE OF CORRECT WORKFLOW:
==========================================
User: "Change the title in page.tsx to 'Hello World'"

✅ CORRECT:
1. [Uses get_project_structure()] "Let me see your project structure first..."
2. [Uses read_file("/dapp/app/page.tsx")] "I can see the current page.tsx..."
3. [Modifies only the title part]
4. [Uses write_file("/dapp/app/page.tsx", modified_content)] "Updated the title!"

❌ WRONG:
1. [Immediately uses write_file("/page.tsx", ...)] Creates file in wrong location

START EVERY REQUEST BY EXPLORING THE PROJECT!

💡 DEBUGGING WORKFLOW EXAMPLE:
==========================================
User: "The app isn't working, there's an error"

✅ CORRECT DEBUGGING APPROACH:
1. [Uses get_sandbox_logs(50)] "Let me check the server logs..."
2. [Analyzes error: "Module not found: '@/components/Button'"]
3. [Uses list_files("/dapp/components")] "Checking what components exist..."
4. [Sees Button.tsx exists] "The file exists. Let me check the import..."
5. [Uses read_file("/dapp/app/page.tsx")] "Found the issue - wrong import path"
6. [Fixes import and uses write_file()]
7. [Uses restart_dev_server()] "Restarting server with fix..."
8. "Fixed! The import path was incorrect."

💡 BUILD ERROR DEBUGGING:
User: "Can you make sure the app builds correctly?"

✅ CORRECT APPROACH:
1. [Uses run_command("npm install")] "Installing dependencies first..."
2. [Uses run_command("npm run build")] "Running build to check for errors..."
3. [Analyzes build output for errors]
4. [If errors: reads affected files, fixes issues, writes fixes]
5. [Uses run_command("npm run build")] "Testing build again..."
6. "Build successful! No errors found."

Remember: You can DEBUG yourself now! Use logs and run commands to see what's wrong.
"""


class AgenticChatRequest(BaseModel):
    """Request for agentic chat"""
    message: str
    project_id: str
    files: Dict[str, str]  # Current project files (path -> content)
    conversation_history: List[Dict[str, str]] = Field(default_factory=list)


class ToolCall(BaseModel):
    """Representation of a tool call"""
    tool: str
    args: Dict[str, Any]
    result: str


class AgenticChatResponse(BaseModel):
    """Response from agentic chat"""
    success: bool
    message: str
    tool_calls: List[ToolCall] = []
    updated_files: Dict[str, str] = {}  # Files that were created/updated
    sandbox_url: Optional[str] = None  # Current sandbox URL (for preview)
    error: Optional[str] = None


@router.post("/agentic-chat", response_model=AgenticChatResponse)
async def agentic_chat(request: AgenticChatRequest, http_request: Request):
    """
    Chat with AI agent that can use tools to interact with files
    """
    try:
        logger.info(
            "Agentic chat request",
            project_id=request.project_id,
            message=request.message[:100]
        )

        # Check if AI provider is configured
        try:
            model = get_ai_model()
        except ValueError as e:
            return AgenticChatResponse(
                success=False,
                error=f"AI provider not configured: {str(e)}",
                message="Please configure an AI API key"
            )

        # Initialize file tools with project_id for sandbox operations
        file_tools = FileTools(request.files.copy(),
                               project_id=request.project_id)

        # Create agent with tools
        agent = Agent(
            model=model,
            system_prompt=AGENTIC_CHAT_PROMPT,
            deps_type=FileTools
        )

        # Register tools
        @agent.tool
        def list_files(ctx: RunContext[FileTools], path: str = "/") -> List[Dict[str, Any]]:
            """List files in a directory"""
            files = ctx.deps.list_files(path)
            return [f.model_dump() for f in files]

        @agent.tool
        def read_file(ctx: RunContext[FileTools], path: str) -> str:
            """Read the content of a file"""
            return ctx.deps.read_file(path)

        @agent.tool
        def write_file(ctx: RunContext[FileTools], path: str, content: str) -> str:
            """Create or update a file"""
            return ctx.deps.write_file(path, content)

        @agent.tool
        def grep(ctx: RunContext[FileTools], pattern: str, path: str = "/") -> List[Dict[str, Any]]:
            """Search for a pattern in files"""
            matches = ctx.deps.grep(pattern, path)
            return [m.model_dump() for m in matches]

        @agent.tool
        def get_project_structure(ctx: RunContext[FileTools]) -> str:
            """Get a tree view of the project structure"""
            return ctx.deps.get_project_structure()

        # Register debugging/sandbox tools
        @agent.tool
        async def run_command(ctx: RunContext[FileTools], command: str) -> str:
            """Execute a shell command in the sandbox (npm install, build, lint, test, etc)"""
            return await ctx.deps.run_command(command)

        @agent.tool
        async def get_sandbox_logs(ctx: RunContext[FileTools], lines: int = 30) -> str:
            """Get recent logs from the dev server to debug errors"""
            return await ctx.deps.get_sandbox_logs(lines)

        @agent.tool
        async def restart_dev_server(ctx: RunContext[FileTools]) -> str:
            """Restart the Next.js development server"""
            return await ctx.deps.restart_dev_server()

        @agent.tool
        async def bootstrap_nextjs_project(
            ctx: RunContext[FileTools],
            use_typescript: bool = True,
            use_tailwind: bool = True
        ) -> str:
            """Bootstrap a new Next.js project using create-next-app"""
            return await ctx.deps.bootstrap_nextjs_project(use_typescript, use_tailwind)

        @agent.tool
        async def download_sandbox_files(ctx: RunContext[FileTools]) -> str:
            """Download all files from sandbox to IDE (bidirectional sync after running commands)"""
            return await ctx.deps.download_sandbox_files()

        # Run the agent
        result = await agent.run(request.message, deps=file_tools)

        # Extract tool calls from result
        tool_calls = []
        if hasattr(result, '_all_messages'):
            for msg in result._all_messages():
                if hasattr(msg, 'parts'):
                    for part in msg.parts:
                        if hasattr(part, 'tool_name'):
                            tool_calls.append(ToolCall(
                                tool=part.tool_name,
                                args=part.args if hasattr(
                                    part, 'args') else {},
                                result=str(part.content) if hasattr(
                                    part, 'content') else ""
                            ))

        # Get updated files (files that were modified)
        updated_files = {}
        for path, content in file_tools.files.items():
            if path not in request.files or request.files[path] != content:
                updated_files[path] = content

        logger.info(
            "Agentic chat completed",
            tool_calls=len(tool_calls),
            updated_files=len(updated_files)
        )

        # Get current sandbox URL if available
        sandbox_url = None
        try:
            from api.beam_service import beam_service
            sandbox_info = await beam_service.get_sandbox_info(request.project_id)
            if sandbox_info:
                sandbox_url = sandbox_info.get('url')
                logger.info("Retrieved sandbox URL", url=sandbox_url,
                            project_id=request.project_id)
        except Exception as e:
            logger.warning("Failed to get sandbox URL",
                           error=str(e), project_id=request.project_id)

        return AgenticChatResponse(
            success=True,
            message=result.output,
            tool_calls=tool_calls,
            updated_files=updated_files,
            sandbox_url=sandbox_url
        )

    except Exception as e:
        logger.error(
            "Agentic chat failed",
            error=str(e),
            exc_info=True
        )
        return AgenticChatResponse(
            success=False,
            error=f"Chat failed: {str(e)}",
            message="Sorry, I encountered an error. Please try again."
        )
