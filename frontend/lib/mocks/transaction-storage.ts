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
