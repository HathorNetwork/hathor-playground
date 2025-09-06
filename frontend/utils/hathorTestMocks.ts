/**
 * Mock implementations of Hathor test framework for browser-based testing
 * These mocks provide the essential functionality needed for nano contract testing
 * without requiring the full Hathor node infrastructure
 */

import { getHathorHelpers } from './hathorHelpers';

export const HATHOR_TEST_MOCKS = `
# Mock Hathor test framework for browser testing
import os
import time
from typing import Optional, Any
from unittest import TestCase
from unittest.mock import MagicMock

from hathor.nanocontracts.types import TokenUid, Address, ContractId, VertexId, BlueprintId
from hathor.nanocontracts.context import Context

# Import existing mocks from the proper modules
from hathor.nanocontracts.rng import NanoRNG
from hathor.reactor.reactor import get_global_reactor
from hathor.transaction.storage.transaction_storage import MockTransactionStorage


# Mock manager and related components
class MockManager:
    def __init__(self, tx_storage):
        self.tx_storage = tx_storage
        self.rng = NanoRNG(b'\\x00' * 32)
        self.wallet = None
        self.reactor = get_global_reactor()


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


class BlueprintTestCase(TestCase):
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
            self.now = int(self.reactor.seconds())
            self._token_index = 1
            
            # Create HTR token UID - use a simple approach for testing
            self.htr_token_uid = TokenUid(b'\\x00' * 32)  # Simple zero-filled token UID

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

    # TODO unify all methods to generate random IDs and addresses
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

    def get_genesis_tx(self):
        """Return the genesis transaction."""
        return self.manager.tx_storage.get_genesis(self._settings.GENESIS_TX1_HASH)

    def create_context(self, actions=None, vertex=None, caller_id=None, timestamp=None) -> Context:
        """Create a real Context instance using the existing _create_context function."""
        # Convert caller_id to hex string if it's an Address object
        caller_address_hex = None
        if caller_id is not None:
            if hasattr(caller_id, 'hex'):
                caller_address_hex = caller_id.hex()
            elif isinstance(caller_id, bytes):
                caller_address_hex = caller_id.hex()
            else:
                caller_address_hex = str(caller_id)
        
        # Use the existing _create_context function from pyodide setup
        return _create_context(
            caller_address_hex=caller_address_hex,
            actions=actions,
            vertex=vertex,
            timestamp=timestamp
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
`;

export const getHathorTestMocks = () => {
  // Combine the helper functions with the test mocks
  return getHathorHelpers() + '\n\n' + HATHOR_TEST_MOCKS;
};
