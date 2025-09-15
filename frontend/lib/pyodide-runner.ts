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
  tests_run?: number;
  tests_passed?: number;
  tests_failed?: number;
  failure_details?: string[];
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
      'pytest',
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
    // Load common helper functions from shared utilities
    await this.pyodide.runPython(getHathorHelpers());

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
    from hathor.nanocontracts.types import Amount, Address, TokenUid, ContractId, VertexId, public, view
    print("✓ Basic nanocontracts imports successful")

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

    # Create global runner instance with memory storage
    try:
        # Create mock/minimal implementations
        settings = HathorSettings()  # Default settings
        reactor = get_global_reactor()  # Use the mock reactor
        tx_storage = MockTransactionStorage()
        node_store = MemoryNodeTrieStore()
        trie = PatriciaTrie(node_store)
        block_storage = NCBlockStorage(trie)

        storage_factory = NCStorageFactory()
        nc_runner = Runner(
            reactor=reactor,
            settings=settings,
            tx_storage=tx_storage,
            storage_factory=storage_factory,
            block_storage=block_storage,
            seed=_gen_random_bytes(32)
        )

        # Make runner globally available for tests
        import builtins
        builtins.nc_runner = nc_runner
        globals()['nc_runner'] = nc_runner
        globals()['settings'] = settings

        print("✓ Runner instance created and made globally available")
    except Exception as e:
        print(f"⚠️ Failed to create Runner instance: {e}")
        nc_runner = None

        # Make sure global is also set to None
        import builtins
        builtins.nc_runner = None
        globals()['nc_runner'] = None

except ImportError as e:
    print(f"❌ Failed to create Runner: {e}")
    raise e

print("✅ Hathor SDK environment loaded successfully")
`);
  }

  async compileContract(code: string, blueprint_name: string): Promise<{ success: boolean; blueprint_id?: string; error?: string }> {
    // XXX Not really compiling, but will leave named like this so we don't
    // need to change everything. We are basically deploying an on-chain blueprint.
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
    # TODO check blueprint code has __blueprint__ =

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

  async executeContract(request: any): Promise<ExecutionResult> {
    if (!this.pyodide) {
      await this.initialize();
      if (!this.pyodide) throw new Error('Failed to initialize Pyodide');
    }

    try {
      const { method_name, args, caller_address, code, actions } = request;
      let { contract_id } = request;

      // Check if this is an initialize call (uses blueprint_id) or method call (uses contract_id)
      let blueprint_id = contract_id; // For initialize, contract_id is actually blueprint_id

      if (method_name === 'initialize') {
        // Create new contract instance
        contract_id = this.generateId();
        // blueprint_id stays as the original contract_id (which was blueprint_id)
      }

      if (!code) {
        return { success: false, error: 'Contract code is required for method execution' };
      }
      // Determine method type by parsing the contract code
      const methodType = this.getMethodType(code, method_name)

      // Execute the method using real Runner
      const result = this.pyodide.runPython(`
try:
    # Check if we have the real Runner
    if nc_runner is not None:
        # Use the real Runner
        print("🚀 Using real Runner for execution")

        # Create context
        actions_list = _create_actions('''${JSON.stringify(actions || [])}''')
        context = _create_context(caller_address='${caller_address}', actions=actions_list)

        # Convert arguments and kwargs from JSON to Python objects
        args, kwargs = _convert_frontend_args('''${JSON.stringify(args)}''', '''${JSON.stringify(request.kwargs)}''')

        method_name = '${method_name}'
        method_type = '${methodType}'
        blueprint_id = bytes.fromhex('${blueprint_id}')
        contract_id = bytes.fromhex('${contract_id}')

        if method_name == 'initialize':
            # Initialize new contract
            print(f"🏗️ Initializing contract with args: {args}")

            # Use the runner to initialize the contract
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
            print(f"⚡ Executing method {method_name} with args {args} kwargs {kwargs}, type {method_type}")

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
                'output': f'Method {method_name} executed successfully using real Runner ({method_type})'
            }

    else:
        raise Exception("no runner found")

except Exception as e:
    import traceback
    traceback_str = traceback.format_exc()
    print(f"❌ Method execution traceback: {traceback_str}")
    execution_result = {
        'success': False,
        'error': e.__class__.__name__,
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
    const id = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    // make sure ids start with 0000...
    return '0000' + id.slice(4);
  }

  /**
   * Check if a method has @public or @view decorator by parsing the code string
   */
  private getMethodType(code: string, methodName: string): 'public' | 'view' | null {
    const lines = code.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Look for @public or @view decorators
      if (line.startsWith('@public') || line.startsWith('@view')) {
        // Check the next few lines for the method definition
        for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
          const nextLine = lines[j].trim();
          if (nextLine.startsWith(`def ${methodName}(`)) {
            return line.startsWith('@public') ? 'public' : 'view';
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

      // Write the test content to a temporary file
      this.pyodide.FS.writeFile(`/tmp/${testFileName}`, testContent, { encoding: 'utf8' });

      // Run actual pytest
      const result = this.pyodide.runPython(`
import subprocess
import sys
import os
import pytest
from io import StringIO
import tempfile

# Change to tmp directory where the test file is
os.chdir('/tmp')

# Clear Python module cache to ensure fresh test file is used
test_module_name = '${testFileName}'.replace('.py', '')
if test_module_name in sys.modules:
    del sys.modules[test_module_name]

# Also clear any cached bytecode files
import importlib
importlib.invalidate_caches()

# Capture stdout/stderr
captured_output = StringIO()

result_dict = {}
failure_details = []

try:
    # First, execute the test file to make sure it's valid Python
    original_stdout = sys.stdout
    original_stderr = sys.stderr

    sys.stdout = captured_output
    sys.stderr = captured_output

    with open('${testFileName}', 'r') as f:
        test_code = f.read()

    # Try to execute it to check for syntax errors
    compile(test_code, '${testFileName}', 'exec')

    # Run pytest and capture its output
    sys.stdout = captured_output
    sys.stderr = captured_output

    exit_code = pytest.main([
        '${testFileName}',
        '-v',              # Verbose output
    ])

    # Restore stdout/stderr
    sys.stdout = original_stdout
    sys.stderr = original_stderr

    output = captured_output.getvalue()  # Now this contains the actual pytest output
    success = exit_code == 0


    # Parse output for test counts
    lines = output.split('\\n')
    tests_run = 0
    tests_passed = 0
    tests_failed = 0

    # Count test results from pytest output
    for line in lines:
        if ' PASSED' in line:
            tests_passed += 1
            tests_run += 1
        elif ' FAILED' in line:
            tests_failed += 1
            tests_run += 1

    # If we couldn't parse counts from output, try the summary line
    if tests_run == 0:
        import re
        for line in lines:
            if 'failed' in line and 'passed' in line:
                # Parse line like "1 failed, 2 passed in 1.23s"
                failed_match = re.search(r'(\\d+) failed', line)
                passed_match = re.search(r'(\\d+) passed', line)
                if failed_match:
                    tests_failed = int(failed_match.group(1))
                if passed_match:
                    tests_passed = int(passed_match.group(1))
                tests_run = tests_failed + tests_passed
            elif 'passed' in line and 'failed' not in line:
                # Parse line like "3 passed in 1.23s"
                passed_match = re.search(r'(\\d+) passed', line)
                if passed_match:
                    tests_passed = int(passed_match.group(1))
                tests_run = tests_passed

    result_dict = {
        'success': success,
        'output': output,
        'exit_code': exit_code,
        'tests_run': tests_run,
        'tests_passed': tests_passed,
        'tests_failed': tests_failed
    }

    print(f"Pytest completed with exit code: {exit_code}")

except Exception as pytest_error:
    # Restore stdout/stderr
    sys.stdout = original_stdout
    sys.stderr = original_stderr

    result_dict = {
        'success': False,
        'output': captured_output.getvalue() + f"\\nPytest execution error: {str(pytest_error)}",
        'error': str(pytest_error),
        'exit_code': -1
    }

# Return the result dictionary
result_dict
`);

      const testResult = result ? result.toJs({ dict_converter: Object.fromEntries }) : {};
      return {
        success: testResult.success || false,
        result: testResult.output || '',
        error: testResult.error || null,
        output: testResult.output || '',
        tests_run: testResult.tests_run || 0,
        tests_passed: testResult.tests_passed || 0,
        tests_failed: testResult.tests_failed || 0,
        failure_details: testResult.failure_details || []
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
