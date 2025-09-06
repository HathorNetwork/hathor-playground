/**
 * Pyodide-based Python execution service for secure browser-based contract execution
 * Loads Pyodide directly from CDN to avoid webpack issues
 */

import { HATHOR_MODULES } from './hathor-modules';
import { MockLoader } from './mock-loader';
import { getHathorHelpers } from '../utils/hathorHelpers';

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

try:
    import hathor
    import hathor.version
    import hathor.types

    import hathor.nanocontracts
    from hathor.nanocontracts.blueprint import Blueprint
    from hathor.nanocontracts.context import Context
    print("✓ Basic nanocontracts imports successful")
    
    import hathor.nanocontracts.types as nc_types
    print("✓ hathor.nanocontracts.types imported")
    
    # Import specific types
    Amount = nc_types.Amount
    Address = nc_types.Address
    ContractId = nc_types.ContractId
    TokenUid = nc_types.TokenUid
    VertexId = nc_types.VertexId
    Timestamp = nc_types.Timestamp
    
    print("✓ Types ready for explicit imports in user code")
        
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
        
        # Make runner globally available for tests
        import builtins
        builtins.nc_runner = nc_runner
        globals()['nc_runner'] = nc_runner
        
        print("✓ Runner instance created and made globally available")
    except Exception as e:
        print(f"⚠️ Failed to create Runner instance: {e}")
        nc_runner = None
        
        # Make sure global is also set to None
        import builtins
        builtins.nc_runner = None
        globals()['nc_runner'] = None
    
except ImportError as e:
    print(f"❌ Failed to import Runner: {e}")
    raise e

# Helper functions are now loaded from shared utilities

print("✅ Real Hathor SDK environment loaded successfully")
`);
    
    // Load common helper functions from shared utilities
    await this.pyodide.runPython(getHathorHelpers());
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

  async runTests(testContent: string, testFileName: string = 'test_file.py'): Promise<ExecutionResult> {
    if (!this.pyodide) {
      await this.initialize();
    }

    try {
      console.log('🧪 Running pytest on test file...');
      
      // Install pytest if not already installed
      const micropip = this.pyodide.pyimport('micropip');
      await micropip.install('pytest');
      
      // Write the test content to a temporary file
      this.pyodide.FS.writeFile(`/tmp/${testFileName}`, testContent, { encoding: 'utf8' });
      
      // Capture output
      let capturedOutput = '';
      
      // Run pytest with verbose output and better test discovery
      const result = this.pyodide.runPython(`
import subprocess
import sys
import os
import pytest
import unittest
from io import StringIO
import contextlib
import importlib
import types

# Change to tmp directory where the test file is
os.chdir('/tmp')

# Capture stdout/stderr
captured_output = StringIO()

result_dict = {}

try:
    # First, let's try to execute the test file and discover tests manually
    original_stdout = sys.stdout
    original_stderr = sys.stderr
    
    sys.stdout = captured_output
    sys.stderr = captured_output
    
    # Read and execute the test file content
    with open('${testFileName}', 'r') as f:
        test_code = f.read()
    
    # Create a module-like namespace for execution
    test_module = types.ModuleType('test_module')
    test_module.__file__ = '${testFileName}'
    test_module.__name__ = '__main__'
    
    # Execute the test code in the module namespace
    exec(test_code, test_module.__dict__)
    
    # Find test classes and methods
    test_classes = []
    for name, obj in test_module.__dict__.items():
        if (isinstance(obj, type) and 
            hasattr(obj, '__bases__') and 
            any(base.__name__ in ['TestCase', 'BlueprintTestCase'] for base in obj.__bases__)):
            test_classes.append((name, obj))
    
    if test_classes:
        print(f"Found {len(test_classes)} test class(es)")
        
        total_tests = 0
        passed_tests = 0
        failed_tests = 0
        
        for class_name, test_class in test_classes:
            # Get test methods (methods starting with 'test_')
            test_methods = [method for method in dir(test_class) 
                          if method.startswith('test_') and callable(getattr(test_class, method))]
            
            if test_methods:
                print(f"\\n{class_name}:")
                
                # Create instance of test class
                test_instance = test_class()
                
                # Run setUp if it exists
                if hasattr(test_instance, 'setUp'):
                    try:
                        test_instance.setUp()
                    except Exception as e:
                        print(f"  setUp failed: {e}")
                        continue
                
                # Run each test method
                import traceback
                for method_name in test_methods:
                    total_tests += 1
                    try:
                        method = getattr(test_instance, method_name)
                        method()
                        print(f"  {method_name} ... PASSED")
                        passed_tests += 1
                    except Exception as e:
                        print(traceback.format_exc())
                        print(f"  {method_name} ... FAILED: {e}")
                        failed_tests += 1
                
                # Run tearDown if it exists
                if hasattr(test_instance, 'tearDown'):
                    try:
                        test_instance.tearDown()
                    except Exception as e:
                        print(f"  tearDown failed: {e}")
        
        # Print summary
        print(f"\\n{'='*50}")
        if total_tests > 0:
            print(f"Ran {total_tests} test(s)")
            print(f"Passed: {passed_tests}, Failed: {failed_tests}")
            success = failed_tests == 0
        else:
            print("No test methods found")
            success = False
            
        result_dict = {
            'success': success,
            'output': captured_output.getvalue(),
            'exit_code': 0 if success else 1,
            'tests_run': total_tests,
            'tests_passed': passed_tests,
            'tests_failed': failed_tests
        }
    else:
        print("No test classes found")
        result_dict = {
            'success': False,
            'output': captured_output.getvalue() + "\\nNo test classes found",
            'exit_code': 1
        }
    
    # Restore stdout/stderr
    sys.stdout = original_stdout  
    sys.stderr = original_stderr
    
except Exception as e:
    # Restore stdout/stderr in case of exception
    sys.stdout = original_stdout
    sys.stderr = original_stderr
    
    result_dict = {
        'success': False,
        'output': captured_output.getvalue() + f"\\nError: {str(e)}",
        'error': str(e),
        'exit_code': -1
    }

# Return the result dictionary
result_dict
`);

      console.log('Raw Python result:', result);
      
      const testResult = result ? result.toJs({ dict_converter: Object.fromEntries }) : {};
      
      console.log('✅ Test execution completed', testResult);
      
      return {
        success: testResult.success || false,
        result: testResult.output || '',
        error: testResult.error || null,
        output: testResult.output || '',
        tests_run: testResult.tests_run || 0,
        tests_passed: testResult.tests_passed || 0,
        tests_failed: testResult.tests_failed || 0
      };
      
    } catch (error: any) {
      console.error('❌ Test execution failed:', error);
      return {
        success: false,
        error: error.message || 'Unknown error during test execution',
        output: `Test execution failed: ${error.message || error}`
      };
    }
  }
}

// Singleton instance
export const pyodideRunner = new PyodideRunner();
