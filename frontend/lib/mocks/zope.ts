export const zopeSetupMock = `
# Set up Zope mock modules  
try:
    import zope
except ImportError:
    import sys
    import types
    
    # Create zope stub modules
    zope_mod = types.ModuleType('zope')
    interface_mod = types.ModuleType('zope.interface')
    verify_mod = types.ModuleType('zope.interface.verify')
    exceptions_mod = types.ModuleType('zope.interface.exceptions')
    
    # Mock interface classes and functions
    class Interface:
        pass
    
    class InterfaceClass:
        def __init__(self, *args, **kwargs):
            pass
    
    def implementer(*interfaces):
        def decorator(cls):
            return cls
        return decorator
    
    def verifyObject(interface, obj):
        return True
    
    def verifyClass(interface, cls):
        return True
    
    # Mock exception classes
    class BrokenImplementation(Exception):
        pass
    
    class DoesNotImplement(Exception):
        pass
    
    class Invalid(Exception):
        pass
    
    exceptions_mod.BrokenImplementation = BrokenImplementation
    exceptions_mod.DoesNotImplement = DoesNotImplement
    exceptions_mod.Invalid = Invalid
    
    # Assign to modules
    interface_mod.Interface = Interface
    interface_mod.InterfaceClass = InterfaceClass
    interface_mod.implementer = implementer
    verify_mod.verifyObject = verifyObject
    verify_mod.verifyClass = verifyClass
    
    sys.modules['zope'] = zope_mod
    sys.modules['zope.interface'] = interface_mod
    sys.modules['zope.interface.verify'] = verify_mod
    sys.modules['zope.interface.exceptions'] = exceptions_mod
    
    zope_mod.interface = interface_mod
    interface_mod.verify = verify_mod
    interface_mod.exceptions = exceptions_mod
    
    print("✓ Created zope stub module")`;
