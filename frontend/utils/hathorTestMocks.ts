/**
 * Mock implementations of Hathor test framework for browser-based testing
 * These mocks provide the essential functionality needed for nano contract testing
 * without requiring the full Hathor node infrastructure
 */

export const HATHOR_TEST_MOCKS = `
# Mock Hathor test framework for browser testing
import os
import time
from typing import Optional, Any
from unittest.mock import MagicMock

# Import the real Hathor types instead of using mocks
from hathor.nanocontracts.types import TokenUid, Address, ContractId, VertexId
from hathor.nanocontracts.context import Context

# Import existing mocks from the proper modules
from hathor.nanocontracts.rng import NanoRNG
from hathor.reactor.reactor import get_global_reactor
from hathor.transaction.storage.transaction_storage import MockTransactionStorage

# Helper function for generating random bytes (compatible with older Python)
def _gen_random_bytes(n):
    try:
        import secrets
        return secrets.randbytes(n)
    except (ImportError, AttributeError):
        return os.urandom(n)

# Mock the tests module and unittest
class MockTestCase:
    def setUp(self):
        pass
    
    def tearDown(self):
        pass

# Create a BlueprintId alias (it's the same as ContractId in Hathor)
BlueprintId = ContractId

# Note: We now use the real Context from hathor.nanocontracts.context
# No need for MockContext anymore

class MockVertex:
    def __init__(self):
        self.hash = VertexId(_gen_random_bytes(32))
        self.timestamp = int(time.time())

class MockBlockData:
    def __init__(self):
        self.hash = VertexId(_gen_random_bytes(32))
        self.timestamp = int(time.time())
        self.height = 0

class MockTransaction:
    def __init__(self):
        self.hash = VertexId(_gen_random_bytes(32))
        self.timestamp = int(time.time())

# Mock nano contract catalog
class MockNanoContractCatalog:
    def __init__(self):
        self.blueprints = {}

# Mock manager and related components
class MockManager:
    def __init__(self, tx_storage):
        self.tx_storage = tx_storage
        self.rng = NanoRNG(b'\\x00' * 32)  # Use the real mock from lib/mocks
        self.wallet = MockWallet()
        self.reactor = get_global_reactor()  # Use the real mock from lib/mocks

class MockWallet:
    pass

# Mock storage classes
class MockStorage:
    def __init__(self):
        pass
    
    def lock(self):
        pass
    
    def unlock(self):
        pass

# Use the real Runner that's already set up in pyodide-runner.ts
def get_real_runner():
    """Get the real Runner instance that was created during pyodide setup"""
    # The real nc_runner was created in setupPythonEnvironment() 
    # First try to get from builtins (global scope)
    import builtins
    if hasattr(builtins, 'nc_runner') and builtins.nc_runner is not None:
        print("✓ Using global nc_runner from builtins")
        return builtins.nc_runner
        
    # Then try globals()
    if 'nc_runner' in globals() and globals()['nc_runner'] is not None:
        print("✓ Using global nc_runner from globals")
        return globals()['nc_runner']
    
    # Try direct access (might work in some contexts)
    try:
        if nc_runner is not None:
            print("✓ Using direct nc_runner access")
            return nc_runner
    except NameError:
        pass
            
    # If we get here, no global runner is available
    raise NameError("Global nc_runner not available in any scope")

# Main BlueprintTestCase mock
# Import the real unittest.TestCase for proper assertion methods
try:
    import unittest
    TestCaseBase = unittest.TestCase
    print("✓ Using real unittest.TestCase as base")
except ImportError:
    # Fallback to our MockTestCase if unittest isn't available
    TestCaseBase = MockTestCase
    print("⚠️ Using MockTestCase as fallback")

class BlueprintTestCase(TestCaseBase):
    def setUp(self):
        super().setUp()
        
        # Set up basic components first
        try:
            self.runner = self.build_runner()
            self.manager = self.build_manager(self.runner.tx_storage)
            self.rng = self.manager.rng
            self.wallet = self.manager.wallet
            self.reactor = self.manager.reactor
            self.nc_catalog = self.manager.tx_storage.nc_catalog
            
            # Create HTR token UID - use a simple approach for testing
            self.htr_token_uid = TokenUid(b'\\x00' * 32)  # Simple zero-filled token UID
            
            # Set up runner - handle potential errors gracefully
            #try:
            #    self.runner = self.build_runner()
            #except Exception as e:
            #    print(f"Warning: Failed to create real runner, using fallback: {e}")
            #    # Create a simple fallback runner-like object
            #    self.runner = MagicMock()
            #    self.runner.get_readonly_contract = MagicMock(return_value=MagicMock())
            #    self.runner.get_readwrite_contract = MagicMock(return_value=MagicMock())
            
            self.now = int(self.reactor.seconds())
            
            self._token_index = 1
            from hathor.conf import HathorSettings
            self._settings = HathorSettings()
            
        except Exception as e:
            print(f"setUp error: {e}")
            raise e

    def build_manager(self, tx_storage):
        """Create a mock HathorManager instance."""
        return MockManager(tx_storage)

    def build_runner(self):
        """Get the real Runner instance."""
        return get_real_runner()

    def gen_random_token_uid(self) -> TokenUid:
        """Generate a random token UID (32 bytes)."""
        try:
            token = self._token_index.to_bytes(32, byteorder='big', signed=False)
            self._token_index += 1
            return TokenUid(token)
        except Exception as e:
            print(f"Error creating TokenUid: {e}")
            # Fallback to simple random bytes
            return TokenUid(_gen_random_bytes(32))

    def gen_random_address(self) -> Address:
        """Generate a random wallet address."""
        try:
            return Address(_gen_random_bytes(25))
        except Exception as e:
            print(f"Error creating Address: {e}")
            # Fallback to simple bytes
            return Address(b'\\x00' * 25)
    
    def gen_random_contract_id(self) -> ContractId:
        """Generate a random contract id."""
        try:
            return ContractId(_gen_random_bytes(32))
        except Exception as e:
            print(f"Error creating ContractId: {e}")
            # Fallback to simple bytes
            return ContractId(b'\\x00' * 32)

    def gen_random_blueprint_id(self) -> ContractId:
        """Generate a random blueprint id."""
        try:
            return ContractId(_gen_random_bytes(32))
        except Exception as e:
            print(f"Error creating BlueprintId: {e}")
            # Fallback to simple bytes
            return ContractId(b'\\x00' * 32)

    def get_genesis_tx(self) -> MockTransaction:
        """Return a mock genesis transaction."""
        return self.manager.tx_storage.get_genesis(self._settings.GENESIS_TX1_HASH)

    def create_context(self, actions=None, vertex=None, caller_id=None, timestamp=None) -> Context:
        """Create a real Context instance with optional values or defaults."""
        from hathor.nanocontracts.vertex_data import BlockData, VertexData
        
        # Handle caller_id
        if caller_id is None:
            caller_id = self.gen_random_address()
        
        # Handle vertex_data - use provided vertex or create minimal one
        if vertex:
            vertex_data = VertexData.create_from_vertex(vertex)
        else:
            # Create minimal vertex for VertexData.create_from_vertex()
            from hathor.transaction import Transaction
            
            # Create a minimal transaction as vertex
            minimal_vertex = Transaction(
                hash=b'\\x00' * 32,
                timestamp=timestamp or int(time.time()),
                version=1,
                weight=1.0,
                inputs=[],
                outputs=[],
                parents=[]
            )
            vertex_data = VertexData.create_from_vertex(minimal_vertex)
        
        # Create block_data following the unittest pattern
        block_data = BlockData(
            hash=VertexId(b'\\x00' * 32),  # Empty hash like in unittest
            timestamp=timestamp or int(time.time()),
            height=0
        )
        
        return Context(
            caller_id=caller_id,
            vertex_data=vertex_data,
            block_data=block_data,
            actions=Context.__group_actions__(actions or ()),  # Group provided or empty actions
        )

    def get_readonly_contract(self, contract_id: ContractId):
        """Returns a read-only instance of a given contract."""
        # Use the real runner to get a readonly contract instance
        return self.runner.get_readonly_contract(contract_id)

    def get_readwrite_contract(self, contract_id: ContractId):
        """Returns a read-write instance of a given contract."""
        # Use the real runner to get a readwrite contract instance
        return self.runner.get_readwrite_contract(contract_id)
    
    def _register_blueprint_class(self, blueprint_class, blueprint_id=None):
        """Register a blueprint class with an optional id."""
        if blueprint_id is None:
            blueprint_id = self.gen_random_blueprint_id()
        
        # Register with both our mock catalog and the real runner's transaction storage
        self.nc_catalog.blueprints[blueprint_id] = blueprint_class
        
        # Also register with the real runner's tx_storage catalog if available
        try:
            self.runner.tx_storage.nc_catalog.blueprints[blueprint_id] = blueprint_class
        except (AttributeError, NameError):
            pass  # Fallback gracefully if real runner not available
        
        return blueprint_id

# Make essential classes available globally for tests
# We now use the real Hathor types instead of mocks
# Context = MockContext (we still use MockContext since the real Context needs more complex setup)

# Also make them available as part of types module mock (using real types)
class types:
    TokenUid = TokenUid
    Address = Address
    ContractId = ContractId
    BlueprintId = ContractId
    VertexId = VertexId

# Mock hathor modules structure (using real types)
class hathor:
    class types:
        TokenUid = TokenUid
        Address = Address
        ContractId = ContractId
        BlueprintId = ContractId
        VertexId = VertexId
    
    class nanocontracts:
        Context = Context  # Now use real Context
        
        class types:
            TokenUid = TokenUid
            Address = Address
            ContractId = ContractId
            BlueprintId = ContractId
            VertexId = VertexId

# Mock tests module - use real unittest if available
try:
    import unittest as real_unittest
    
    class tests:
        class unittest:
            TestCase = real_unittest.TestCase
    
    # Make unittest available at top level too
    class unittest:
        TestCase = real_unittest.TestCase
        
    print("✓ Exporting real unittest.TestCase globally")
    
except ImportError:
    # Fallback to mock
    class tests:
        class unittest:
            TestCase = MockTestCase

    class unittest:
        TestCase = MockTestCase
        
    print("⚠️ Using MockTestCase for global exports")
`;

export const getHathorTestMocks = () => HATHOR_TEST_MOCKS;
