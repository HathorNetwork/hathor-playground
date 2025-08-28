/**
 * Mock loader for Hathor modules
 * Provides mock Python code for browser compatibility
 */

import { rocksdbSetupMock } from './mocks/rocksdb';
import { cryptographySetupMock } from './mocks/cryptography';
import { twistedSetupMock } from './mocks/twisted';
import { zopeSetupMock } from './mocks/zope';
import { pycoinSetupMock } from './mocks/pycoin';

// Mock content for individual modules (these remain embedded as they are simpler)
const reactorMock = `# Stub module for browser compatibility
import time
from structlog import get_logger

logger = get_logger()

class MockReactorProtocol:
    def __init__(self):
        pass
    
    def seconds(self):
        """Return current timestamp - this is what NCLogger actually uses"""
        return time.time()
    
    def callLater(self, delay, func, *args, **kwargs):
        # Not actually used by runner, but included for completeness
        return None
    
    def stop(self):
        # Not actually used by runner, but included for completeness  
        pass

_reactor = None

def get_global_reactor():
    global _reactor
    if _reactor is None:
        _reactor = MockReactorProtocol()
    return _reactor

def initialize_global_reactor(use_asyncio_reactor=False):
    global _reactor
    if _reactor is None:
        _reactor = MockReactorProtocol()
    return _reactor`;

const versionMock = `# Browser-compatible version module
import re
try:
    import structlog
    logger = structlog.get_logger()
except ImportError:
    class MinimalLogger:
        def info(self, *args, **kwargs): pass
        def error(self, *args, **kwargs): pass
        def warning(self, *args, **kwargs): pass
        def debug(self, *args, **kwargs): pass
    logger = MinimalLogger()

BASE_VERSION = '0.66.0'
DEFAULT_VERSION_SUFFIX = "local"
BUILD_VERSION_FILE_PATH = "./BUILD_VERSION"

# Valid formats: 1.2.3, 1.2.3-rc.1 and nightly-ab49c20f
BUILD_VERSION_REGEX = r"^(\\d+\\.\\d+\\.\\d+(-(rc|alpha|beta)\\.\\d+)?|nightly-[a-f0-9]{7,8})$"

__version__ = '1.0.0-browser'
MAJOR = 1
MINOR = 0
PATCH = 0

def _get_version():
    return __version__`;

const settingsMock = `# Stub module for browser compatibility with essential settings
from typing import Any, Dict

# Essential Hathor token UID - this is the native HTR token
HATHOR_TOKEN_UID = bytes.fromhex('00')

class HathorSettings:
    """Mock Hathor settings for browser-based contract execution."""
    
    def __init__(self):
        # Essential settings that nano contracts might need
        self.HATHOR_TOKEN_UID = HATHOR_TOKEN_UID
        self.NANO_CONTRACTS_ENABLED = True
        self.MIN_BLOCK_WEIGHT = 21
        self.MAX_BLOCK_WEIGHT = 256
        
        # Network settings (mocked)
        self.NETWORK = 'testnet'
        self.NETWORK_NAME = 'testnet'
        
        # Memory limits for contracts
        self.NC_MEMORY_LIMIT = 8 * 1024 * 1024  # 8MB
        self.NC_FUEL_LIMIT = 1000000  # 1M fuel units
        
        # Token creation settings
        self.TOKENS_PER_BLOCK = 6400  # HTR tokens per block
        
    def __getattr__(self, name):
        # Default fallback for any missing settings
        if name.startswith('NC_'):
            return True  # Enable nano contract features
        elif name.endswith('_LIMIT'):
            return 1000000  # Default limits
        else:
            return None
    
    @classmethod
    def from_yaml(cls, yaml_content=None, **kwargs):
        """Mock from_yaml class method that returns a HathorSettings instance"""
        # Ignore yaml content and just return a default settings instance
        return cls()

# Create default settings instance
_settings = HathorSettings()

# Export the settings instance and common constants
HATHOR_TOKEN_UID = _settings.HATHOR_TOKEN_UID
NANO_CONTRACTS_ENABLED = True
MIN_BLOCK_WEIGHT = _settings.MIN_BLOCK_WEIGHT
MAX_BLOCK_WEIGHT = _settings.MAX_BLOCK_WEIGHT

def get_global_settings():
    """Get the global settings instance."""
    return _settings

# For compatibility with different import patterns
default_settings = _settings`;

const onChainBlueprintMock = `# Stub module for browser compatibility
from hathor.transaction import Transaction

# Constants from the original module
ON_CHAIN_BLUEPRINT_VERSION = 1
BLUEPRINT_CLASS_NAME = '__blueprint__'
PYTHON_CODE_COMPAT_VERSION = (3, 11)
MAX_COMPRESSION_LEVEL = 9

class OnChainBlueprint(Transaction):
    def __init__(self, *args, **kwargs):
        # Mock initialization without calling parent
        pass
    
    def blueprint_id(self):
        return b'mock_blueprint_id'
    
    def get_blueprint_class(self):
        from hathor.nanocontracts.blueprint import Blueprint
        return Blueprint
    
    def get_method(self, method_name):
        class MockMethod:
            def __init__(self, name):
                self.name = name
        return MockMethod(method_name)`;

const transactionStorageMock = `# Stub module for browser compatibility
from typing import Dict, Any, Optional
from abc import ABC, abstractmethod

class BlueprintNotFoundError(Exception):
    """Raised when a blueprint is not found in storage."""
    def __init__(self, blueprint_id):
        self.blueprint_id = blueprint_id
        super().__init__(f"Blueprint not found: {blueprint_id}")

class TransactionStorage(ABC):
    """Abstract base class for transaction storage."""
    
    @abstractmethod
    def get_blueprint_class(self, blueprint_id):
        """Get blueprint class by ID."""
        pass

class BaseTransactionStorage(TransactionStorage):
    """Base transaction storage class that other storage classes inherit from."""
    
    def __init__(self, *args, **kwargs):
        # Accept any arguments for compatibility
        pass
    
    def get_blueprint_class(self, blueprint_id):
        """Get blueprint class by ID."""
        # Default implementation - can be overridden
        if hasattr(self, '_blueprints') and blueprint_id in self._blueprints:
            return self._blueprints[blueprint_id]
        raise BlueprintNotFoundError(blueprint_id)
    
    def get_transaction(self, tx_id):
        """Get transaction by ID - stub implementation."""
        return None
    
    def get_vertex(self, vertex_id):
        """Get vertex by ID - stub implementation."""
        return None
    
    def save_transaction(self, tx):
        """Save transaction - stub implementation."""
        pass

class MockTransactionStorage(BaseTransactionStorage):
    """Mock transaction storage for browser-based contract testing."""
    
    def __init__(self, blueprints: Optional[Dict[bytes, Any]] = None):
        self._blueprints = blueprints or {}
    
    def get_blueprint_class(self, blueprint_id: bytes):
        """Get blueprint class by ID - only method needed by nano contracts runner."""
        if blueprint_id not in self._blueprints:
            raise BlueprintNotFoundError(blueprint_id)
        return self._blueprints[blueprint_id]
    
    def add_blueprint(self, blueprint_id: bytes, blueprint_class):
        """Add a blueprint to the mock storage."""
        self._blueprints[blueprint_id] = blueprint_class
    
    def has_blueprint(self, blueprint_id: bytes) -> bool:
        """Check if blueprint exists in storage."""
        return blueprint_id in self._blueprints
    
    def list_blueprints(self):
        """List all available blueprint IDs."""
        return list(self._blueprints.keys())

# For backward compatibility, create a default instance
default_storage = MockTransactionStorage()`;

const utilsMock = `# Stub module for browser compatibility with real functions
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
    pass`;

const rngMock = `# Stub module for browser compatibility
import random
from typing import Sequence, TypeVar

T = TypeVar('T')

class NanoRNG:
    """Mock implementation of deterministic RNG for browser compatibility."""
    
    def __init__(self, seed: bytes) -> None:
        self.__seed = seed
        # Use Python's random with a deterministic seed derived from the input
        seed_int = int.from_bytes(seed[:8], byteorder='little') if len(seed) >= 8 else 0
        self._rng = random.Random(seed_int)
    
    @property
    def seed(self):
        """Return the seed used to create the RNG."""
        return self.__seed
    
    def randbytes(self, size: int) -> bytes:
        """Return a random string of bytes."""
        return bytes([self._rng.randint(0, 255) for _ in range(size)])
    
    def randbits(self, bits: int) -> int:
        """Return a random integer in the range [0, 2**bits)."""
        return self._rng.getrandbits(bits)
    
    def randbelow(self, n: int) -> int:
        """Return a random integer in the range [0, n)."""
        return self._rng.randrange(n)
    
    def randrange(self, start: int, stop: int, step: int = 1) -> int:
        """Return a random integer in the range [start, stop) with a given step."""
        return self._rng.randrange(start, stop, step)
    
    def randint(self, a: int, b: int) -> int:
        """Return a random integer in the range [a, b]."""
        return self._rng.randint(a, b)
    
    def choice(self, seq: Sequence[T]) -> T:
        """Choose a random element from a non-empty sequence."""
        return self._rng.choice(seq)
    
    def random(self) -> float:
        """Return a random float in the range [0, 1)."""
        return self._rng.random()`;

export class MockLoader {
  private static mocks: Record<string, string> = {
    version: versionMock,
    reactor: reactorMock,
    settings: settingsMock,
    on_chain_blueprint: onChainBlueprintMock,
    transaction_storage: transactionStorageMock,
    utils: utilsMock,
    rng: rngMock,
  };

  private static setupMocks: Record<string, string> = {
    twisted: twistedSetupMock,
    zope: zopeSetupMock,
    rocksdb: rocksdbSetupMock,
    cryptography: cryptographySetupMock,
    pycoin: pycoinSetupMock,
  };

  /**
   * Load a mock file by name
   */
  static loadMock(mockName: string): string {
    return this.mocks[mockName] || `# Stub module for browser compatibility\npass`;
  }

  /**
   * Get mock setup code for initializing complex mock modules
   */
  static getSetupMock(mockName: string): string {
    return this.setupMocks[mockName] || '';
  }

  /**
   * Get all setup mocks as a single script
   */
  static getAllSetupMocks(): string {
    return Object.values(this.setupMocks).join('\n\n');
  }

  /**
   * Get mock content for a specific Hathor module path
   */
  static getMockForPath(filePath: string): string | null {
    if (filePath === 'hathor/version.py') {
      return this.loadMock('version');
    }
    
    if (filePath.includes('hathor/nanocontracts/utils.py')) {
      return this.loadMock('utils');
    }
    
    if (filePath.includes('hathor/nanocontracts/rng.py')) {
      return this.loadMock('rng');
    }
    
    if (filePath.includes('hathor/reactor/reactor.py')) {
      return this.loadMock('reactor');
    }
    
    if (filePath.includes('hathor/nanocontracts/on_chain_blueprint.py')) {
      return this.loadMock('on_chain_blueprint');
    }
    
    if (filePath.includes('hathor/transaction/storage/transaction_storage.py')) {
      return this.loadMock('transaction_storage');
    }
    
    if (filePath.includes('hathor/conf/settings.py')) {
      return this.loadMock('settings');
    }

    return null; // No mock needed for this path
  }

  /**
   * Check if a file path needs mocking
   */
  static needsMocking(filePath: string): boolean {
    const problematicModules = [
      'hathor/cli/run_node.py', // Uses twisted reactor
      'hathor/p2p/protocol.py', // Uses twisted
      'hathor/reactor/reactor.py', // Uses twisted
      'hathor/websocket/factory.py', // Uses twisted
      'hathor/stratum/stratum.py', // Uses twisted
      'hathor/nanocontracts/rng.py', // Uses cryptography
      'hathor/nanocontracts/on_chain_blueprint.py', // Uses cryptography  
      'hathor/nanocontracts/utils.py', // Uses cryptography and pycoin - create proper stub
      'hathor/transaction/storage/transaction_storage.py', // Uses threading, RocksDB
      'hathor/conf/settings.py', // System-specific settings
    ];

    return problematicModules.some(mod => filePath.includes(mod));
  }
}