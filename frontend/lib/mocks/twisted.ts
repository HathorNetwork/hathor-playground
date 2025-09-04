export const twistedSetupMock = `
# Set up Twisted mock modules
try:
    import twisted
except ImportError:
    import sys
    import types

    # Create comprehensive mock classes that handle any method call
    class MockBase:
        def __init__(self, *args, **kwargs):
            pass
        
        def __getattr__(self, name):
            # Return a mock method for any attribute access
            def mock_method(*args, **kwargs):
                return MockBase()
            return mock_method
        
        def __call__(self, *args, **kwargs):
            return MockBase()
        
        def __iter__(self):
            # Return an empty iterator to handle iteration
            return iter([])
        
        def __len__(self):
            return 0
        
        def __bool__(self):
            return True
        
        def __str__(self):
            return "MockBase"
        
        def __repr__(self):
            return "MockBase()"
        
        def __mro_entries__(self, bases):
            # Return tuple for method resolution order
            return (MockBase,)
    
    class Protocol(MockBase):
        pass
    
    class Factory(MockBase):
        pass
    
    class Deferred(MockBase):
        def addCallback(self, callback):
            return self
        
        def addErrback(self, errback):
            return self
    
    def succeed(result):
        return Deferred()
    
    def fail(failure):
        return Deferred()
    
    # Create comprehensive mock modules
    class MockTwistedModule:
        def __getattr__(self, name):
            return MockBase()
    
    # Mock reactor with comprehensive method coverage
    class MockReactor(MockBase):
        def callLater(self, delay, func, *args, **kwargs):
            return MockBase()
        
        def connectTCP(self, host, port, factory):
            return MockBase()
        
        def listenTCP(self, port, factory):
            return MockBase()
        
        def run(self):
            pass
        
        def stop(self):
            pass
    
    reactor = MockReactor()
    
    # Create twisted stub modules using dynamic mocks
    twisted_mod = MockTwistedModule()
    internet_mod = MockTwistedModule()
    reactor_mod = MockTwistedModule()
    protocol_mod = MockTwistedModule()
    defer_mod = MockTwistedModule()
    python_mod = MockTwistedModule()
    log_mod = MockTwistedModule()
    
    # Create a comprehensive mock interface module that returns mock classes for any attribute
    class MockInterface:
        pass
    
    class MockInterfacesModule:
        def __getattr__(self, name):
            # Return a mock interface class for any requested interface
            return type(name, (MockInterface,), {})
    
    # Replace the interfaces module with our dynamic mock
    interfaces_mod = MockInterfacesModule()
    
    # Add common interfaces explicitly
    interfaces_mod.IProtocol = MockInterface
    interfaces_mod.IFactory = MockInterface  
    interfaces_mod.IReactorCore = MockInterface
    interfaces_mod.IDelayedCall = MockInterface
    
    # Assign specific classes/functions to modules
    protocol_mod.Protocol = Protocol
    protocol_mod.Factory = Factory
    defer_mod.Deferred = Deferred
    defer_mod.succeed = succeed
    defer_mod.fail = fail
    reactor_mod.reactor = reactor
    
    sys.modules['twisted'] = twisted_mod
    sys.modules['twisted.internet'] = internet_mod
    sys.modules['twisted.internet.reactor'] = reactor_mod
    sys.modules['twisted.internet.protocol'] = protocol_mod
    sys.modules['twisted.internet.defer'] = defer_mod
    sys.modules['twisted.internet.interfaces'] = interfaces_mod
    sys.modules['twisted.internet.task'] = MockTwistedModule()
    sys.modules['twisted.python'] = python_mod
    sys.modules['twisted.python.log'] = log_mod
    sys.modules['twisted.python.threadable'] = MockTwistedModule()
    
    # Add twisted.web modules for hathor.api_util and BlueprintInfoResource
    web_mod = MockTwistedModule()
    http_mod = MockTwistedModule()
    
    # Create a mock Request class for twisted.web.http
    class MockRequest(MockBase):
        def setHeader(self, name, value):
            pass
        
        def setResponseCode(self, code):
            pass
        
        def getHeader(self, name):
            return b''
        
        args = {}
    
    http_mod.Request = MockRequest
    
    sys.modules['twisted.web'] = web_mod
    sys.modules['twisted.web.http'] = http_mod
    sys.modules['twisted.web.resource'] = MockTwistedModule()
    
    # Add hathorlib module mocks for BlueprintInfoResource
    hathorlib_mod = MockTwistedModule()
    hathorlib_base_transaction_mod = MockTwistedModule()
    hathorlib_base_index_mod = MockTwistedModule() 
    hathorlib_pubsub_mod = MockTwistedModule()
    
    sys.modules['hathorlib'] = hathorlib_mod
    sys.modules['hathorlib.base_transaction'] = hathorlib_base_transaction_mod
    sys.modules['hathorlib.base.index'] = hathorlib_base_index_mod
    sys.modules['hathorlib.pubsub'] = hathorlib_pubsub_mod
    
    twisted_mod.internet = internet_mod
    twisted_mod.python = python_mod
    twisted_mod.web = web_mod
    internet_mod.reactor = reactor_mod
    internet_mod.protocol = protocol_mod
    internet_mod.defer = defer_mod
    internet_mod.interfaces = interfaces_mod
    internet_mod.task = MockTwistedModule()
    python_mod.log = log_mod
    python_mod.threadable = MockTwistedModule()
    web_mod.http = http_mod
    web_mod.resource = MockTwistedModule()
    
    print("✓ Created twisted stub module with web support")`;
