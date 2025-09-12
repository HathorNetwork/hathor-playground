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

def _create_address_from_hex(hex_str):
    """Convert hex string to 25-byte address"""
    # Ensure we always return bytes, not Address objects
    if len(hex_str) == 50:  # 25 bytes
        return bytes.fromhex(hex_str)
    elif len(hex_str) == 64:  # 32 bytes, truncate to 25
        return bytes.fromhex(hex_str[:50])
    else:
        raise ValueError(f"Invalid address length: {len(hex_str)} chars")

def _convert_frontend_args(args_json, kwargs_json):
    """Convert JSON strings from frontend to Python objects"""
    import json

    def parse_arg(arg):
        # TODO need a better way to parse arguments to correct types
        if arg == '00':
            return bytes.fromhex("00")
        if isinstance(arg, str) and len(arg) == 64:
            # 64 char strings are usually token uids, contract ids, blueprint ids, etc
            return bytes.fromhex(arg)
        return arg

    # Parse JSON strings
    args = json.loads(args_json) if args_json else []
    kwargs = json.loads(kwargs_json) if kwargs_json else {}

    parsed_args = [parse_arg(arg) for arg in args]
    parsed_kwargs = {k: parse_args(v) for k, v in kwargs.items()}
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
    caller_address_hex=None,
    actions=None,
    vertex=None,
    timestamp=None
):
    """Create context for contract execution using real Hathor Context"""
    from hathor.nanocontracts.context import Context
    from hathor.nanocontracts.types import Address, VertexId
    from hathor.nanocontracts.vertex_data import BlockData, VertexData

    # Handle caller_id
    if caller_address_hex:
        caller_hash = _create_address_from_hex(caller_address_hex)
        caller_id = Address(caller_hash)
    else:
        # Generate random address if none provided (like gen_random_address())
        random_hash = _gen_random_bytes(25)  # 25-byte address using our helper
        caller_id = Address(random_hash)

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
`;

export const getHathorHelpers = () => HATHOR_HELPERS;
