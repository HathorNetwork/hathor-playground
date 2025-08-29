export const onChainBlueprintMock = `# Stub module for browser compatibility
from hathor.transaction import Transaction
from enum import IntEnum

# Constants from the original module
ON_CHAIN_BLUEPRINT_VERSION = 1
BLUEPRINT_CLASS_NAME = '__blueprint__'
PYTHON_CODE_COMPAT_VERSION = (3, 11)
MAX_COMPRESSION_LEVEL = 9

class CodeKind(IntEnum):
    PYTHON_ZLIB = 1
    
    def __bytes__(self):
        return self.value.to_bytes(1, 'big')

class Code:
    def __init__(self, kind, data, settings):
        self.kind = kind
        self.data = data
        self.text = data.decode('utf-8') if isinstance(data, bytes) else str(data)
    
    @classmethod
    def from_python_code(cls, text_code, settings, compress_level=MAX_COMPRESSION_LEVEL):
        # Mock implementation - just store the text as-is
        return cls(CodeKind.PYTHON_ZLIB, text_code.encode('utf-8'), settings)
    
    def __bytes__(self):
        return bytes([self.kind.value]) + self.data
    
    def to_json(self):
        import base64
        return {
            'kind': self.kind.value,
            'content': base64.b64encode(self.data).decode('ascii') if isinstance(self.data, bytes) else self.data,
        }

class OnChainBlueprint(Transaction):
    def __init__(self, code=None, hash=None, storage=None, *args, **kwargs):
        # Mock initialization without calling parent
        self.code = code
        self.hash = hash
        self.storage = storage
        self.nc_pubkey = b''
        self.nc_signature = b''
    
    def blueprint_id(self):
        return self.hash if self.hash else b'mock_blueprint_id'
    
    def get_blueprint_class(self):
        from hathor.nanocontracts.blueprint import Blueprint
        return Blueprint
    
    def get_method(self, method_name):
        class MockMethod:
            def __init__(self, name):
                self.name = name
        return MockMethod(method_name)`;
