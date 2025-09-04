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
  code?: string; // Contract code to determine method decorators
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

  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this._doInitialize();
    return this.initPromise;
  }

  private async _doInitialize(): Promise<void> {
    console.log('🐍 Initializing Pyodide...');
    
    try {
      const PYODIDE_VERSION = "0.27.7";
      const PYODIDE_BASE_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
      
      // Load Pyodide script from CDN
      if (!window.loadPyodide) {
        await this.loadPyodideScript(PYODIDE_VERSION, PYODIDE_BASE_URL);
      }
      
      this.pyodide = await window.loadPyodide!({
        indexURL: PYODIDE_BASE_URL,
      });

      // Load real Hathor modules
      await this.setupHathorModules();

      this.isInitialized = true;
      console.log('✅ Pyodide initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize Pyodide:', error);
      throw error;
    }
  }

  private async loadPyodideScript(version: string, baseUrl: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `${baseUrl}pyodide.js`;
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
    const packages = [
      'structlog',
      'typing_extensions', 
      'pydantic==1.10.14',  // Use v1 for compatibility with Hathor
      'intervaltree',
      'base58',
      'multidict',
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
    
    // Load Hathor modules from compressed archive
    await this.loadHathorFromArchive();
    
    console.log('✅ Real Hathor SDK loaded successfully');
  }

  private async loadHathorFromArchive(): Promise<void> {
    console.log('📦 Downloading compressed Hathor modules archive...');
    
    try {
      // Download the compressed archive
      const response = await fetch('/hathor-modules.json.gz');
      if (!response.ok) {
        throw new Error(`Failed to fetch compressed modules: ${response.status}`);
      }
      
      // Get the compressed data as ArrayBuffer
      const compressedData = await response.arrayBuffer();
      const compressedSize = compressedData.byteLength;
      console.log(`📦 Downloaded compressed archive: ${(compressedSize / 1024 / 1024).toFixed(2)} MB`);
      
      // Use browser-side decompression
      console.log('📦 Decompressing archive in browser...');
      
      if (!('DecompressionStream' in window)) {
        throw new Error('Browser does not support DecompressionStream API. Please use a modern browser (Chrome 80+, Firefox 116+).');
      }
      
      // Decompress using browser's DecompressionStream
      const stream = new DecompressionStream('gzip');
      const writer = stream.writable.getWriter();
      const reader = stream.readable.getReader();
      
      writer.write(new Uint8Array(compressedData));
      writer.close();
      
      const chunks = [];
      let done = false;
      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (value) chunks.push(value);
      }
      
      // Combine chunks
      const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
      const decompressedData = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        decompressedData.set(chunk, offset);
        offset += chunk.length;
      }
      
      // Process the decompressed data
      const decompressedText = new TextDecoder().decode(decompressedData);
      const moduleData = JSON.parse(decompressedText);
      const files = moduleData.files;
      const fileCount = Object.keys(files).length;
      
      console.log(`📦 Processing ${fileCount} Hathor modules from browser decompression...`);
      console.log(`📅 Archive created: ${moduleData.timestamp}`);
      console.log(`📊 Decompressed ${(decompressedData.length / 1024 / 1024).toFixed(2)} MB`);
      
      // Continue with module processing
      await this.processModulesFromData(files, fileCount);
      
      // Modify configuration files after processing
      await this.modifyConfigFiles();
      
    } catch (error) {
      console.error('❌ Failed to load modules from archive:', error);
      throw error;
    }

    // Set up all mock modules for browser compatibility FIRST
    await this.pyodide.runPython(MockLoader.getAllSetupMocks());
    
    // Set up Python environment after all modules are loaded
    await this.setupPythonEnvironment();
  }

  private async processModulesFromData(files: Record<string, string>, fileCount: number): Promise<void> {
    let loaded = 0;
    let failed = 0;
    const errors: string[] = [];
    
    // Process all files
    for (const [filePath, content] of Object.entries(files)) {
      try {
        let finalContent = content as string;
        
        // Add 'hathor/' prefix for mock loader compatibility
        const fullPath = `hathor/${filePath}`;
        
        // Special handling for problematic modules
        if (MockLoader.getMockForPath(fullPath)) {
          finalContent = MockLoader.getMockForPath(fullPath)!;
        }
        
        // Skip modules that are known to cause issues in browser
        const problematicModules = [
          'cli/run_node.py', // Uses twisted reactor
          'p2p/protocol.py', // Uses twisted
          'reactor/reactor.py', // Uses twisted
          'websocket/factory.py', // Uses twisted
          'stratum/stratum.py', // Uses twisted
          'nanocontracts/rng.py', // Uses cryptography
          'nanocontracts/utils.py', // Uses cryptography and pycoin
        ];
        
        if (problematicModules.some(mod => filePath.includes(mod))) {
          if (MockLoader.getMockForPath(fullPath)) {
            finalContent = MockLoader.getMockForPath(fullPath)!;
          } else {
            finalContent = `# Stub module for browser compatibility\npass`;
          }
        }
        
        // Create the file in Pyodide's filesystem with hathor/ prefix
        const pythonPath = fullPath.replace(/\//g, '/');
        const dirPath = pythonPath.substring(0, pythonPath.lastIndexOf('/'));
        
        // Create directory structure
        await this.pyodide.runPython(`
import os
os.makedirs('${dirPath}', exist_ok=True)
`);
        
        // Write the file
        this.pyodide.FS.writeFile(pythonPath, finalContent);
        loaded++;
        
        // Progress update every 50 files
        if (loaded % 50 === 0) {
          const progress = Math.round((loaded / fileCount) * 100);
          console.log(`📊 Progress: ${progress}% - Processed ${loaded}/${fileCount} modules`);
        }
        
      } catch (error) {
        failed++;
        const errorMsg = `Failed to process ${filePath}: ${error}`;
        errors.push(errorMsg);
      }
    }
    
    console.log(`📦 Module processing complete: ${loaded} succeeded, ${failed} failed`);
    
    if (errors.length > 0 && errors.length <= 10) {
      console.warn('Failed modules:', errors);
    } else if (errors.length > 10) {
      console.warn(`Failed to load ${errors.length} modules. First 10:`, errors.slice(0, 10));
    }
  }

  private async modifyConfigFiles(): Promise<void> {
    console.log('⚙️  Modifying configuration files...');
    
    try {
      // Modify hathor/conf/mainnet.yml to enable nano contracts
      const mainnetYmlPath = 'hathor/conf/mainnet.yml';
      
      // Read the current mainnet.yml file
      let currentContent: string;
      try {
        currentContent = this.pyodide.FS.readFile(mainnetYmlPath, { encoding: 'utf8' });
      } catch (error) {
        console.warn(`⚠️ Could not read ${mainnetYmlPath}:`, error);
        return;
      }
      
      // Check if ENABLE_NANO_CONTRACTS is already present
      if (currentContent.includes('ENABLE_NANO_CONTRACTS:')) {
        // Replace existing value
        const modifiedContent = currentContent.replace(
          /ENABLE_NANO_CONTRACTS:\s*\w+/,
          'ENABLE_NANO_CONTRACTS: enabled'
        );
        this.pyodide.FS.writeFile(mainnetYmlPath, modifiedContent);
        console.log(`✅ Updated existing ENABLE_NANO_CONTRACTS in ${mainnetYmlPath}`);
      } else {
        // Add the setting at the end of the file
        const modifiedContent = currentContent + '\nENABLE_NANO_CONTRACTS: enabled\n';
        this.pyodide.FS.writeFile(mainnetYmlPath, modifiedContent);
        console.log(`✅ Added ENABLE_NANO_CONTRACTS: enabled to ${mainnetYmlPath}`);
      }
      
    } catch (error) {
      console.error('❌ Failed to modify configuration files:', error);
    }
  }

  private async setupPythonEnvironment(): Promise<void> {
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
    from hathor.conf import HathorSettings
    from hathor.reactor.reactor import get_global_reactor
    from hathor.transaction.storage.transaction_storage import MockTransactionStorage
    from hathor.nanocontracts.storage.block_storage import NCBlockStorage
    from hathor.nanocontracts.storage.patricia_trie import PatriciaTrie
    from hathor.nanocontracts.runner.runner import Runner
    from hathor.nanocontracts.storage.backends import MemoryNodeTrieStore
    from hathor.nanocontracts.storage.factory import NCStorageFactory
    print("✓ Runner imported successfully")
    
    # Create global runner instance with memory storage
    try:
        # Create mock/minimal implementations
        settings = HathorSettings()  # Default settings
        reactor = get_global_reactor()  # Use the mock reactor
        tx_storage = MockTransactionStorage()  
        node_store = MemoryNodeTrieStore()
        trie = PatriciaTrie(node_store)
        block_storage = NCBlockStorage(trie)
        # TODO ok to use dummy seed or should we use proper one?
        seed = bytes(32)  # Dummy seed

        storage_factory = NCStorageFactory()
        nc_runner = Runner(
            reactor=reactor,
            settings=settings,
            tx_storage=tx_storage,
            storage_factory=storage_factory,
            block_storage=block_storage,
            seed=seed
        )
        print("✓ Runner instance created")
    except Exception as e:
        print(f"⚠️ Failed to create Runner instance: {e}")
        nc_runner = None
    
except ImportError as e:
    print(f"❌ Failed to import Runner: {e}")
    raise e

def _create_address_from_hex(hex_str):
    """Convert hex string to 25-byte address"""
    # Ensure we always return bytes, not Address objects
    if len(hex_str) == 50:  # 25 bytes
        return bytes.fromhex(hex_str)
    elif len(hex_str) == 64:  # 32 bytes, truncate to 25
        return bytes.fromhex(hex_str[:50])
    else:
        raise ValueError(f"Invalid address length: {len(hex_str)} chars")

def _convert_frontend_args(args_json, kwargs_json):
    """Convert JSON strings from frontend to Python objects"""
    import json
    
    # Parse JSON strings
    args = json.loads(args_json) if args_json else []
    kwargs = json.loads(kwargs_json) if kwargs_json else {}
    
    print(f"Converted args from frontend: {args}")
    print(f"Converted kwargs from frontend: {kwargs}")
    
    return args, kwargs

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
      const parsedCode = code.replace(/(?:\r\n|\r|\n)/g, "\n");
      
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
    exec('''${parsedCode}''', exec_globals, exec_locals)
    
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
    
    # Create and save OnChainBlueprint transaction
    try:
        # Convert blueprint_id string to bytes
        blueprint_id_bytes = bytes.fromhex('${blueprint_id}')
        
        # Create OnChainBlueprint transaction with the compiled code
        blueprint_tx = tx_storage.create_blueprint_transaction(
            code_string='''${parsedCode}''',
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
      const { method_name, args, caller_address, code } = request;
      let { contract_id } = request;
      
      // Check if this is an initialize call (uses blueprint_id) or method call (uses contract_id)  
      let blueprint_id = contract_id; // For initialize, contract_id is actually blueprint_id
      
      if (method_name === 'initialize') {
        // Create new contract instance
        contract_id = this.generateId();
        // blueprint_id stays as the original contract_id (which was blueprint_id)
      }
      // Determine method type by parsing the contract code
      let methodType: 'public' | 'view' | null = null;
      if (!code) {
        return { success: false, error: 'Contract code is required for method execution' };
      }
      
      methodType = this.getMethodType(code, method_name);
      if (!methodType) {
        return { 
          success: false, 
          error: `Method '${method_name}' is not decorated with @public or @view` 
        };
      }

      // Execute the method using real Runner
      const result = this.pyodide.runPython(`
try:
    # Check if we have the real Runner
    if nc_runner is not None:
        # Use the real Runner
        print("🚀 Using real Runner for execution")
        
        # Create context
        context = _create_context(caller_address_hex='${caller_address}')
        
        # Convert arguments and kwargs from JSON to Python objects
        args, kwargs = _convert_frontend_args('''${JSON.stringify(args)}''', '''${JSON.stringify(request.kwargs)}''')
        
        method_name = '${method_name}'
        method_type = '${methodType}'
        blueprint_id = bytes.fromhex('${blueprint_id}')
        contract_id = bytes.fromhex('${contract_id}')

        if method_name == 'initialize':
            # Initialize new contract
            print(f"🏗️ Initializing contract with args: {args}")
            
            # Use the real runner to initialize the contract
            from hathor.nanocontracts.types import Address
            caller_address = Address(_create_address_from_hex('${caller_address}'))
            
            nc_runner.create_contract(
                contract_id,
                blueprint_id,
                context,
                *args,
                **kwargs
            )
            
            execution_result = {
                'success': True,
                'result': {'contract_id': contract_id.hex()},
                'output': 'Contract initialized successfully using real Runner'
            }
            
        else:
            # Execute method on existing contract
            print(f"⚡ Executing method {method_name} with args {args} kwargs {kwargs}, type ${methodType}")
            
            if method_type == 'public':
                # Use call_public_method for @public methods
                result_value = nc_runner.call_public_method(
                    contract_id,
                    method_name,
                    context,
                    *args,
                    **kwargs
                )
            elif method_type == 'view':
                # Use call_view_method for @view methods  
                result_value = nc_runner.call_view_method(
                    contract_id,
                    method_name,
                    *args,
                    **kwargs
                )
            else:
                raise Exception(f"Invalid method type: {method_type}")
            
            execution_result = {
                'success': True,
                'result': result_value,
                'output': f'Method {method_name} executed successfully using real Runner (${methodType})'
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

  /**
   * Check if a method has @public or @view decorator by parsing the code string
   */
  private getMethodType(code: string, methodName: string): 'public' | 'view' | null {
    const lines = code.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Look for @public or @view decorators
      if (line === '@public' || line === '@view') {
        // Check the next few lines for the method definition
        for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
          const nextLine = lines[j].trim();
          if (nextLine.startsWith(`def ${methodName}(`)) {
            return line === '@public' ? 'public' : 'view';
          }
          // Skip empty lines and other decorators
          if (nextLine && !nextLine.startsWith('@') && !nextLine.startsWith('def')) {
            break;
          }
        }
      }
    }
    
    return null;
  }

  isReady(): boolean {
    return this.isInitialized;
  }

  /**
   * Get blueprint information using Hathor's native BlueprintInfoResource
   * This provides proper method signatures, parameter types, and docstrings
   */
  async getBlueprintInfo(blueprintId: string): Promise<{
    success: boolean;
    blueprintInfo?: {
      id: string;
      name: string;
      attributes: Record<string, string>;
      public_methods: Record<string, {
        args: { name: string; type: string }[];
        return_type: string;
        docstring: string | null;
      }>;
      view_methods: Record<string, {
        args: { name: string; type: string }[];
        return_type: string;
        docstring: string | null;
      }>;
      docstring: string | null;
    };
    error?: string;
  }> {
    if (!this.pyodide) {
      await this.initialize();
      if (!this.pyodide) throw new Error('Failed to initialize Pyodide');
    }

    try {
      const result = this.pyodide.runPython(`
try:
    # Import BlueprintInfoResource and related modules
    from hathor.nanocontracts.resources.blueprint import BlueprintInfoResource
    from hathor.nanocontracts.types import blueprint_id_from_bytes
    from hathor.nanocontracts.exception import BlueprintDoesNotExist
    import inspect
    import builtins
    import types
    import typing
    from hathor.nanocontracts import types as nc_types
    from hathor.nanocontracts.blueprint import NC_FIELDS_ATTR
    from hathor.nanocontracts.context import Context
    from hathor.nanocontracts.utils import is_nc_public_method, is_nc_view_method
    
    print(f"🔍 Getting blueprint info for: ${blueprintId}")
    
    # Create a BlueprintInfoResource instance with mock manager
    class MockManager:
        def __init__(self):
            self.tx_storage = tx_storage
    
    mock_manager = MockManager()
    blueprint_resource = BlueprintInfoResource(mock_manager)
    
    # Convert blueprint ID from hex string to blueprint_id type
    blueprint_id = blueprint_id_from_bytes(bytes.fromhex('${blueprintId}'))
    
    # Get blueprint class from storage
    try:
        blueprint_class = tx_storage.get_blueprint_class(blueprint_id)
        print(f"✓ Found blueprint class: {blueprint_class.__name__}")
    except BlueprintDoesNotExist:
        raise Exception(f"Blueprint not found: ${blueprintId}")
    
    # Extract attributes/fields
    attributes = {}
    fields = getattr(blueprint_class, NC_FIELDS_ATTR, {})
    for name, _type in fields.items():
        attributes[name] = blueprint_resource.get_type_name(_type)
    
    # Extract methods using the same logic as BlueprintInfoResource
    public_methods = {}
    view_methods = {}
    skip_methods = {'__init__'}
    
    for name, method in inspect.getmembers(blueprint_class, predicate=inspect.isfunction):
        if name in skip_methods:
            continue

        if not (is_nc_public_method(method) or is_nc_view_method(method)):
            continue

        method_args = []
        argspec = inspect.getfullargspec(method)
        
        # Process arguments, skipping 'self' and 'ctx: Context'
        for arg_name in argspec.args[1:]:  # Skip 'self'
            if arg_name in argspec.annotations:
                arg_type = argspec.annotations[arg_name]
                if arg_type is Context:
                    continue  # Skip Context parameter
                method_args.append({
                    'name': arg_name,
                    'type': blueprint_resource.get_type_name(arg_type)
                })
            else:
                # If no type annotation, treat as string
                method_args.append({
                    'name': arg_name,
                    'type': 'str'
                })

        return_type = argspec.annotations.get('return', None)
        method_info = {
            'args': method_args,
            'return_type': blueprint_resource.get_type_name(return_type) if return_type else 'null',
            'docstring': inspect.getdoc(method)
        }

        if is_nc_public_method(method):
            public_methods[name] = method_info

        if is_nc_view_method(method):
            view_methods[name] = method_info
    
    blueprint_info = {
        'id': '${blueprintId}',
        'name': blueprint_class.__name__,
        'attributes': attributes,
        'public_methods': public_methods,
        'view_methods': view_methods,
        'docstring': inspect.getdoc(blueprint_class)
    }
    
    result = {
        'success': True,
        'blueprintInfo': blueprint_info
    }
    
    print(f"✓ Extracted {len(public_methods)} public methods and {len(view_methods)} view methods")
    
    # Debug: Show the initialize method signature
    if 'initialize' in public_methods:
        init_method = public_methods['initialize']
        print(f"📝 Initialize method signature:")
        print(f"  Args: {[arg['name'] + ':' + arg['type'] for arg in init_method['args']]}")
        print(f"  Return type: {init_method['return_type']}")
        print(f"  Docstring: {init_method['docstring']}")
    else:
        print("❌ No initialize method found in public_methods")
    
except Exception as e:
    import traceback
    traceback_str = traceback.format_exc()
    print(f"❌ Blueprint info extraction failed: {e}")
    print(f"❌ Full traceback: {traceback_str}")
    result = {
        'success': False,
        'error': str(e),
        'traceback': traceback_str
    }

import json
json.dumps(result)
`);

      const blueprintResult = JSON.parse(result);
      
      if (blueprintResult.success) {
        console.log(`✅ Got blueprint info for ${blueprintId}:`, blueprintResult.blueprintInfo);
        return { 
          success: true, 
          blueprintInfo: blueprintResult.blueprintInfo 
        };
      } else {
        console.error(`❌ Failed to get blueprint info:`, blueprintResult.error);
        return { 
          success: false, 
          error: blueprintResult.error 
        };
      }
    } catch (error) {
      console.error('❌ Blueprint info extraction error:', error);
      return { 
        success: false, 
        error: String(error) 
      };
    }
  }
}

// Singleton instance
export const pyodideRunner = new PyodideRunner();
