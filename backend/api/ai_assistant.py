"""
AI Assistant API router - handles AI assistant requests
"""
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Request
from pydantic import BaseModel, Field
import structlog
import os
import re
from pydantic_ai import Agent
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.models.gemini import GeminiModel
from middleware.rate_limit import token_tracker

logger = structlog.get_logger()
router = APIRouter()


def get_ai_model():
    """Get AI model based on environment configuration"""
    provider = os.getenv("AI_PROVIDER", "openai").lower()

    if provider == "openai":
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise ValueError("OpenAI API key not configured")
        # Set the API key in environment for OpenAI
        os.environ["OPENAI_API_KEY"] = api_key
        return OpenAIChatModel("gpt-4o-mini")
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

        if modified_code_match and original_code:
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

You are Clippy, a helpful AI assistant for Hathor Nano Contracts development! 📎

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
