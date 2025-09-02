export const pycoinSetupMock = `
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
