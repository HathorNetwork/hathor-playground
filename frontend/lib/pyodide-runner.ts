/**
 * Pyodide-based Python execution service for secure browser-based contract execution
 * Loads Pyodide directly from CDN to avoid webpack issues
 */

import { HATHOR_MODULES } from './hathor-modules';
import { MockLoader } from './mock-loader';

interface ExecutionResult {
  success: boolean;
  result?: any;
  error?: string;
  output?: string;
  contract_id?: string;
}

interface ExecutionRequest {
  contract_id: string;
  method_name: string;
  args: any[];
  kwargs: Record<string, any>;
  caller_address: string;
  method_type?: string;
}

// Global Pyodide interface
declare global {
  interface Window {
    loadPyodide?: (options: any) => Promise<any>;
  }
}

class PyodideRunner {
  private pyodide: any = null;
  private isInitialized: boolean = false;
  private initPromise: Promise<void> | null = null;
  private contractStorage: Map<string, any> = new Map();

  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this._doInitialize();
    return this.initPromise;
  }

  private async _doInitialize(): Promise<void> {
    console.log('🐍 Initializing Pyodide...');
    
    try {
      // Load Pyodide script from CDN
      if (!window.loadPyodide) {
        await this.loadPyodideScript();
      }

      this.pyodide = await window.loadPyodide!({
        indexURL: "https://cdn.jsdelivr.net/pyodide/v0.27.7/full/",
      });

      // Load real Hathor modules from GitHub - NO FALLBACKS
      await this.setupHathorModules();

      // Check Python version
      const pythonVersion = this.pyodide.runPython(`
import sys
sys.version
      `);
      console.log('🐍 Python version:', pythonVersion);
      
      this.isInitialized = true;
      console.log('✅ Pyodide initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize Pyodide:', error);
      throw error;
    }
  }

  private async loadPyodideScript(): Promise<void> {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/pyodide/v0.27.7/full/pyodide.js';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load Pyodide script'));
      document.head.appendChild(script);
    });
  }

  private async setupHathorModules(): Promise<void> {
    if (!this.pyodide) throw new Error('Pyodide not initialized');

    console.log('📦 Loading real Hathor SDK modules...');
    
    // Install required packages first
    await this.pyodide.loadPackage(['micropip']);
    
    // Install Python dependencies that we can get
    const micropip = this.pyodide.pyimport('micropip');
    
    // Essential packages that Hathor modules depend on
    // Note: Some packages like twisted, cryptography, rocksdb won't work in browser
    // TODO check which packages we really need to import
    const packages = [
      'structlog',
      'typing_extensions', 
      'attrs',
      'pydantic==1.10.14',  // Use v1 for compatibility with Hathor
      'intervaltree',
      'sortedcontainers',
      'base58',
      //'pycoin',
      'mnemonic',
      //'pysha3',  // For keccak
      'requests',
      'aiohttp',
      'multidict',
      'yarl',  // aiohttp dependency
      'async-timeout',  // aiohttp dependency
      'charset-normalizer',  // requests dependency
      'PyYAML',  // For yaml support
    ];
    
    console.log('📦 Installing Python dependencies...');
    let installedCount = 0;
    let failedCount = 0;
    
    for (const pkg of packages) {
      try {
        await micropip.install(pkg);
        console.log(`✓ Installed ${pkg}`);
        installedCount++;
      } catch (error) {
        console.warn(`⚠️ Failed to install ${pkg}:`, error);
        failedCount++;
      }
    }
    
    console.log(`📊 Dependencies: ${installedCount} installed, ${failedCount} failed`);
    
    // Load Hathor modules from local server
    await this.loadHathorFromLocal();
    
    console.log('✅ Real Hathor SDK loaded successfully');
  }

  private async loadHathorFromLocal(): Promise<void> {
    console.log(`📦 Loading ${HATHOR_MODULES.length} Hathor modules from local server...`);
    
    // Base URL for locally served Hathor modules
    const localBaseUrl = '/hathor-modules';

    let loaded = 0;
    let failed = 0;
    const errors: string[] = [];

    // Process modules in parallel batches for faster loading
    const BATCH_SIZE = 20;
    const batches: string[][] = [];
    
    for (let i = 0; i < HATHOR_MODULES.length; i += BATCH_SIZE) {
      batches.push(HATHOR_MODULES.slice(i, i + BATCH_SIZE));
    }

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      const batchPromises = batch.map(async (filePath) => {
        try {
          // Remove 'hathor/' prefix since files are stored at root level
          const adjustedPath = filePath.replace('hathor/', '');
          const response = await fetch(`${localBaseUrl}/${adjustedPath}`);
          if (!response.ok) {
            throw new Error(`Failed to fetch ${filePath}: ${response.status}`);
          }
          
          let content = await response.text();
          
          // Special handling for problematic modules
          if (MockLoader.getMockForPath(filePath)) {
            // Replace subprocess-based version detection with static version
            content = MockLoader.getMockForPath(filePath)!;
          }
          
          // Skip modules that are known to cause issues in browser
          const problematicModules = [
            'hathor/cli/run_node.py', // Uses twisted reactor
            'hathor/p2p/protocol.py', // Uses twisted
            'hathor/reactor/reactor.py', // Uses twisted
            'hathor/websocket/factory.py', // Uses twisted
            'hathor/stratum/stratum.py', // Uses twisted
            'hathor/nanocontracts/rng.py', // Uses cryptography
            'hathor/nanocontracts/utils.py', // Uses cryptography and pycoin - create proper stub
          ];
          
          if (problematicModules.some(mod => filePath.includes(mod))) {
            // Create stub modules with minimal functionality
            if (MockLoader.getMockForPath(filePath)) {
              // Provide the actual utils functions from the real module
              content = MockLoader.getMockForPath(filePath)!;
            } else {
              content = `# Stub module for browser compatibility\npass`;
            }
          }
          
          // Create the file in Pyodide's filesystem
          const pythonPath = filePath.replace(/\//g, '/');
          const dirPath = pythonPath.substring(0, pythonPath.lastIndexOf('/'));
          
          // Create directory structure
          await this.pyodide.runPython(`
import os
os.makedirs('${dirPath}', exist_ok=True)
`);
          
          // Write the file
          this.pyodide.FS.writeFile(pythonPath, content);
          loaded++;
          
        } catch (error) {
          failed++;
          const errorMsg = `Failed to load ${filePath}: ${error}`;
          errors.push(errorMsg);
          // Continue loading other files - don't fail fast
        }
      });
      
      await Promise.all(batchPromises);
      
      // Progress update
      const progress = Math.round(((batchIndex + 1) / batches.length) * 100);
      console.log(`📊 Progress: ${progress}% - Loaded ${loaded}/${HATHOR_MODULES.length} modules`);
    }
    
    console.log(`📦 Module loading complete: ${loaded} succeeded, ${failed} failed`);
    
    if (errors.length > 0 && errors.length <= 10) {
      console.warn('Failed modules:', errors);
    } else if (errors.length > 10) {
      console.warn(`Failed to load ${errors.length} modules. First 10:`, errors.slice(0, 10));
    }

    // TODO load cryptography manually
    await this.pyodide.loadPackage("cryptography");

    // Set up all mock modules for browser compatibility FIRST
    await this.pyodide.runPython(MockLoader.getAllSetupMocks());

    // Set up Python environment with real Hathor modules
    await this.pyodide.runPython(`
import sys
sys.path.insert(0, '.')

# Import real Hathor modules
try:
    import hathor
    print("✓ hathor module imported")
except ImportError as e:
    print(f"❌ Failed to import hathor: {e}")

try:
    import hathor.version
    print(f"✓ hathor.version imported: {hathor.version.__version__}")
except ImportError as e:
    print(f"❌ Failed to import hathor.version: {e}")

try:
    import hathor.types
    print("✓ hathor.types imported")
except ImportError as e:
    print(f"❌ Failed to import hathor.types: {e}")

try:
    import hathor.nanocontracts
    from hathor.nanocontracts.blueprint import Blueprint
    from hathor.nanocontracts.context import Context
    print("✓ Basic nanocontracts imports successful")
    
    # Try importing types explicitly
    try:
        import hathor.nanocontracts.types as nc_types
        print("✓ hathor.nanocontracts.types imported")
        
        # Import specific types
        Amount = nc_types.Amount
        Address = nc_types.Address
        ContractId = nc_types.ContractId
        TokenUid = nc_types.TokenUid
        VertexId = nc_types.VertexId
        Timestamp = nc_types.Timestamp
        
        print(f"✓ Types available: Amount={Amount}, Address={Address}")
        
        # Make common types available globally for contracts
        import builtins
        builtins.Amount = Amount
        builtins.Address = Address
        builtins.ContractId = ContractId
        builtins.TokenUid = TokenUid
        builtins.VertexId = VertexId
        builtins.Timestamp = Timestamp
        
        # Also set them in globals for the exec environment
        globals()['Amount'] = Amount
        globals()['Address'] = Address
        globals()['ContractId'] = ContractId
        globals()['TokenUid'] = TokenUid
        globals()['VertexId'] = VertexId
        globals()['Timestamp'] = Timestamp
        
        print("✓ Types set up in builtins and globals")
        
    except Exception as e:
        print(f"❌ Failed to import types: {e}")
        # Fallback: create minimal types
        from typing import NewType
        Amount = NewType('Amount', int)
        Address = NewType('Address', bytes)
        ContractId = NewType('ContractId', bytes)
        TokenUid = NewType('TokenUid', bytes)
        VertexId = NewType('VertexId', bytes)
        Timestamp = NewType('Timestamp', int)
        
        import builtins
        builtins.Amount = Amount
        builtins.Address = Address
        builtins.ContractId = ContractId
        builtins.TokenUid = TokenUid
        builtins.VertexId = VertexId
        builtins.Timestamp = Timestamp
        
        globals()['Amount'] = Amount
        globals()['Address'] = Address
        globals()['ContractId'] = ContractId
        globals()['TokenUid'] = TokenUid
        globals()['VertexId'] = VertexId
        globals()['Timestamp'] = Timestamp
        
        print("✓ Fallback types created and set up")
    
    print("✓ hathor.nanocontracts setup completed")
except ImportError as e:
    print(f"❌ Failed to import hathor.nanocontracts: {e}")
except Exception as e:
    print(f"❌ Unexpected error in nanocontracts setup: {e}")

# Import the real Runner
try:
    from hathor.nanocontracts.runner.runner import Runner
    from hathor.nanocontracts.storage.backends import MemoryNodeTrieStore
    from hathor.nanocontracts.storage.contract_storage import NCContractStorage
    from hathor.nanocontracts.storage.factory import NCStorageFactory
    print("✓ Runner imported successfully")
    
    # Create global runner instance with memory storage
    try:
        # Create memory-based storage backend with proper parameters
        node_store = MemoryNodeTrieStore()

        from hathor.conf import HathorSettings
        from hathor.reactor.reactor import MockReactorProtocol, get_global_reactor
        # MockTransactionStorage is available from the transaction_storage mock
        from hathor.transaction.storage.transaction_storage import MockTransactionStorage
        from hathor.nanocontracts.storage.block_storage import NCBlockStorage
        from hathor.nanocontracts.storage.patricia_trie import PatriciaTrie
        from hathor.nanocontracts.types import VertexId
        from hathor.nanocontracts.storage.token_proxy import TokenProxy
        
        # Create mock/minimal implementations
        settings = HathorSettings()  # Default settings
        reactor = get_global_reactor()  # Use the mock reactor
        tx_storage = MockTransactionStorage()  
        trie = PatriciaTrie(node_store)
        block_storage = NCBlockStorage(trie)
        # TODO ok to use dummy seed or should we use proper one?
        seed = bytes(32)  # Dummy seed

        dummy_nc_id = VertexId(bytes(32))
        dummy_token_proxy = TokenProxy(block_storage=block_storage)
        
        nc_storage = NCContractStorage(trie=trie, nc_id=dummy_nc_id, token_proxy=dummy_token_proxy)
        
        storage_factory = NCStorageFactory()
        nc_runner = Runner(
            reactor=reactor,
            settings=settings,
            tx_storage=tx_storage,
            storage_factory=storage_factory,
            block_storage=block_storage,
            seed=seed
        )
        print("✓ Runner instance created with NCContractStorage")
    except Exception as e:
        print(f"⚠️ Failed to create Runner instance: {e}")
        nc_runner = None
    
except ImportError as e:
    print(f"❌ Failed to import Runner: {e}")
    # Fallback to manual implementation if needed
    nc_runner = None

# Set up global contract registry for execution (keeping as fallback)
_contract_registry = {}
_contract_instances = {}

def _create_contract_id():
    """Generate a contract ID"""
    import random
    return random.randbytes(32)

def _create_address_from_hex(hex_str):
    """Convert hex string to 25-byte address"""
    # Ensure we always return bytes, not Address objects
    if len(hex_str) == 50:  # 25 bytes
        return bytes.fromhex(hex_str)
    elif len(hex_str) == 64:  # 32 bytes, truncate to 25
        return bytes.fromhex(hex_str[:50])
    else:
        raise ValueError(f"Invalid address length: {len(hex_str)} chars")

def _create_context(
    caller_address_hex=None,
    actions=None,
    vertex=None,
    timestamp=None
):
    """Create context for contract execution using real Hathor Context"""
    from hathor.nanocontracts.context import Context
    from hathor.nanocontracts.types import Address, VertexId
    from hathor.nanocontracts.vertex_data import BlockData, VertexData
    
    # Handle caller_id
    if caller_address_hex:
        caller_hash = _create_address_from_hex(caller_address_hex)
        caller_id = Address(caller_hash)
    else:
        # Generate random address if none provided (like gen_random_address())
        import random
        random_hash = random.randbytes(25)  # 25-byte address
        caller_id = Address(random_hash)
    
    # Handle vertex_data - use provided vertex or create minimal one
    if vertex:
        vertex_data = VertexData.create_from_vertex(vertex)
    else:
        # Create minimal vertex for VertexData.create_from_vertex()
        from hathor.transaction import Transaction
        
        # Create a minimal transaction as vertex
        minimal_vertex = Transaction(
            hash=b'\\x00' * 32,
            timestamp=timestamp or int(__import__('time').time()),
            version=1,
            weight=1.0,
            inputs=[],
            outputs=[],
            parents=[]
        )
        vertex_data = VertexData.create_from_vertex(minimal_vertex)
    
    # Create block_data following the unittest pattern
    block_data = BlockData(
        hash=VertexId(b'\\x00' * 32),  # Empty hash like in unittest
        timestamp=timestamp or int(__import__('time').time()),
        height=0
    )
    
    return Context(
        caller_id=caller_id,
        vertex_data=vertex_data,
        block_data=block_data,
        actions=Context.__group_actions__(actions or ()),  # Group provided or empty actions
    )

print("✅ Real Hathor SDK environment loaded successfully")
`);

    // Mock modules already set up at the beginning

  }

  async compileContract(code: string, blueprint_name: string): Promise<{ success: boolean; blueprint_id?: string; error?: string }> {
    if (!this.pyodide) {
      await this.initialize();
      if (!this.pyodide) throw new Error('Failed to initialize Pyodide');
    }

    try {
      // Generate blueprint ID
      const blueprint_id = this.generateId();

      console.log('🔍 Contract code to compile:', code.substring(0, 200) + '...');
      
      // Compile the contract
      const result = this.pyodide.runPython(`
print("🚀 Starting contract compilation...")
try:
    # Test if the contract can import what it needs
    print("🔍 Testing basic Hathor imports...")
    
    try:
        from hathor.nanocontracts.blueprint import Blueprint
        print("✅ Blueprint import works")
    except Exception as e:
        print(f"❌ Blueprint import failed: {e}")
        raise
    
    try:
        from hathor.nanocontracts.context import Context  
        print("✅ Context import works")
    except Exception as e:
        print(f"❌ Context import failed: {e}")
        raise
        
    try:
        from hathor.nanocontracts.types import Amount, Address, TokenUid, ContractId, VertexId, public, view
        print(f"✅ Types import works - Amount: {Amount}, Address: {Address}, TokenUid: {TokenUid}") 
        print(f"✅ Decorators import works - public: {public}, view: {view}")
    except Exception as e:
        print(f"❌ Types/decorators import failed: {e}")
        raise
    
    # If we get here, imports work - let the contract import what it needs
    print("✅ All basic imports working, executing contract with full globals access")
    
    # Use the current globals so the contract's imports are available for type annotations
    exec_globals = globals()
    exec_locals = {}
    
    # Execute the contract code - imports and type annotations will work
    exec('''${code.replace(/'/g, "\\'")}''', exec_globals, exec_locals)
    
    # Find the blueprint class
    blueprint_class = None
    if '__blueprint__' in exec_locals:
        blueprint_class = exec_locals['__blueprint__']
    else:
        # Look for Blueprint subclasses
        for name, obj in exec_locals.items():
            if hasattr(obj, '__bases__') and any('Blueprint' in base.__name__ for base in obj.__bases__):
                blueprint_class = obj
                break
    
    if blueprint_class is None:
        raise Exception("No Blueprint class found. Make sure to export your class as __blueprint__")
    
    # Store the blueprint class
    _contract_registry['${blueprint_id}'] = blueprint_class
    
    # Create and save OnChainBlueprint transaction if we have a transaction storage
    try:
        from hathor.conf import HathorSettings
        settings = HathorSettings()
        
        # Convert blueprint_id string to bytes
        blueprint_id_bytes = bytes.fromhex('${blueprint_id}')
        
        # Create OnChainBlueprint transaction with the compiled code
        blueprint_tx = tx_storage.create_blueprint_transaction(
            code_string='''${code.replace(/(?:\r\n|\r|\n)/g, "\n")}''',
            blueprint_id_bytes=blueprint_id_bytes,
            settings=settings
        )
        
        # Save the transaction
        tx_storage.save_transaction(blueprint_tx)
        print(f"✓ Created and saved OnChainBlueprint transaction for {blueprint_id_bytes.hex()}")
            
    except Exception as e:
        print(f"⚠️ Failed to create OnChainBlueprint transaction: {e}")
    
    result = {
        'success': True,
        'blueprint_id': '${blueprint_id}',
        'blueprint_name': '${blueprint_name}',
        'methods': {
            'public': [],  # Will be discovered at runtime
            'view': []     # Will be discovered at runtime  
        }
    }
    
except Exception as e:
    import traceback
    traceback_str = traceback.format_exc()
    print(f"❌ Contract compilation exception: {e}")
    print(f"❌ Full traceback: {traceback_str}")
    result = {
        'success': False,
        'error': str(e),
        'traceback': traceback_str
    }

import json
json.dumps(result)
`);

      const compilationResult = JSON.parse(result);
      
      if (compilationResult.success) {
        console.log(`✅ Contract compiled successfully: ${blueprint_name}`);
        return { success: true, blueprint_id };
      } else {
        console.error(`❌ Compilation failed:`, compilationResult.error);
        return { success: false, error: compilationResult.error };
      }
    } catch (error) {
      console.error('❌ Compilation error:', error);
      return { success: false, error: String(error) };
    }
  }

  async executeContract(request: ExecutionRequest): Promise<ExecutionResult> {
    if (!this.pyodide) {
      await this.initialize();
      if (!this.pyodide) throw new Error('Failed to initialize Pyodide');
    }

    try {
      const { contract_id, method_name, args, caller_address } = request;
      console.log('*****', contract_id);
      
      // Check if this is an initialize call (uses blueprint_id) or method call (uses contract_id)
      let blueprint_id = contract_id;
      let contract_instance_id = contract_id;
      
      if (method_name === 'initialize') {
        // Create new contract instance
        contract_instance_id = this.generateId();
      } else {
        // Find blueprint for existing contract instance
        const stored_instance = this.contractStorage.get(contract_id);
        if (!stored_instance) {
          return { success: false, error: `Contract instance ${contract_id} not found` };
        }
        blueprint_id = stored_instance.blueprint_id;
      }

      // Execute the method using real Runner
      const result = this.pyodide.runPython(`
try:
    # Check if we have the real Runner
    if nc_runner is not None:
        # Use the real Runner
        print("🚀 Using real Runner for execution")
        
        # Get the blueprint class
        #blueprint_class = _contract_registry.get('${blueprint_id}')
        #if blueprint_class is None:
        #    raise Exception("Blueprint not found: ${blueprint_id}")
        
        # Create context
        context = _create_context(caller_address_hex='${caller_address}')
        
        # Prepare arguments  
        args = ${JSON.stringify(args)}
        
        if '${method_name}' == 'initialize':
            # Initialize new contract
            print(f"🏗️ Initializing contract with args: {args}")
            
            # Use the real runner to initialize the contract
            from hathor.nanocontracts.types import Address
            caller_address = Address(_create_address_from_hex('${caller_address}'))
            
            # Generate a contract ID and create contract using the real runner
            blueprint_id = bytes.fromhex('${contract_id}')
            print('== blueprint id:', blueprint_id.hex(), blueprint_id)
            contract_id = _create_contract_id()
            print('== Contract id:', contract_id.hex())
            
            # Create contract using correct Runner signature: (contract_id, blueprint_id, ctx)
            nc_runner.create_contract(
                contract_id=contract_id,
                blueprint_id=blueprint_id,
                ctx=context
            )
            
            execution_result = {
                'success': True,
                'result': {'contract_id': contract_id.hex()},
                'output': 'Contract initialized successfully using real Runner'
            }
            
        else:
            # Execute method on existing contract
            print(f"⚡ Executing method {method_name} with args: {args}")
            
            from hathor.nanocontracts.types import ContractId
            contract_id_obj = ContractId(contract_id)
            
            # Execute the method using the real runner
            result_value = nc_runner.call_contract_method(
                contract_id=contract_id_obj,
                method_name='${method_name}',
                args=args,
                context=context
            )
            
            execution_result = {
                'success': True,
                'result': result_value,
                'output': f'Method {method_name} executed successfully using real Runner'
            }
    
    else:
        raise Exception("no runner found")

except Exception as e:
    import traceback
    traceback_str = traceback.format_exc()
    print(f"❌ Method execution exception: {e}")
    print(f"❌ Full execution traceback: {traceback_str}")
    execution_result = {
        'success': False,
        'error': str(e),
        'traceback': traceback_str
    }

import json
json.dumps(execution_result)
`);

      const executionResult = JSON.parse(result);
      
      // Store contract instance in our storage if it's a new initialize
      if (method_name === 'initialize' && executionResult.success) {
        this.contractStorage.set(contract_instance_id, {
          blueprint_id,
          created_at: new Date().toISOString()
        });
        executionResult.contract_id = contract_instance_id;
      }
      
      return executionResult;
      
    } catch (error) {
      console.error('❌ Execution error:', error);
      return { success: false, error: String(error) };
    }
  }

  async validateContract(code: string): Promise<{ valid: boolean; errors: Array<{ line: number; message: string; severity: string }> }> {
    if (!this.pyodide) {
      await this.initialize();
      if (!this.pyodide) throw new Error('Failed to initialize Pyodide');
    }

    try {
      const result = this.pyodide.runPython(`
try:
    import ast
    import sys
    from io import StringIO
    
    errors = []
    
    # Try to parse the Python code
    try:
        tree = ast.parse('''${code.replace(/'/g, "\\'")}''')
    except SyntaxError as e:
        errors.append({
            'line': e.lineno or 1,
            'message': str(e),
            'severity': 'error'
        })
    
    # Try to compile
    if not errors:
        try:
            compile('''${code.replace(/'/g, "\\'")}''', '<string>', 'exec')
        except Exception as e:
            errors.append({
                'line': 1,
                'message': str(e),
                'severity': 'error'
            })
    
    validation_result = {
        'valid': len(errors) == 0,
        'errors': errors
    }
    
except Exception as e:
    validation_result = {
        'valid': False,
        'errors': [{'line': 1, 'message': str(e), 'severity': 'error'}]
    }

import json
json.dumps(validation_result)
`);

      return JSON.parse(result);
    } catch (error) {
      return {
        valid: false,
        errors: [{ line: 1, message: String(error), severity: 'error' }]
      };
    }
  }

  private generateId(): string {
    return Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  isReady(): boolean {
    return this.isInitialized;
  }
}

// Singleton instance
export const pyodideRunner = new PyodideRunner();
