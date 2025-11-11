export const utilsMock = `# Stub module for browser compatibility with real functions
import hashlib
from typing import Callable
from hathor.nanocontracts.types import NC_METHOD_TYPE_ATTR, NCMethodType

# Constants
CHILD_CONTRACT_ID_PREFIX = b'child-contract'
CHILD_TOKEN_ID_PREFIX = b'child-token'

def is_nc_public_method(method: Callable) -> bool:
    """Return True if the method is nc_public."""
    return getattr(method, NC_METHOD_TYPE_ATTR, None) is NCMethodType.PUBLIC

def is_nc_view_method(method: Callable) -> bool:
    """Return True if the method is nc_view."""
    return getattr(method, NC_METHOD_TYPE_ATTR, None) is NCMethodType.VIEW

def is_nc_fallback_method(method: Callable) -> bool:
    """Return True if the method is nc_fallback."""
    return getattr(method, NC_METHOD_TYPE_ATTR, None) is NCMethodType.FALLBACK

def load_builtin_blueprint_for_ocb(filename: str, blueprint_name: str, module=None) -> str:
    """Get blueprint code from a file."""
    # Mock implementation
    return f"# Mock blueprint for {blueprint_name}\\npass"

def derive_child_contract_id(parent_id, salt: bytes, blueprint_id):
    """Derives the contract id for a nano contract created by another (parent) contract."""
    h = hashlib.sha256()
    h.update(CHILD_CONTRACT_ID_PREFIX)
    h.update(parent_id)
    h.update(salt)
    h.update(blueprint_id)
    return h.digest()

def derive_child_token_id(parent_id, token_symbol: str):
    """Derive the token id for a token created by a (parent) contract."""
    h = hashlib.sha256()
    h.update(CHILD_TOKEN_ID_PREFIX)
    h.update(parent_id)
    h.update(token_symbol.encode('utf-8'))
    return h.digest()

# Mock signing functions that would use cryptography/pycoin
def sign_openssl(nano_header, privkey):
    """Mock sign function."""
    pass

def sign_pycoin(nano_header, privkey):
    """Mock sign function."""
    pass

def sign_openssl_multisig(nano_header, required_count, redeem_pubkey_bytes, sign_privkeys):
    """Mock multisig sign function."""
    pass;

def sha3(data: bytes) -> bytes:
    """Calculate the SHA3-256 of some data."""
    return hashlib.sha3_256(data).digest()

def verify_ecdsa(public_key: bytes, data: bytes, signature: bytes) -> bool:
    # TODO properly mock this function
    return True
`
