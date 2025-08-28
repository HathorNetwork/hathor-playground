export const reactorMock = `# Stub module for browser compatibility
import time
from structlog import get_logger

logger = get_logger()

class MockReactorProtocol:
    def __init__(self):
        pass
    
    def seconds(self):
        """Return current timestamp - this is what NCLogger actually uses"""
        return time.time()
    
    def callLater(self, delay, func, *args, **kwargs):
        # Not actually used by runner, but included for completeness
        return None
    
    def stop(self):
        # Not actually used by runner, but included for completeness  
        pass

_reactor = None

def get_global_reactor():
    global _reactor
    if _reactor is None:
        _reactor = MockReactorProtocol()
    return _reactor

def initialize_global_reactor(use_asyncio_reactor=False):
    global _reactor
    if _reactor is None:
        _reactor = MockReactorProtocol()
    return _reactor`;


