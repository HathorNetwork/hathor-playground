# Frontend Architecture: Pyodide-Based Browser Execution

This document explains how the Nano Contracts IDE frontend uses **Pyodide** to execute Hathor nano contracts directly in the browser, providing a secure sandbox environment without server-side Python execution.

## What is Pyodide?

**Pyodide** is a Python distribution for the browser and Node.js based on WebAssembly (WASM). It allows running Python code directly in web browsers with access to the full Python scientific stack.

### Key Benefits:
- ✅ **Security**: No server-side code execution - everything runs in the browser sandbox
- ✅ **Performance**: Near-native Python execution speed via WebAssembly  
- ✅ **Offline**: Works without internet connection after initial load
- ✅ **Real Libraries**: Can use actual Python libraries, not just mocks

## Architecture Overview

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   React UI      │    │   Pyodide        │    │   Hathor SDK    │
│                 │    │   Runtime        │    │   (Real)        │
├─────────────────┤    ├──────────────────┤    ├─────────────────┤
│ • File Editor   │───▶│ • Python VM      │───▶│ • Blueprint     │
│ • Method UI     │    │ • WASM Engine    │    │ • Context       │
│ • Console       │    │ • Package Mgmt   │    │ • Types         │
│ • Result View   │    │ • Module System  │    │ • Validators    │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

## How Contract Execution Works

### 1. **Initialization Phase**
When the frontend loads, `PyodideLoader` component:

```typescript
// Initialize Pyodide runtime
const pyodide = await loadPyodide({
  indexURL: "https://cdn.jsdelivr.net/pyodide/",
});

// Install Python dependencies
await pyodide.loadPackage(["pydantic==1.10.14", "structlog", "typing_extensions"]);
```

### 2. **Hathor SDK Loading**
The `pyodide-runner.ts` loads **488 real Hathor modules** from GitHub:

```typescript
// Load actual Hathor modules from GitHub raw content
for (const modulePath of HATHOR_MODULES) {
  const url = `https://raw.githubusercontent.com/HathorNetwork/hathor-core/master/${modulePath}`;
  const response = await fetch(url);
  const content = await response.text();
  
  // Install module in Pyodide's file system
  pyodide.FS.writeFile(`/home/pyodide/${modulePath}`, content);
}
```

### 3. **Dependency Stubbing**
For browser-incompatible dependencies, we create functional stubs:

```python
# Example: twisted reactor stub
class MockReactorProtocol:
    def __init__(self):
        self.running = False
    
    def run(self): 
        self.running = True
        
    def stop(self):
        self.running = False
```

### 4. **Contract Compilation**
When you click "Compile":

```python
# Execute user's contract code in Pyodide
exec(user_contract_code, globals())

# Extract the Blueprint class
blueprint_class = globals()['__blueprint__']

# Validate it's a proper Blueprint
if not issubclass(blueprint_class, Blueprint):
    raise ValueError("Not a valid Blueprint")
```

### 5. **Method Execution**
When you execute a contract method:

```python
# Create contract instance
contract_instance = blueprint_class(mock_environment)

# Create execution context
context = Context(
    actions=[],
    vertex=VertexData(...),  # Mock vertex data
    caller_id=Address(caller_bytes),
    timestamp=int(time.time())
)

# Execute the method
if is_public_method(method):
    result = method(context, *args)
elif is_view_method(method):
    result = method(*args)
```

## Key Components

### PyodideRunner (`frontend/lib/pyodide-runner.ts`)
- **Purpose**: Main interface between React and Pyodide
- **Responsibilities**:
  - Initialize Pyodide runtime
  - Load Hathor SDK modules  
  - Compile and execute contracts
  - Handle type conversions
  - Manage contract storage

### PyodideLoader (`frontend/components/PyodideLoader.tsx`)
- **Purpose**: React component that loads Pyodide asynchronously
- **Features**:
  - Shows loading progress
  - Handles initialization errors
  - Provides ready state to parent components

### MethodExecutor (`frontend/components/Execution/MethodExecutor.tsx`)
- **Purpose**: UI for executing contract methods
- **Features**:
  - Auto-detects method signatures
  - Provides parameter input forms
  - Handles different parameter types
  - Shows execution results

## Mock Environment

Since contracts expect certain blockchain infrastructure, we provide mocks:

### MockNCContractStorage
```python
class MockNCContractStorage:
    def __init__(self):
        self._storage = {}
    
    def put_obj(self, key, nc_type, obj):
        self._storage[key] = obj
        
    def get_obj(self, key, nc_type, *, default=None):
        return self._storage.get(key, default)
```

### Context Creation
```python
def _create_context(caller_address_hex):
    caller_hash = bytes.fromhex(caller_address_hex[:50])  # 25-byte address
    vertex_data = VertexData(
        hash=caller_hash,
        nonce=0, 
        signal_bits=0,
        weight=1.0,
        inputs=(), outputs=(), tokens=(), parents=(),
        block=BlockData(hash=VertexId(b''), timestamp=0, height=0),
        headers=()
    )
    
    return Context(
        actions=[],
        vertex=vertex_data,
        caller_id=Address(caller_hash),
        timestamp=int(time.time())
    )
```

## Security Model

### Browser Sandbox
- All Python code runs in the browser's WebAssembly sandbox
- No access to file system, network (except allowed origins), or system APIs
- Memory-safe execution environment

### Isolated Execution
- Each contract execution runs in isolation
- No shared state between different contract compilations  
- Storage is ephemeral and session-scoped

### No Server Trust
- Zero server-side code execution
- All validation and execution happens client-side
- Backend only stores files and metadata

## Performance Considerations

### Initial Load
- **Pyodide**: ~8MB download (cached after first load)
- **Hathor SDK**: ~2MB of Python modules (cached)
- **Dependencies**: ~3MB for pydantic, structlog etc.

### Runtime Performance  
- **Compilation**: ~100-500ms for typical contracts
- **Execution**: ~10-50ms for simple methods
- **Memory**: ~50MB typical usage, ~200MB with large contracts

### Optimizations
- Aggressive caching of all components
- Lazy loading of non-essential modules
- Hardcoded module list to avoid GitHub API calls
- Efficient stub implementations

## Debugging and Development

### Console Output
All Python prints and errors are captured and displayed in the IDE console:

```python
print("Debug: Contract initialized")  # Shows in console
raise ValueError("Invalid amount")     # Shows as error with traceback
```

### Error Handling
The system provides detailed error information:
- **Compilation Errors**: Syntax errors, import failures, type issues
- **Runtime Errors**: Method execution failures with full Python tracebacks
- **Validation Errors**: Contract structure problems

### Development Tools
- React DevTools for component debugging
- Browser DevTools for JavaScript debugging  
- Python error messages with line numbers
- Network tab shows module loading progress

## File Structure

```
frontend/
├── lib/
│   ├── pyodide-runner.ts      # Main Pyodide interface
│   └── hathor-modules.ts      # List of 488 Hathor modules
├── components/
│   ├── PyodideLoader.tsx      # Pyodide initialization component  
│   └── Execution/
│       └── MethodExecutor.tsx # Contract method execution UI
└── utils/
    └── contractParser.ts      # Parse method signatures from code
```

## Limitations

### Current Limitations
- No persistent blockchain state
- Mock storage (not real database)
- Limited syscall implementations
- No real token transfers or network effects

### Future Enhancements
- Testnet integration for real blockchain testing
- Persistent contract storage 
- Advanced debugging tools
- Performance profiling

## Conclusion

The Pyodide-based architecture provides a powerful, secure, and user-friendly environment for developing and testing Hathor nano contracts. By running everything in the browser, we eliminate security concerns while providing access to the real Hathor SDK and Python ecosystem.

This approach enables rapid development and testing without requiring complex server infrastructure or compromising on security.

