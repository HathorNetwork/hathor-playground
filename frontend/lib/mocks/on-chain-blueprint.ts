export const onChainBlueprintMock = `# Stub module for browser compatibility
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
