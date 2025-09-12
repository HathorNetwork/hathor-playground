export const transactionStorageMock = `# Stub module for browser compatibility
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
        return None

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

    def __init__(self, blueprints: Optional[Dict[bytes, Any]] = None, settings=None):
        self._blueprints = blueprints or {}
        self._transactions = {}  # Store OnChainBlueprint transactions

        # Store settings for genesis transaction construction
        if settings is None:
            try:
                from hathor.conf import HathorSettings
                self._settings = HathorSettings()
            except:
                self._settings = None
        else:
            self._settings = settings

        # Add nc_catalog for compatibility with BlueprintTestCase
        from unittest.mock import MagicMock
        self.nc_catalog = MagicMock()
        self.nc_catalog.blueprints = {}
        # TODO can we merge _blueprints and nc_catalog?

    def get_transaction(self, tx_id):
        """Get transaction by ID - returns OnChainBlueprint instance if exists."""
        if isinstance(tx_id, str):
            tx_id = bytes.fromhex(tx_id)
        elif isinstance(tx_id, bytes):
            pass
        else:
            # Handle other ID types
            tx_id = bytes(tx_id)

        return self._transactions.get(tx_id)

    def save_transaction(self, tx):
        """Save transaction - stores OnChainBlueprint transactions."""
        self._transactions[tx.hash] = tx

    def create_blueprint_transaction(self, code_string: str, blueprint_id_bytes: bytes, settings):
        """Create an OnChainBlueprint transaction from code string."""
        from hathor.nanocontracts.on_chain_blueprint import OnChainBlueprint, Code

        # Create Code instance from Python code string
        code = Code.from_python_code(code_string, settings)

        # Create OnChainBlueprint transaction
        blueprint_tx = OnChainBlueprint(
            code=code,
            hash=blueprint_id_bytes,
            storage=self
        )

        return blueprint_tx

    def get_blueprint_class(self, blueprint_id: bytes):
        """Get blueprint class by ID - only method needed by nano contracts runner."""
        if blueprint_id in self.nc_catalog.blueprints:
            return self.nc_catalog.blueprints[blueprint_id]
        blueprint = self._transactions[blueprint_id]
        return blueprint.get_blueprint_class()

    def add_blueprint(self, blueprint_id: bytes, blueprint_class):
        """Add a blueprint to the mock storage."""
        self._blueprints[blueprint_id] = blueprint_class

    def has_blueprint(self, blueprint_id: bytes) -> bool:
        """Check if blueprint exists in storage."""
        return blueprint_id in self._blueprints

    def list_blueprints(self):
        """List all available blueprint IDs."""
        return list(self._blueprints.keys())

    def get_genesis(self, hash_id):
        """Get genesis transaction - constructs proper genesis tx from settings."""
        try:
            from hathor.transaction import Transaction

            # Use stored settings or try to get from global context
            settings = self._settings
            if settings is None:
                try:
                    from hathor.conf import HathorSettings
                    settings = globals().get('settings') or HathorSettings()
                except:
                    from hathor.conf import HathorSettings
                    settings = HathorSettings()

            # Check which genesis transaction this hash corresponds to
            if hasattr(settings, 'GENESIS_TX1_HASH') and hash_id == settings.GENESIS_TX1_HASH:
                # Construct Genesis TX1
                tx1 = Transaction(
                    settings=settings,
                    storage=self,
                    nonce=settings.GENESIS_TX1_NONCE,
                    timestamp=settings.GENESIS_TX1_TIMESTAMP,
                    weight=settings.MIN_TX_WEIGHT,
                )
                tx1.update_hash()
                assert tx1.hash == settings.GENESIS_TX1_HASH
                return tx1

            elif hasattr(settings, 'GENESIS_TX2_HASH') and hash_id == settings.GENESIS_TX2_HASH:
                # Construct Genesis TX2 if it exists
                tx2 = Transaction(
                    settings=settings,
                    storage=self,
                    nonce=settings.GENESIS_TX2_NONCE,
                    timestamp=settings.GENESIS_TX2_TIMESTAMP,
                    weight=settings.MIN_TX_WEIGHT,
                )
                tx2.update_hash()
                assert tx2.hash == settings.GENESIS_TX2_HASH
                return tx2

            else:
                # Fallback: create a generic transaction with the requested hash
                print(f"Warning: Creating fallback genesis transaction for hash {hash_id}")
                tx = Transaction(
                    settings=settings,
                    storage=self,
                    nonce=0,
                    timestamp=settings.GENESIS_TX1_TIMESTAMP if hasattr(settings, 'GENESIS_TX1_TIMESTAMP') else 0,
                    weight=settings.MIN_TX_WEIGHT if hasattr(settings, 'MIN_TX_WEIGHT') else 1,
                )
                # Override the hash with the requested one (for testing)
                tx._hash = hash_id
                return tx

        except Exception as e:
            print(f"Failed to create genesis transaction: {e}")
            # Final fallback to mock
            from unittest.mock import MagicMock
            mock_tx = MagicMock()
            mock_tx.hash = hash_id
            mock_tx.timestamp = int(__import__('time').time())
            return mock_tx

# For backward compatibility, create a default instance
default_storage = MockTransactionStorage()`;
