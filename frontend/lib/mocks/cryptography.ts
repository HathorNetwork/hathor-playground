export const cryptographySetupMock = `
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
