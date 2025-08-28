export const settingsMock = `# Stub module for browser compatibility with essential settings
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
default_settings = _settings

# Explicit module exports for direct imports
__all__ = [
    'HATHOR_TOKEN_UID',
    'NANO_CONTRACTS_ENABLED', 
    'MIN_BLOCK_WEIGHT',
    'MAX_BLOCK_WEIGHT',
    'HathorSettings',
    'get_global_settings',
    'default_settings'
]`;
