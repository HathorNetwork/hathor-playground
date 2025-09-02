export const rocksdbSetupMock = `
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