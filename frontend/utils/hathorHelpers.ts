/**
 * Common Hathor helper functions for browser-based contract execution and testing
 * Shared between pyodide-runner.ts and hathorTestMocks.ts
 */

export const HATHOR_HELPERS = `
# Helper function for generating random bytes (compatible with older Python)
def _gen_random_bytes(n):
    try:
        import secrets
        return secrets.randbytes(n)
    except (ImportError, AttributeError):
        import os
        return os.urandom(n)


def _is_valid_hathor_address(address_str):
    """Check if a string looks like a valid Hathor address"""
    if not isinstance(address_str, str):
        return False
    
    # Check prefix - Hathor addresses start with H, h, W, or w
    if not address_str[0] in 'HhWw':
        return False
    
    # Check length - Hathor addresses are typically 34-35 characters
    if len(address_str) < 25 or len(address_str) > 40:
        return False
    
    # Check if it's valid base58 by trying to decode
    try:
        import base58
        decoded = base58.b58decode(address_str)
        # Hathor addresses should decode to 25 bytes
        return len(decoded) == 25
    except (ValueError, ImportError):
        return False

def _create_address_from_b58(b58_str):
    try:
        import base58
        decoded_address = base58.b58decode(b58_str)
    except ValueError:
        raise ValueError('Invalid base58 address')

    if len(decoded_address) != 25:
        raise ValueError('Address size must have 25 bytes')

    return decoded_address


def _convert_frontend_args(args_json, kwargs_json):
    """Convert JSON strings from frontend to Python objects"""
    import json

    def parse_arg(arg):
        # Handle different argument types from frontend
        if arg == '00':
            return bytes.fromhex('00')
        if isinstance(arg, str):
            # Check if it's a 64-character hex string (token uid, contract id, blueprint id, etc.)
            if len(arg) == 64 and all(c in '0123456789abcdefABCDEF' for c in arg):
                return bytes.fromhex(arg)
            # Check if it's a Hathor address using proper validation
            elif _is_valid_hathor_address(arg):
                try:
                    return _create_address_from_b58(arg)
                except ValueError:
                    # If address conversion fails, return as string
                    pass
        return arg

    # Parse JSON strings
    args = json.loads(args_json) if args_json else []
    kwargs = json.loads(kwargs_json) if kwargs_json else {}

    parsed_args = [parse_arg(arg) for arg in args]
    parsed_kwargs = {k: parse_arg(v) for k, v in kwargs.items()}
    print(f"Converted args from frontend: {parsed_args}")
    print(f"Converted kwargs from frontend: {parsed_kwargs}")

    return parsed_args, parsed_kwargs


def _create_actions(actions_json):
    actions_list = []
    if actions_json:
        import json
        from hathor.nanocontracts.types import NCDepositAction, NCWithdrawalAction, TokenUid
        for action_data in json.loads(actions_json):
            token_uid = TokenUid(bytes.fromhex(action_data['tokenId']))
            amount = int(action_data['amount'])
            if action_data['type'] == 'deposit':
                actions_list.append(NCDepositAction(token_uid=token_uid, amount=amount))
            elif action_data['type'] == 'withdrawal':
                actions_list.append(NCWithdrawalAction(token_uid=token_uid, amount=amount))

    return actions_list

def _create_context(
    caller_address,
    actions=None,
    vertex=None,
    timestamp=None
):
    """Create context for contract execution using real Hathor Context"""
    from hathor.nanocontracts.context import Context
    from hathor.nanocontracts.types import Address, VertexId
    from hathor.nanocontracts.vertex_data import BlockData, VertexData

    # Handle caller_id
    caller_hash = _create_address_from_b58(caller_address)
    caller_id = Address(caller_hash)

    # Handle vertex_data - use provided vertex or create minimal one
    if vertex:
        vertex_data = VertexData.create_from_vertex(vertex)
    else:
        # Create minimal vertex for VertexData.create_from_vertex()
        from hathor.transaction import Transaction

        # Create a minimal transaction as vertex
        minimal_vertex = Transaction(
            hash=b'\\\\x00' * 32,
            timestamp=timestamp or int(__import__('time').time()),
            version=1,
            weight=1.0,
            inputs=[],
            outputs=[],
            parents=[]
        )
        vertex_data = VertexData.create_from_vertex(minimal_vertex)

    # Create block_data following the unittest pattern
    block_data = BlockData(
        hash=VertexId(b'\\\\x00' * 32),  # Empty hash like in unittest
        timestamp=timestamp or int(__import__('time').time()),
        height=0
    )

    return Context(
        caller_id=caller_id,
        vertex_data=vertex_data,
        block_data=block_data,
        actions=Context.__group_actions__(actions or ()),  # Group provided or empty actions
    )

def _monkeyPatchNodeTrieStore():
    import hathor.nanocontracts.storage.backends
    from hathor.nanocontracts.storage.patricia_trie import Node
    NodeTrieStore = hathor.nanocontracts.storage.backends.NodeTrieStore

    class MockMemoryNodeTrieStore(NodeTrieStore):
        def __init__(self) -> None:
            self._db: dict[bytes, Node] = {}

        def __getitem__(self, key: bytes) -> Node:
            return self._db[key]

        def __setitem__(self, key: bytes, item: Node) -> None:
            self._db[key] = item

        def __len__(self) -> int:
            return len(self._db)

        def __contains__(self, key: bytes) -> bool:
            return key in self._db

    hathor.nanocontracts.storage.backends.MemoryNodeTrieStore = MockMemoryNodeTrieStore
`;

export const getHathorHelpers = () => HATHOR_HELPERS;
