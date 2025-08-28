/**
 * Mock loader for Hathor modules
 * Provides mock Python code for browser compatibility
 */

// Mock content loaded from separate .py files
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

// Complete setup scripts for complex mock modules
const twistedSetupMock = `
# Set up Twisted mock modules
try:
    import twisted
except ImportError:
    import sys
    import types

    # Create comprehensive mock classes that handle any method call
    class MockBase:
        def __init__(self, *args, **kwargs):
            pass
        
        def __getattr__(self, name):
            # Return a mock method for any attribute access
            def mock_method(*args, **kwargs):
                return MockBase()
            return mock_method
        
        def __call__(self, *args, **kwargs):
            return MockBase()
        
        def __iter__(self):
            # Return an empty iterator to handle iteration
            return iter([])
        
        def __len__(self):
            return 0
        
        def __bool__(self):
            return True
        
        def __str__(self):
            return "MockBase"
        
        def __repr__(self):
            return "MockBase()"
    
    class Protocol(MockBase):
        pass
    
    class Factory(MockBase):
        pass
    
    class Deferred(MockBase):
        def addCallback(self, callback):
            return self
        
        def addErrback(self, errback):
            return self
    
    def succeed(result):
        return Deferred()
    
    def fail(failure):
        return Deferred()
    
    # Create comprehensive mock modules
    class MockTwistedModule:
        def __getattr__(self, name):
            return MockBase()
    
    # Mock reactor with comprehensive method coverage
    class MockReactor(MockBase):
        def callLater(self, delay, func, *args, **kwargs):
            return MockBase()
        
        def connectTCP(self, host, port, factory):
            return MockBase()
        
        def listenTCP(self, port, factory):
            return MockBase()
        
        def run(self):
            pass
        
        def stop(self):
            pass
    
    reactor = MockReactor()
    
    # Create twisted stub modules using dynamic mocks
    twisted_mod = MockTwistedModule()
    internet_mod = MockTwistedModule()
    reactor_mod = MockTwistedModule()
    protocol_mod = MockTwistedModule()
    defer_mod = MockTwistedModule()
    python_mod = MockTwistedModule()
    log_mod = MockTwistedModule()
    
    # Create a comprehensive mock interface module that returns mock classes for any attribute
    class MockInterface:
        pass
    
    class MockInterfacesModule:
        def __getattr__(self, name):
            # Return a mock interface class for any requested interface
            return type(name, (MockInterface,), {})
    
    # Replace the interfaces module with our dynamic mock
    interfaces_mod = MockInterfacesModule()
    
    # Add common interfaces explicitly
    interfaces_mod.IProtocol = MockInterface
    interfaces_mod.IFactory = MockInterface  
    interfaces_mod.IReactorCore = MockInterface
    interfaces_mod.IDelayedCall = MockInterface
    
    # Assign specific classes/functions to modules
    protocol_mod.Protocol = Protocol
    protocol_mod.Factory = Factory
    defer_mod.Deferred = Deferred
    defer_mod.succeed = succeed
    defer_mod.fail = fail
    reactor_mod.reactor = reactor
    
    sys.modules['twisted'] = twisted_mod
    sys.modules['twisted.internet'] = internet_mod
    sys.modules['twisted.internet.reactor'] = reactor_mod
    sys.modules['twisted.internet.protocol'] = protocol_mod
    sys.modules['twisted.internet.defer'] = defer_mod
    sys.modules['twisted.internet.interfaces'] = interfaces_mod
    sys.modules['twisted.internet.task'] = MockTwistedModule()
    sys.modules['twisted.python'] = python_mod
    sys.modules['twisted.python.log'] = log_mod
    sys.modules['twisted.python.threadable'] = MockTwistedModule()
    
    twisted_mod.internet = internet_mod
    twisted_mod.python = python_mod
    internet_mod.reactor = reactor_mod
    internet_mod.protocol = protocol_mod
    internet_mod.defer = defer_mod
    internet_mod.interfaces = interfaces_mod
    internet_mod.task = MockTwistedModule()
    python_mod.log = log_mod
    python_mod.threadable = MockTwistedModule()
    
    print("✓ Created twisted stub module")`;

const zopeSetupMock = `
# Set up Zope mock modules  
try:
    import zope
except ImportError:
    import sys
    import types
    
    # Create zope stub modules
    zope_mod = types.ModuleType('zope')
    interface_mod = types.ModuleType('zope.interface')
    verify_mod = types.ModuleType('zope.interface.verify')
    exceptions_mod = types.ModuleType('zope.interface.exceptions')
    
    # Mock interface classes and functions
    class Interface:
        pass
    
    class InterfaceClass:
        def __init__(self, *args, **kwargs):
            pass
    
    def implementer(*interfaces):
        def decorator(cls):
            return cls
        return decorator
    
    def verifyObject(interface, obj):
        return True
    
    def verifyClass(interface, cls):
        return True
    
    # Mock exception classes
    class BrokenImplementation(Exception):
        pass
    
    class DoesNotImplement(Exception):
        pass
    
    class Invalid(Exception):
        pass
    
    exceptions_mod.BrokenImplementation = BrokenImplementation
    exceptions_mod.DoesNotImplement = DoesNotImplement
    exceptions_mod.Invalid = Invalid
    
    # Assign to modules
    interface_mod.Interface = Interface
    interface_mod.InterfaceClass = InterfaceClass
    interface_mod.implementer = implementer
    verify_mod.verifyObject = verifyObject
    verify_mod.verifyClass = verifyClass
    
    sys.modules['zope'] = zope_mod
    sys.modules['zope.interface'] = interface_mod
    sys.modules['zope.interface.verify'] = verify_mod
    sys.modules['zope.interface.exceptions'] = exceptions_mod
    
    zope_mod.interface = interface_mod
    interface_mod.verify = verify_mod
    interface_mod.exceptions = exceptions_mod
    
    print("✓ Created zope stub module")`;

const rocksdbSetupMock = `
# Set up RocksDB mock module
try:
    import rocksdb
except ImportError:
    import sys
    import types
    
    # Create rocksdb stub module
    rocksdb_mod = types.ModuleType('rocksdb')
    
    # Mock rocksdb classes
    class DB:
        def __init__(self, *args, **kwargs):
            pass
        
        def get(self, key):
            return None
        
        def put(self, key, value):
            pass
        
        def delete(self, key):
            pass
        
        def close(self):
            pass
        
        def __enter__(self):
            return self
        
        def __exit__(self, *args):
            pass
    
    class Options:
        def __init__(self, *args, **kwargs):
            pass
    
    class WriteBatch:
        def __init__(self):
            pass
        
        def put(self, key, value):
            pass
        
        def delete(self, key):
            pass
    
    rocksdb_mod.DB = DB
    rocksdb_mod.Options = Options
    rocksdb_mod.WriteBatch = WriteBatch
    
    sys.modules['rocksdb'] = rocksdb_mod
    
    print("✓ Created rocksdb stub module")`;

const cryptographySetupMock = `
# Set up Cryptography mock modules
try:
    import cryptography
except ImportError:
    import sys
    import types
    
    # Mock backend function
    def default_backend():
        return MockBackend()
    
    class MockBackend:
        pass
    
    # Mock hash classes
    class SHA256:
        pass
    
    class SHA1:
        pass
        
    # Mock EC classes
    class SECP256K1:
        pass
    
    class EllipticCurvePublicKey:
        def public_bytes(self, encoding, format):
            return b'mock_public_key_bytes'
    
    class EllipticCurvePrivateKey:
        def public_key(self):
            return EllipticCurvePublicKey()
        
        def sign(self, data, signature_algorithm):
            return b'mock_signature'
    
    class EllipticCurvePrivateKeyWithSerialization(EllipticCurvePrivateKey):
        pass
            
    # Mock cipher classes
    class AES:
        def __init__(self, key):
            pass
    
    class Cipher:
        def __init__(self, algorithm, mode):
            pass
        
        def encryptor(self):
            return MockCipherContext()
            
        def decryptor(self):
            return MockCipherContext()
    
    class MockCipherContext:
        def update(self, data):
            return data
        
        def finalize(self):
            return b''
    
    # Mock serialization classes
    class Encoding:
        PEM = 'PEM'
        DER = 'DER'
    
    class PrivateFormat:
        PKCS8 = 'PKCS8'
        TraditionalOpenSSL = 'TraditionalOpenSSL'
    
    class PublicFormat:
        SubjectPublicKeyInfo = 'SubjectPublicKeyInfo'
    
    class NoEncryption:
        pass
    
    class KeySerializationEncryption:
        pass
    
    # Mock serialization functions
    def load_der_private_key(data, password=None, backend=None):
        return MockPrivateKey()
    
    def load_pem_private_key(data, password=None, backend=None):
        return MockPrivateKey()
    
    class MockPrivateKey:
        def public_key(self):
            return EllipticCurvePublicKey()
        
        def sign(self, data, signature_algorithm):
            return b'mock_signature'
    
    # Mock cryptography exception classes
    class InvalidSignature(Exception):
        pass
    
    class UnsupportedAlgorithm(Exception):
        pass
    
    class InvalidKey(Exception):
        pass
    
    # Create minimal cryptography stubs
    cryptography = types.ModuleType('cryptography')
    hazmat = types.ModuleType('cryptography.hazmat')
    backends = types.ModuleType('cryptography.hazmat.backends')
    primitives = types.ModuleType('cryptography.hazmat.primitives')
    exceptions_mod = types.ModuleType('cryptography.exceptions')
    
    backends.default_backend = default_backend
    hashes_mod = types.ModuleType('cryptography.hazmat.primitives.hashes')
    asymmetric = types.ModuleType('cryptography.hazmat.primitives.asymmetric')
    ciphers_mod = types.ModuleType('cryptography.hazmat.primitives.ciphers')
    serialization_mod = types.ModuleType('cryptography.hazmat.primitives.serialization')
    ec_mod = types.ModuleType('cryptography.hazmat.primitives.asymmetric.ec')
    
    hashes_mod.SHA256 = SHA256
    hashes_mod.SHA1 = SHA1
    
    ec_mod.SECP256K1 = SECP256K1
    ec_mod.EllipticCurvePrivateKey = EllipticCurvePrivateKey
    ec_mod.EllipticCurvePrivateKeyWithSerialization = EllipticCurvePrivateKeyWithSerialization
    ec_mod.EllipticCurvePublicKey = EllipticCurvePublicKey
    
    ciphers_mod.Cipher = Cipher
    ciphers_mod.algorithms = types.ModuleType('algorithms')
    ciphers_mod.algorithms.AES = AES
    
    serialization_mod.Encoding = Encoding
    serialization_mod.PrivateFormat = PrivateFormat
    serialization_mod.PublicFormat = PublicFormat
    serialization_mod.NoEncryption = NoEncryption
    serialization_mod.KeySerializationEncryption = KeySerializationEncryption
    serialization_mod.load_der_private_key = load_der_private_key
    serialization_mod.load_pem_private_key = load_pem_private_key
    
    exceptions_mod.InvalidSignature = InvalidSignature
    exceptions_mod.UnsupportedAlgorithm = UnsupportedAlgorithm
    exceptions_mod.InvalidKey = InvalidKey
    
    # Register all modules
    sys.modules['cryptography'] = cryptography
    sys.modules['cryptography.hazmat'] = hazmat
    sys.modules['cryptography.hazmat.backends'] = backends
    sys.modules['cryptography.hazmat.primitives'] = primitives
    sys.modules['cryptography.hazmat.primitives.hashes'] = hashes_mod
    sys.modules['cryptography.hazmat.primitives.asymmetric'] = asymmetric
    sys.modules['cryptography.hazmat.primitives.asymmetric.ec'] = ec_mod
    sys.modules['cryptography.hazmat.primitives.ciphers'] = ciphers_mod
    sys.modules['cryptography.hazmat.primitives.serialization'] = serialization_mod
    sys.modules['cryptography.exceptions'] = exceptions_mod
    
    # Build hierarchy
    cryptography.hazmat = hazmat
    hazmat.backends = backends
    hazmat.primitives = primitives
    primitives.hashes = hashes_mod
    primitives.asymmetric = asymmetric
    primitives.ciphers = ciphers_mod
    primitives.serialization = serialization_mod
    asymmetric.ec = ec_mod
    cryptography.exceptions = exceptions_mod
    
    print("✓ Created cryptography stub module")`;

const pycoinSetupMock = `
# Set up Pycoin mock module
try:
    import pycoin
except ImportError:
    import sys
    import types
    
    # Create pycoin stub modules
    pycoin_mod = types.ModuleType('pycoin')
    key_mod = types.ModuleType('pycoin.key')
    key_key_mod = types.ModuleType('pycoin.key.Key')
    contrib_mod = types.ModuleType('pycoin.contrib')
    ripemd160_mod = types.ModuleType('pycoin.contrib.ripemd160')
    
    class Key:
        def __init__(self, *args, **kwargs):
            pass
        
        def sec(self):
            return b'mock_pubkey_bytes'
        
        def sign(self, hash_value):
            return b'mock_signature'
    
    # Mock ripemd160 function
    def ripemd160(data):
        return b'mock_ripemd160_hash'
    
    key_key_mod.Key = Key
    ripemd160_mod.ripemd160 = ripemd160
    
    sys.modules['pycoin'] = pycoin_mod
    sys.modules['pycoin.key'] = key_mod
    sys.modules['pycoin.key.Key'] = key_key_mod
    sys.modules['pycoin.contrib'] = contrib_mod
    sys.modules['pycoin.contrib.ripemd160'] = ripemd160_mod
    
    pycoin_mod.key = key_mod
    pycoin_mod.contrib = contrib_mod
    contrib_mod.ripemd160 = ripemd160_mod
    key_mod.Key = key_key_mod
    
    print("✓ Created pycoin stub module")`;

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