/**
 * Client-side AI tool execution handlers
 *
 * These tools execute in the browser and have direct access to:
 * - Zustand store (for file management)
 * - Pyodide runner (for blueprint compilation, execution, testing)
 * - Browser localStorage (for persistence)
 *
 * Security: All execution happens client-side. The LLM calls are proxied
 * through Next.js API routes, but tools execute here in the browser.
 */

import { pyodideRunner } from './pyodide-runner';
import { beamClient } from './beam-client';
import { useIDEStore } from '@/store/ide-store';
import { GitService } from './git-service';
import type { File } from '@/store/ide-store';

export interface ToolResult {
  success: boolean;
  message: string;
  data?: any;
  error?: string;
}

/**
 * Client-side tool handlers for AI agent
 */
export class AIToolsClient {
  /**
   * List all files in the project
   */
  static async listFiles(path: string = '/'): Promise<ToolResult> {
    try {
      const files = useIDEStore.getState().files;

      const filteredFiles = files
        .filter(f => f.path.startsWith(path))
        .map(f => ({
          path: f.path,
          name: f.name,
          type: f.type,
          size: f.content.length,
        }));

      // Build a clear message with file paths
      const fileList = filteredFiles.map(f => `  ${f.path} (${f.type}, ${f.size} bytes)`).join('\n');

      const message = filteredFiles.length > 0
        ? `Found ${filteredFiles.length} files in ${path}:\n${fileList}`
        : `No files found in ${path}`;

      return {
        success: true,
        message,
        data: filteredFiles,
      };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to list files',
        error: String(error),
      };
    }
  }

  /**
   * Read a file's content by path
   */
  static async readFile(path: string): Promise<ToolResult> {
    try {
      const files = useIDEStore.getState().files;
      const file = files.find(f => f.path === path);

      if (!file) {
        // Try fuzzy matching by filename
        const filename = path.split('/').pop();
        const fuzzyMatch = files.find(f => f.name === filename);

        if (fuzzyMatch) {
          return {
            success: true,
            message: `Found file at ${fuzzyMatch.path}`,
            data: {
              path: fuzzyMatch.path,
              content: fuzzyMatch.content,
            },
          };
        }

        return {
          success: false,
          message: `File not found: ${path}`,
          error: `Available files: ${files.map(f => f.path).join(', ')}`,
        };
      }

      return {
        success: true,
        message: `Read ${path} (${file.content.length} bytes)`,
        data: {
          path: file.path,
          content: file.content,
        },
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to read file: ${path}`,
        error: String(error),
      };
    }
  }

  /**
   * Write/update a file's content
   */
  static async writeFile(path: string, content: string): Promise<ToolResult> {
    try {
      // Validate required parameters
      if (!path || path === 'undefined') {
        return {
          success: false,
          message: `❌ Missing required parameter: path`,
          error: 'The path parameter is required and must be a valid file path (e.g., /contracts/MyContract.py)',
        };
      }

      if (content === undefined || content === null) {
        return {
          success: false,
          message: `❌ Missing required parameter: content`,
          error: 'The content parameter is required and must contain the file contents',
        };
      }

      const { files, updateFile, addFile } = useIDEStore.getState();

      // Reject __init__.py files (Python package files not needed for blueprints)
      if (path.endsWith('__init__.py')) {
        return {
          success: false,
          message: `❌ Cannot create __init__.py files`,
          error: '__init__.py files are not needed for Hathor blueprints. Blueprint files should be standalone.',
        };
      }

      // Validate path
      const validPrefixes = ['/blueprints/', '/contracts/', '/tests/', '/dapp/'];
      if (!validPrefixes.some(prefix => path.startsWith(prefix))) {
        return {
          success: false,
          message: `Invalid path: ${path}`,
          error: `Files must start with: ${validPrefixes.join(', ')}`,
        };
      }

      // Find existing file
      const existingFile = files.find(f => f.path === path);

      if (existingFile) {
        // Update existing file
        updateFile(existingFile.id, content);
        return {
          success: true,
          message: `✅ Updated ${path}`,
          data: { path, action: 'updated' },
        };
      } else {
        // Create new file
        const fileName = path.split('/').pop() || 'untitled';
        const fileType = path.startsWith('/blueprints/') || path.startsWith('/contracts/')
          ? 'contract'
          : path.startsWith('/tests/')
          ? 'test'
          : 'component';

        const newFile: Omit<File, 'id'> = {
          name: fileName,
          path: path,
          content: content,
          type: fileType,
          language: path.endsWith('.py') ? 'python' : path.endsWith('.ts') ? 'typescript' : path.endsWith('.tsx') ? 'typescriptreact' : 'json',
        };

        addFile(newFile);

        return {
          success: true,
          message: `✅ Created ${path}`,
          data: { path, action: 'created' },
        };
      }
    } catch (error) {
      return {
        success: false,
        message: `Failed to write file: ${path}`,
        error: String(error),
      };
    }
  }

  /**
   * Delete a file by path
   */
  static async deleteFile(path: string): Promise<ToolResult> {
    try {
      const { files, deleteFile } = useIDEStore.getState();

      // Find the file by path
      const file = files.find(f => f.path === path);

      if (!file) {
        return {
          success: false,
          message: `❌ File not found: ${path}`,
          error: `Cannot delete non-existent file. Available files: ${files.map(f => f.path).join(', ')}`,
        };
      }

      // Delete the file
      deleteFile(file.id);

      return {
        success: true,
        message: `✅ Deleted ${path}`,
        data: { path, action: 'deleted' },
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to delete file: ${path}`,
        error: String(error),
      };
    }
  }

  /**
   * Get project structure as a tree
   */
  static async getProjectStructure(): Promise<ToolResult> {
    try {
      const files = useIDEStore.getState().files;

      const blueprints = files.filter(f =>
        f.path.startsWith('/blueprints/') || f.path.startsWith('/contracts/')
      );
      const tests = files.filter(f => f.path.startsWith('/tests/'));
      const dapps = files.filter(f => f.path.startsWith('/dapp/'));

      const structure = {
        blueprints: blueprints.map(f => f.path),
        tests: tests.map(f => f.path),
        dapps: dapps.map(f => f.path),
        total: files.length,
      };

      const message = [
        '📁 Project Structure:',
        '',
        `📜 Blueprints (${blueprints.length}):`,
        ...blueprints.map(f => `  ${f.path}`),
        '',
        `🧪 Tests (${tests.length}):`,
        ...tests.map(f => `  ${f.path}`),
        '',
        `🌐 dApp (${dapps.length}):`,
        ...dapps.map(f => `  ${f.path}`),
      ].join('\n');

      return {
        success: true,
        message,
        data: structure,
      };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to get project structure',
        error: String(error),
      };
    }
  }

  /**
   * Compile a blueprint contract in Pyodide
   */
  static async compileBlueprint(path: string): Promise<ToolResult> {
    try {
      const files = useIDEStore.getState().files;
      const file = files.find(f => f.path === path);

      if (!file) {
        return {
          success: false,
          message: `File not found: ${path}`,
          error: 'Cannot compile non-existent file',
        };
      }

      // Validate it's a blueprint file
      if (!path.startsWith('/blueprints/') && !path.startsWith('/contracts/')) {
        return {
          success: false,
          message: `Invalid blueprint path: ${path}`,
          error: 'Blueprints must be in /blueprints/ or /contracts/',
        };
      }

      // Initialize Pyodide if needed
      await pyodideRunner.initialize();

      // Compile the blueprint
      const result = await pyodideRunner.compileContract(
        file.content,
        file.name.replace('.py', '')
      );

      if (result.success) {
        // Store the compiled contract
        const { setCompiledContract } = useIDEStore.getState() as any;
        setCompiledContract(file.id, result.blueprint_id!);

        return {
          success: true,
          message: `✅ Compiled ${path}\nBlueprint ID: ${result.blueprint_id}`,
          data: {
            blueprint_id: result.blueprint_id,
            path,
          },
        };
      } else {
        return {
          success: false,
          message: `❌ Compilation failed for ${path}`,
          error: result.error || 'Unknown compilation error',
          data: {
            traceback: result.traceback,
          },
        };
      }
    } catch (error) {
      return {
        success: false,
        message: `Failed to compile blueprint: ${path}`,
        error: String(error),
      };
    }
  }

  /**
   * Execute a blueprint method in Pyodide
   */
  static async executeMethod(
    path: string,
    methodName: string,
    args: any[] = [],
    callerAddress?: string
  ): Promise<ToolResult> {
    try {
      const files = useIDEStore.getState().files;
      const file = files.find(f => f.path === path);

      if (!file) {
        return {
          success: false,
          message: `File not found: ${path}`,
          error: 'Cannot execute method on non-existent file',
        };
      }

      // Get contract instance or blueprint ID
      const { contractInstances, compiledContracts } = useIDEStore.getState();
      let contractId = contractInstances[file.id]?.contractId;

      // If no contract instance and it's initialize, use blueprint_id
      if (!contractId) {
        // Find the compiled contract for THIS specific file by fileId
        const compiled = compiledContracts.find(c => c.fileId === file.id);
        if (methodName === 'initialize' && compiled) {
          contractId = compiled.blueprint_id;
        } else {
          return {
            success: false,
            message: `No contract instance found for ${path}`,
            error: methodName === 'initialize'
              ? 'Compile the blueprint first using compile_blueprint()'
              : 'Compile the blueprint and call initialize() first',
          };
        }
      }

      // Initialize Pyodide if needed
      await pyodideRunner.initialize();

      console.log(`[execute_method] Executing ${methodName} on ${path}`);
      console.log(`[execute_method] Args:`, args);
      console.log(`[execute_method] Contract ID:`, contractId);

      // Execute the method
      const result = await pyodideRunner.executeContract({
        contract_id: contractId,
        method_name: methodName,
        args,
        code: file.content,
        caller_address: callerAddress || 'WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp',
        actions: [],
      });

      if (result.success) {
        // If it was initialize, store the contract instance
        if (methodName === 'initialize' && result.contract_id) {
          const { setContractInstance } = useIDEStore.getState() as any;
          setContractInstance(file.id, {
            contractId: result.contract_id,
            blueprintId: contractId,
          });
        }

        return {
          success: true,
          message: `✅ Executed ${methodName}() on ${path}`,
          data: {
            result: result.result,
            output: result.output,
            contract_id: result.contract_id,
          },
        };
      } else {
        // Provide detailed error information
        const errorMsg = [
          `❌ Execution failed: ${methodName}()`,
          ``,
          `Error: ${result.error || 'Unknown error'}`,
          result.traceback ? `\nTraceback:\n${result.traceback}` : '',
        ].filter(Boolean).join('\n');

        console.error(`[execute_method] Execution failed:`, result);

        return {
          success: false,
          message: errorMsg,
          error: result.error || 'Unknown execution error',
          data: {
            traceback: result.traceback,
            args_received: args,
            method_name: methodName,
          },
        };
      }
    } catch (error) {
      return {
        success: false,
        message: `Failed to execute method: ${methodName}`,
        error: String(error),
      };
    }
  }

  /**
   * Run tests for a blueprint in Pyodide
   */
  static async runTests(testPath: string): Promise<ToolResult> {
    try {
      const files = useIDEStore.getState().files;
      const testFile = files.find(f => f.path === testPath);

      if (!testFile) {
        return {
          success: false,
          message: `Test file not found: ${testPath}`,
          error: 'Cannot run non-existent test file',
        };
      }

      // Validate it's a test file
      if (!testPath.startsWith('/tests/')) {
        return {
          success: false,
          message: `Invalid test path: ${testPath}`,
          error: 'Test files must be in /tests/',
        };
      }

      // Initialize Pyodide if needed
      await pyodideRunner.initialize();

      // Get all contract files (files in /contracts/ or /blueprints/)
      const contractFiles = files.filter(f =>
        (f.path.startsWith('/contracts/') || f.path.startsWith('/blueprints/')) &&
        f.type === 'contract'
      );

      // Run the tests, passing both the test file and contract files
      // The runner will create the proper filesystem structure
      const result = await pyodideRunner.runTests(
        testFile.content,
        testFile.name,
        contractFiles
      );

      if (result.success) {
        const passRate = result.tests_run
          ? `${result.tests_passed}/${result.tests_run} passed`
          : 'unknown';

        return {
          success: true,
          message: `✅ Tests completed: ${passRate}\n\n${result.output}`,
          data: {
            tests_run: result.tests_run,
            tests_passed: result.tests_passed,
            tests_failed: result.tests_failed,
            output: result.output,
          },
        };
      } else {
        return {
          success: false,
          message: `❌ Tests failed`,
          error: result.error || 'Unknown test error',
          data: {
            output: result.output,
            traceback: result.traceback,
            failure_details: result.failure_details,
          },
        };
      }
    } catch (error) {
      return {
        success: false,
        message: `Failed to run tests: ${testPath}`,
        error: String(error),
      };
    }
  }

  /**
   * Validate a blueprint's structure and syntax
   */
  static async validateBlueprint(path: string): Promise<ToolResult> {
    try {
      const files = useIDEStore.getState().files;
      const file = files.find(f => f.path === path);

      if (!file) {
        return {
          success: false,
          message: `File not found: ${path}`,
          error: 'Cannot validate non-existent file',
        };
      }

      const code = file.content;
      const issues: string[] = [];

      // Basic validation checks
      if (!code.includes('from hathor') && !code.includes('import hathor')) {
        issues.push('⚠️ Missing Hathor imports');
      }

      if (!code.includes('class ')) {
        issues.push('❌ No class definition found');
      }

      if (!code.includes('__blueprint__')) {
        issues.push('❌ Missing __blueprint__ export');
      }

      if (!code.includes('@public') && !code.includes('@view')) {
        issues.push('⚠️ No @public or @view methods found');
      }

      if (!code.includes('def initialize')) {
        issues.push('⚠️ No initialize() method found');
      }

      if (code.includes('def __init__')) {
        issues.push('❌ Found __init__! Use initialize() instead');
      }

      // Check for container field assignments (critical error)
      const containerPatterns = [/self\.\w+\s*=\s*\{\}/, /self\.\w+\s*=\s*\[\]/, /self\.\w+\s*=\s*set\(\)/];
      for (const pattern of containerPatterns) {
        if (pattern.test(code)) {
          issues.push('❌ CRITICAL: Container field assignment detected. Container fields auto-initialize!');
          break;
        }
      }

      if (issues.length === 0) {
        return {
          success: true,
          message: `✅ ${path} passed validation!`,
          data: { valid: true },
        };
      } else {
        return {
          success: false,
          message: `🔍 Validation issues found in ${path}:\n\n${issues.map(i => `  ${i}`).join('\n')}`,
          data: { valid: false, issues },
        };
      }
    } catch (error) {
      return {
        success: false,
        message: `Failed to validate blueprint: ${path}`,
        error: String(error),
      };
    }
  }

  /**
   * List all methods in a blueprint
   */
  static async listMethods(path: string): Promise<ToolResult> {
    try {
      const files = useIDEStore.getState().files;
      const file = files.find(f => f.path === path);

      if (!file) {
        return {
          success: false,
          message: `File not found: ${path}`,
          error: 'Cannot list methods for non-existent file',
        };
      }

      const code = file.content;
      const lines = code.split('\n');

      const publicMethods: string[] = [];
      const viewMethods: string[] = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (line.includes('@public') || line.includes('@view')) {
          const decorator = line.includes('@public') ? 'public' : 'view';

          // Find method definition in next few lines
          for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
            const methodLine = lines[j].trim();
            if (methodLine.startsWith('def ')) {
              if (decorator === 'public') {
                publicMethods.push(methodLine);
              } else {
                viewMethods.push(methodLine);
              }
              break;
            }
          }
        }
      }

      const message = [
        `Methods in ${path}:`,
        '',
        `📝 @public methods (${publicMethods.length}):`,
        ...publicMethods.map(m => `  ${m}`),
        '',
        `👁️  @view methods (${viewMethods.length}):`,
        ...viewMethods.map(m => `  ${m}`),
      ].join('\n');

      return {
        success: true,
        message,
        data: {
          public: publicMethods,
          view: viewMethods,
        },
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to list methods: ${path}`,
        error: String(error),
      };
    }
  }

  // ========== DAPP TOOLS (BEAM SANDBOX) ==========

  /**
   * Create Hathor dApp using official create-hathor-dapp template
   */
  static async createHathorDapp(
    appName?: string,
    walletConnectId?: string,
    network?: 'mainnet' | 'testnet'
  ): Promise<ToolResult> {
    try {
      const { activeProjectId, addConsoleMessage } = useIDEStore.getState();

      if (!activeProjectId) {
        return {
          success: false,
          message: 'No active project',
          error: 'Select or create a project first',
        };
      }

      const resolvedAppName = (appName && String(appName).trim()) || 'hathor-dapp';
      const resolvedNetwork = (network as string) || 'testnet';
      // Default WC ID mirrors docs/prompts recommendation; can be overridden by args
      const resolvedWC = (walletConnectId && String(walletConnectId).trim()) || '8264fff563181da658ce64ee80e80458';

      addConsoleMessage?.('info', `🚀 Scaffolding Hathor dApp: ${resolvedAppName} (${resolvedNetwork})`);

      // Clean up any existing directory first - use more forceful approach
      // First check if directory exists, then remove it with multiple fallback strategies
      const checkDirCmd = `cd /app && test -d ${resolvedAppName} && echo "exists" || echo "not_exists"`;
      const checkResult = await AIToolsClient.runCommand(checkDirCmd);
      
      if (checkResult.data?.stdout?.includes('exists')) {
        addConsoleMessage?.('info', `🧹 Cleaning up existing ${resolvedAppName} directory...`);
        
        // Try multiple cleanup strategies
        const cleanupCommands = [
          `cd /app && rm -rf ${resolvedAppName}`,
          `cd /app && chmod -R u+w ${resolvedAppName} 2>/dev/null; rm -rf ${resolvedAppName}`,
          `cd /app && find ${resolvedAppName} -delete 2>/dev/null; rm -rf ${resolvedAppName}`,
        ];
        
        let cleanupSuccess = false;
        for (const cleanupCmd of cleanupCommands) {
          const cleanupResult = await AIToolsClient.runCommand(cleanupCmd);
          // Check if directory still exists
          const verifyCmd = `cd /app && test -d ${resolvedAppName} && echo "exists" || echo "not_exists"`;
          const verifyResult = await AIToolsClient.runCommand(verifyCmd);
          if (verifyResult.data?.stdout?.includes('not_exists')) {
            cleanupSuccess = true;
            break;
          }
        }
        
        if (!cleanupSuccess) {
          addConsoleMessage?.('warning', `⚠️ Could not fully remove ${resolvedAppName}, but continuing...`);
        }
      }

      // Execute scaffold command in sandbox (skip git init - we'll manage git ourselves)
      const cmd = `cd /app && npx create-hathor-dapp@latest ${resolvedAppName} --yes --wallet-connect-id=${resolvedWC} --network=${resolvedNetwork} --skip-git`;
      const execResult = await AIToolsClient.runCommand(cmd);

      console.log('create-hathor-dapp result:', {
        success: execResult.success,
        exit_code: execResult.data?.exit_code,
        stdout: execResult.data?.stdout?.slice(0, 200),
        stderr: execResult.data?.stderr?.slice(0, 200),
      });

      // Check if command succeeded or if dApp was created despite warnings
      const exitCode = execResult.data?.exit_code;
      const hasErrors = exitCode !== '0' && exitCode !== 0;
      const hasStderr = execResult.data?.stderr && execResult.data?.stderr.trim().length > 0;

      // If there's a real error (not just git init failure), fail
      if (hasErrors && hasStderr && !execResult.data?.stderr?.includes('Failed to initialize git repository')) {
        const errorMsg = execResult.data?.stderr || execResult.data?.stdout || 'Unknown error';
        console.error('create-hathor-dapp failed with non-zero exit code:', {
          exit_code: execResult.data?.exit_code,
          stdout: execResult.data?.stdout,
          stderr: execResult.data?.stderr,
        });
        return {
          success: false,
          message: `❌ Failed to scaffold dApp: ${resolvedAppName}\nError: ${errorMsg}`,
          error: errorMsg,
        };
      }

      // Check if dApp directory was actually created successfully
      const checkPackageCmd = `cd /app && ls -la ${resolvedAppName}/package.json 2>/dev/null || echo "missing"`;
      const checkPackageResult = await AIToolsClient.runCommand(checkPackageCmd);
      const packageExists = checkPackageResult.data?.stdout && !checkPackageResult.data?.stdout.includes('missing');

      if (!packageExists) {
        return {
          success: false,
          message: `❌ Failed to scaffold dApp: ${resolvedAppName}\nDirectory or package.json not found`,
          error: 'Package.json not found after scaffolding',
        };
      }

      // Note: Sync will be handled by the agent calling sync_dapp tool separately
      // This ensures the sync runs in the frontend context where useIDEStore works

      // Provide next steps
      const nextSteps = [
        `✅ Scaffolded with create-hathor-dapp in /app/${resolvedAppName}`,
        `🔄 Run sync_dapp() to sync files back to IDE`,
        `▶️ To run in sandbox: use restart_dev_server()`,
        `🌐 To get URL: use get_sandbox_url()`,
      ].join('\n');

      return {
        success: true,
        message: nextSteps,
        data: {
          app_name: resolvedAppName,
          network: resolvedNetwork,
          wallet_connect_id: resolvedWC,
          scaffold: execResult.data,
        },
      };
    } catch (error) {
      return {
        success: false,
        message: '❌ Failed to create Hathor dApp',
        error: String(error),
      };
    }
  }

  /**
   * Deploy dApp files to BEAM sandbox (with proper sync)
   */
  static async deployDApp(): Promise<ToolResult> {
    try {
      const { activeProjectId, addConsoleMessage } = useIDEStore.getState();

      if (!activeProjectId) {
        return {
          success: false,
          message: 'No active project',
          error: 'Select or create a project first',
        };
      }

      addConsoleMessage?.('info', '🚀 Deploying dApp to BEAM sandbox...');

      // Start streaming build logs (will connect and wait for sandbox creation)
      let buildLogStream: EventSource | null = null;
      try {
        buildLogStream = beamClient.streamBuildLogs(
          activeProjectId,
          (log) => {
            // Display each build log line in console
            addConsoleMessage?.('info', log);
          },
          (error) => {
            console.error('Build log stream error:', error);
          },
          () => {
            console.log('Build log stream completed');
          }
        );
      } catch (streamError) {
        console.warn('Failed to start build log stream:', streamError);
        // Continue anyway - build logs are nice-to-have
      }

      // Try to sync files to sandbox (best effort - don't fail deployment if sync fails)
      let syncResult: ToolResult | null = null;
      try {
        syncResult = await AIToolsClient.syncDApp('ide-to-sandbox');
        if (!syncResult.success) {
          console.warn('File sync failed during deployment, continuing anyway:', syncResult.error);
          addConsoleMessage?.('warning', '⚠️ File sync failed, but continuing with deployment');
        }
      } catch (syncError) {
        console.warn('File sync error during deployment:', syncError);
        addConsoleMessage?.('warning', '⚠️ File sync encountered an error, but continuing with deployment');
      }

      // Start dev server (if not already running)
      let devServerResult: ToolResult | null = null;
      try {
        devServerResult = await AIToolsClient.restartDevServer();
        if (devServerResult.success) {
          addConsoleMessage?.('success', `🌐 Dev server running at: ${devServerResult.data.url}`);
        }
      } catch (devError) {
        console.warn('Failed to start dev server:', devError);
        // Don't fail the deployment if dev server fails
      }

      // Close build log stream after deployment
      if (buildLogStream) {
        buildLogStream.close();
      }

      // Return success even if some parts failed (as long as we got this far)
      const deploymentMessage = syncResult?.success
        ? `✅ dApp deployed with proper sync!\n\n${syncResult.message}`
        : '✅ dApp deployed (sync had issues but deployment continued)';

      return {
        success: true,
        message: deploymentMessage,
        data: {
          syncResult,
          devServerResult,
          url: devServerResult?.data?.url || null,
        },
      };
    } catch (error) {
      return {
        success: false,
        message: '❌ Failed to deploy dApp',
        error: String(error),
      };
    }
  }

  /**
   * Upload specific files to BEAM sandbox
   */
  static async uploadFiles(paths: string[]): Promise<ToolResult> {
    try {
      const { files, activeProjectId, addConsoleMessage } = useIDEStore.getState();

      if (!activeProjectId) {
        return {
          success: false,
          message: 'No active project',
          error: 'Select or create a project first',
        };
      }

      // Get the specified files
      const filesToUpload = files.filter(f => paths.includes(f.path));

      if (filesToUpload.length === 0) {
        return {
          success: false,
          message: `No files found for paths: ${paths.join(', ')}`,
          error: 'Check file paths',
        };
      }

      // Convert to Record<string, string>
      const filesMap: Record<string, string> = {};
      filesToUpload.forEach(f => {
        filesMap[f.path] = f.content;
      });

      addConsoleMessage?.('info', `📤 Uploading ${filesToUpload.length} files to sandbox...`);

      // Upload to BEAM
      await beamClient.uploadFiles(activeProjectId, filesMap);

      return {
        success: true,
        message: `✅ Uploaded ${filesToUpload.length} files to sandbox`,
        data: {
          files: filesToUpload.map(f => f.path),
        },
      };
    } catch (error) {
      return {
        success: false,
        message: '❌ Failed to upload files',
        error: String(error),
      };
    }
  }

  /**
   * Get BEAM sandbox URL for current project
   */
  static async getSandboxUrl(): Promise<ToolResult> {
    try {
      const { activeProjectId } = useIDEStore.getState();

      if (!activeProjectId) {
        return {
          success: false,
          message: 'No active project',
          error: 'Select or create a project first',
        };
      }

      const sandbox = await beamClient.getSandbox(activeProjectId);

      if (!sandbox) {
        return {
          success: false,
          message: 'No sandbox found for this project',
          error: 'Deploy the dApp first using deploy_dapp()',
        };
      }

      return {
        success: true,
        message: `🌐 Sandbox URL: ${sandbox.url}`,
        data: {
          url: sandbox.url,
          sandbox_id: sandbox.sandbox_id,
          project_id: sandbox.project_id,
        },
      };
    } catch (error) {
      return {
        success: false,
        message: '❌ Failed to get sandbox URL',
        error: String(error),
      };
    }
  }

  /**
   * Start or restart the dev server in BEAM sandbox
   */
  static async restartDevServer(): Promise<ToolResult> {
    try {
      const { activeProjectId, addConsoleMessage } = useIDEStore.getState();

      if (!activeProjectId) {
        return {
          success: false,
          message: 'No active project',
          error: 'Select or create a project first',
        };
      }

      addConsoleMessage?.('info', '🔄 Restarting dev server...');

      const result = await beamClient.startDevServer(activeProjectId);

      return {
        success: true,
        message: `✅ Dev server restarted!\n\nURL: ${result.url}`,
        data: result,
      };
    } catch (error) {
      return {
        success: false,
        message: '❌ Failed to restart dev server',
        error: String(error),
      };
    }
  }

  /**
   * Bootstrap a new Next.js project (creates files in /dapp/)
   */
  static async bootstrapNextJS(
    useTypeScript: boolean = true,
    useTailwind: boolean = true
  ): Promise<ToolResult> {
    try {
      const { addFile, activeProjectId } = useIDEStore.getState();

      if (!activeProjectId) {
        return {
          success: false,
          message: 'No active project',
          error: 'Select or create a project first',
        };
      }

      // Create basic Next.js file structure
      const files: Array<Omit<File, 'id'>> = [];

      // package.json
      files.push({
        name: 'package.json',
        path: '/dapp/package.json',
        content: JSON.stringify(
          {
            name: 'hathor-dapp',
            version: '0.1.0',
            private: true,
            scripts: {
              dev: 'next dev',
              build: 'next build',
              start: 'next start',
              lint: 'next lint',
            },
            dependencies: {
              next: '15.1.6',
              react: '19.0.0',
              'react-dom': '19.0.0',
              ...(useTailwind && {
                tailwindcss: '^3.4.1',
                autoprefixer: '^10.4.17',
                postcss: '^8.4.33',
              }),
            },
            ...(useTypeScript && {
              devDependencies: {
                '@types/node': '^20',
                '@types/react': '^19',
                '@types/react-dom': '^19',
                typescript: '^5',
              },
            }),
          },
          null,
          2
        ),
        type: 'config' as const,
        language: 'json' as const,
      });

      // next.config.js
      files.push({
        name: useTypeScript ? 'next.config.ts' : 'next.config.js',
        path: `/dapp/next.config.${useTypeScript ? 'ts' : 'js'}`,
        content: useTypeScript
          ? `import type { NextConfig } from 'next';\n\nconst nextConfig: NextConfig = {};\n\nexport default nextConfig;`
          : `/** @type {import('next').NextConfig} */\nconst nextConfig = {};\n\nmodule.exports = nextConfig;`,
        type: 'config' as const,
        language: useTypeScript ? 'typescript' : 'javascript' as any,
      });

      // app/page.tsx
      const ext = useTypeScript ? 'tsx' : 'jsx';
      files.push({
        name: `page.${ext}`,
        path: `/dapp/app/page.${ext}`,
        content: `export default function Home() {
  return (
    <div${useTailwind ? ' className="min-h-screen p-8"' : ''}>
      <h1${useTailwind ? ' className="text-4xl font-bold"' : ''}>Welcome to Hathor dApp</h1>
      <p${useTailwind ? ' className="mt-4"' : ''}>Start building your decentralized application!</p>
    </div>
  );
}`,
        type: 'component' as const,
        language: useTypeScript ? 'typescriptreact' : 'javascript' as any,
      });

      // app/layout.tsx
      files.push({
        name: `layout.${ext}`,
        path: `/dapp/app/layout.${ext}`,
        content: `${useTypeScript ? 'import type { Metadata } from "next";\n' : ''}${
          useTailwind ? 'import "./globals.css";\n' : ''
        }
${useTypeScript ? 'export const metadata: Metadata = {\n  title: "Hathor dApp",\n  description: "Built with Hathor Playground",\n};\n\n' : ''}export default function RootLayout({
  children,
}${useTypeScript ? ': { children: React.ReactNode }' : ''}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}`,
        type: 'component' as const,
        language: useTypeScript ? 'typescriptreact' : 'javascript' as any,
      });

      if (useTailwind) {
        // tailwind.config.ts
        files.push({
          name: 'tailwind.config.ts',
          path: '/dapp/tailwind.config.ts',
          content: `import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
export default config;`,
          type: 'config' as const,
          language: 'typescript' as const,
        });

        // app/globals.css
        files.push({
          name: 'globals.css',
          path: '/dapp/app/globals.css',
          content: `@tailwind base;
@tailwind components;
@tailwind utilities;`,
          type: 'style' as const,
          language: 'css' as const,
        });
      }

      if (useTypeScript) {
        // tsconfig.json
        files.push({
          name: 'tsconfig.json',
          path: '/dapp/tsconfig.json',
          content: JSON.stringify(
            {
              compilerOptions: {
                target: 'ES2017',
                lib: ['dom', 'dom.iterable', 'esnext'],
                allowJs: true,
                skipLibCheck: true,
                strict: true,
                noEmit: true,
                esModuleInterop: true,
                module: 'esnext',
                moduleResolution: 'bundler',
                resolveJsonModule: true,
                isolatedModules: true,
                jsx: 'preserve',
                incremental: true,
                plugins: [{ name: 'next' }],
                paths: { '@/*': ['./*'] },
              },
              include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts'],
              exclude: ['node_modules'],
            },
            null,
            2
          ),
          type: 'config' as const,
          language: 'json' as const,
        });
      }

      // Add all files to store
      files.forEach(file => addFile(file));

      return {
        success: true,
        message: `✅ Created Next.js project with ${files.length} files\n\nFiles created:\n${files.map(f => `  ${f.path}`).join('\n')}\n\nNext steps:\n1. Deploy with deploy_dapp()\n2. Open the sandbox URL to see your app`,
        data: {
          files_created: files.length,
          typescript: useTypeScript,
          tailwind: useTailwind,
        },
      };
    } catch (error) {
      return {
        success: false,
        message: '❌ Failed to bootstrap Next.js project',
        error: String(error),
      };
    }
  }

  /**
   * Run a shell command in the BEAM sandbox
   */
  static async runCommand(command: string): Promise<ToolResult> {
    try {
      const { activeProjectId, addConsoleMessage } = useIDEStore.getState();

      if (!activeProjectId) {
        return {
          success: false,
          message: 'No active project',
          error: 'Select or create a project first',
        };
      }

      addConsoleMessage?.('info', `$ ${command}`);

      const response = await fetch(`/api/beam/sandbox/${activeProjectId}/command`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ command }),
      });

      if (!response.ok) {
        const error = await response.json();
        return {
          success: false,
          message: '❌ Command failed',
          error: error.error || response.statusText,
        };
      }

      const result = await response.json();

      // Display stdout
      if (result.stdout) {
        addConsoleMessage?.('info', result.stdout);
      }

      // Display stderr if present
      if (result.stderr) {
        addConsoleMessage?.('error', result.stderr);
      }

      return {
        success: true,
        message: `✅ Command executed successfully`,
        data: result,
      };
    } catch (error) {
      return {
        success: false,
        message: '❌ Failed to run command',
        error: String(error),
      };
    }
  }

  /**
   * Git-based sync between IDE and BEAM sandbox
   */
  static async syncDApp(
    direction: 'ide-to-sandbox' | 'sandbox-to-ide' | 'bidirectional' = 'bidirectional',
    projectId?: string
  ): Promise<ToolResult> {
    try {
      // Get project ID from parameter or store (for API route vs tool calls)
      const activeProjectId = projectId || useIDEStore.getState().activeProjectId;
      const {
        files: ideFiles,
        addFile,
        updateFile,
        deleteFile,
        addConsoleMessage,
        getLastSyncedCommitHash,
        setLastSyncedCommitHash,
        isGitInitialized,
        setGitInitialized,
      } = useIDEStore.getState();

      if (!activeProjectId) {
        return {
          success: false,
          message: 'No active project',
          error: 'Select or create a project first',
        };
      }

      addConsoleMessage?.('info', `🔄 Starting git-based ${direction} sync...`);

      // Get only /dapp/ files
      const dappFiles = ideFiles.filter((f) => f.path.startsWith('/dapp/'));

      // Step 1: Ensure git is initialized in both locations
      const ideGitInitialized = await GitService.isInitialized(activeProjectId);
      if (!ideGitInitialized) {
        addConsoleMessage?.('info', '📦 Initializing git repository in IDE...');
        await GitService.initRepo(activeProjectId);
        setGitInitialized(activeProjectId, true);
      }

      // Helper function to call git API
      const callGitAPI = async (operation: string, args: any = {}) => {
        const response = await fetch(`/api/beam/sandbox/${activeProjectId}/git`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ operation, ...args }),
        });
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Git operation failed');
        }
        return response.json();
      };

      try {
        await callGitAPI('ensureGitRepo');
      } catch (error) {
        addConsoleMessage?.('error', `⚠️ Failed to ensure git in sandbox: ${error}`);
        // Continue anyway, might be first sync
      }

      // Step 2: Get last synced commit hash
      const lastSyncedHash = getLastSyncedCommitHash(activeProjectId);
      console.log(`[SYNC] Last synced hash: ${lastSyncedHash || 'null (first sync)'}`);

      // Step 3: Handle first sync differently (no last synced hash)
      let sandboxHeadHash: string | null = null;
      
      if (!lastSyncedHash) {
        console.log(`[SYNC] ========== FIRST SYNC PATH ==========`);
        addConsoleMessage?.('info', '🆕 First sync detected, establishing baseline...');

        // Commit current IDE state as baseline
        if (dappFiles.length > 0) {
          await GitService.commit(activeProjectId, 'Initial IDE state', dappFiles);
        }

        // Sync files first, then commit to establish baseline
        if (direction === 'ide-to-sandbox' || direction === 'bidirectional') {
          // Push IDE files to sandbox
          const ideFilesToUpload: Record<string, string> = {};
          for (const file of dappFiles) {
            const sandboxPath = file.path.replace('/dapp/', '/app/');
            ideFilesToUpload[sandboxPath] = file.content;
          }
          if (Object.keys(ideFilesToUpload).length > 0) {
            await beamClient.uploadFiles(activeProjectId, ideFilesToUpload, false);
            // Commit the uploaded files to establish baseline
            const commitResult = await callGitAPI('commitSandboxState', { message: 'Initial sync from IDE' });
            sandboxHeadHash = commitResult.commitHash || null;
          }
        }

        if (direction === 'sandbox-to-ide' || direction === 'bidirectional') {
          // Pull sandbox files to IDE
          addConsoleMessage?.('info', '📥 Fetching files from sandbox...');
          
          // First, verify files exist in sandbox by checking for common dApp files
          try {
            const testCmd = `cd /app && find . -name "package.json" -o -name "*.tsx" -o -name "*.ts" | head -5`;
            const testResult = await AIToolsClient.runCommand(testCmd);
            console.log(`[SYNC] Test find command result:`, testResult.data?.stdout);
            addConsoleMessage?.('info', `🔍 Checking for files: ${testResult.data?.stdout || 'no output'}`);
          } catch (error) {
            console.warn('[SYNC] Test command failed:', error);
          }
          
          console.log(`[SYNC] Fetching files from sandbox API: /api/beam/sandbox/${activeProjectId}/files`);
          const sandboxResponse = await fetch(`/api/beam/sandbox/${activeProjectId}/files`);
          console.log(`[SYNC] Sandbox response status: ${sandboxResponse.status}`);
          
          if (sandboxResponse.ok) {
            let sandboxData;
            try {
              sandboxData = await sandboxResponse.json();
            } catch (parseError) {
              console.error(`[SYNC] Failed to parse JSON response:`, parseError);
              const textResponse = await sandboxResponse.text();
              console.error(`[SYNC] Raw response text:`, textResponse.slice(0, 500));
              throw new Error('Failed to parse API response');
            }
            
            console.log(`[SYNC] Raw API response:`, {
              hasFiles: !!sandboxData.files,
              filesKeys: sandboxData.files ? Object.keys(sandboxData.files) : [],
              filesCount: sandboxData.files ? Object.keys(sandboxData.files).length : 0,
              sampleKeys: sandboxData.files ? Object.keys(sandboxData.files).slice(0, 5) : [],
              debug: sandboxData.debug,
            });
            const sandboxFiles = sandboxData.files || {};
            
            console.log(`[SYNC] Sandbox files keys (first 20):`, Object.keys(sandboxFiles).slice(0, 20));
            console.log(`[SYNC] Total files in response: ${Object.keys(sandboxFiles).length}`);
            addConsoleMessage?.('info', `📦 Found ${Object.keys(sandboxFiles).length} files in sandbox`);
            
            if (Object.keys(sandboxFiles).length === 0) {
              console.warn(`[SYNC] WARNING: API returned success but no files! Debug info:`, sandboxData.debug);
              addConsoleMessage?.('warning', '⚠️ API returned no files - check server logs for details');
              console.log(`[SYNC] ========== EXITING: NO FILES ==========`);
            } else {
              console.log(`[SYNC] ========== PROCESSING ${Object.keys(sandboxFiles).length} FILES ==========`);
              console.log(`[SYNC] Processing ${Object.keys(sandboxFiles).length} files from sandbox`);
              let filesAdded = 0;
              let filesUpdated = 0;

              for (const [sandboxPath, content] of Object.entries(sandboxFiles)) {
                try {
                  // downloadFiles already returns paths with /dapp/ prefix, so use as-is
                  const idePath = sandboxPath.startsWith('/dapp/') ? sandboxPath : sandboxPath.replace('/app/', '/dapp/');
                  
                  // Ensure content is a string
                  const fileContent = typeof content === 'string' ? content : String(content);
                  
                  // Get current file list and methods fresh from store (may have changed during iteration)
                  const storeState = useIDEStore.getState();
                  const currentFiles = storeState.files;
                  const existingFile = currentFiles.find((f) => f.path === idePath);

                  // Ensure we have the methods
                  if (!storeState.updateFile || !storeState.addFile) {
                    throw new Error('Store methods not available');
                  }

                  if (existingFile) {
                    console.log(`[SYNC] Updating existing file: ${idePath}`);
                    storeState.updateFile(existingFile.id, fileContent);
                    filesUpdated++;
                  } else {
                    console.log(`[SYNC] Adding new file: ${idePath} (${fileContent.length} bytes)`);
                    storeState.addFile({
                      name: idePath.split('/').pop() || 'unknown',
                      path: idePath,
                      content: fileContent,
                      type: 'component',
                      language: idePath.endsWith('.tsx')
                        ? 'typescriptreact'
                        : idePath.endsWith('.ts')
                          ? 'typescript'
                          : idePath.endsWith('.json')
                            ? 'json'
                            : idePath.endsWith('.css')
                              ? 'css'
                              : idePath.endsWith('.md')
                                ? 'markdown'
                                : idePath.endsWith('.yaml') || idePath.endsWith('.yml')
                                  ? 'yaml'
                                  : 'typescript',
                    });
                    filesAdded++;
                  }
                } catch (error: any) {
                  console.error(`[SYNC] Error processing file ${sandboxPath}:`, error);
                  console.error(`[SYNC] Error stack:`, error.stack);
                  addConsoleMessage?.('error', `❌ Failed to process ${sandboxPath}: ${error.message}`);
                }
              }

              console.log(`[SYNC] ========== FILE PROCESSING COMPLETE ==========`);
              console.log(`[SYNC] Files added: ${filesAdded}, Files updated: ${filesUpdated}`);
              addConsoleMessage?.('info', `✅ Synced ${filesAdded} new files, ${filesUpdated} updated files to IDE`);
              
              if (filesAdded === 0 && filesUpdated === 0) {
                console.error(`[SYNC] ERROR: Processed ${Object.keys(sandboxFiles).length} files but added/updated 0!`);
                console.error(`[SYNC] This suggests files are being skipped or errors are being swallowed`);
              }

              // Commit updated IDE state
              const updatedFiles = useIDEStore.getState().files.filter((f) => f.path.startsWith('/dapp/'));
              if (updatedFiles.length > 0) {
                try {
                  await GitService.commit(activeProjectId, 'Initial sync from sandbox', updatedFiles);
                } catch (error) {
                  console.warn('Failed to commit IDE state:', error);
                }
              }

              // Try to commit sandbox state and get hash
              try {
                const commitResult = await callGitAPI('commitSandboxState', { message: 'Initial sync baseline' });
                sandboxHeadHash = commitResult.commitHash || null;
                if (!sandboxHeadHash) {
                  const headResult = await callGitAPI('getSandboxHeadCommit');
                  sandboxHeadHash = headResult.commitHash || null;
                }
              } catch (error) {
                console.warn('Failed to commit sandbox state:', error);
              }
            }
          } else {
            const errorText = await sandboxResponse.text();
            console.error(`[SYNC] Failed to fetch sandbox files: ${sandboxResponse.status} - ${errorText}`);
            addConsoleMessage?.('error', `❌ Failed to fetch sandbox files: ${sandboxResponse.statusText}`);
          }
        }

        // Establish baseline commit hash after first sync
        if (!sandboxHeadHash) {
          // If still no hash, create an empty commit to establish baseline
          try {
            const commitResult = await callGitAPI('commitSandboxState', { message: 'Initial baseline' });
            sandboxHeadHash = commitResult.commitHash || null;
          } catch (error) {
            console.warn('Failed to create baseline commit:', error);
          }
        }

        // Count synced files
        const finalFiles = useIDEStore.getState().files.filter((f) => f.path.startsWith('/dapp/'));
        const filesSynced = finalFiles.length - dappFiles.length;

        if (sandboxHeadHash && sandboxHeadHash !== 'HEAD' && sandboxHeadHash.length >= 7) {
          setLastSyncedCommitHash(activeProjectId, sandboxHeadHash);
          addConsoleMessage?.('info', `✅ Baseline established: ${sandboxHeadHash.substring(0, 7)}`);
        } else {
          addConsoleMessage?.('warning', '⚠️ Could not establish baseline commit hash');
        }

        const syncMessage = filesSynced > 0
          ? `✅ First sync completed: ${filesSynced} files synced, baseline established`
          : '✅ First sync completed, baseline established';

        return {
          success: true,
          message: syncMessage,
          data: { firstSync: true, baselineHash: sandboxHeadHash, filesSynced },
        };
      }

      // Step 4: For non-first sync, commit current state in sandbox (if there are changes)
      addConsoleMessage?.('info', '📝 Committing current sandbox state...');
      try {
        const commitResult = await callGitAPI('commitSandboxState', { message: 'Sync checkpoint' });
        sandboxHeadHash = commitResult.commitHash || null;
      } catch (error) {
        console.warn('Failed to commit sandbox state:', error);
        // Try to get HEAD anyway
        try {
          const headResult = await callGitAPI('getSandboxHeadCommit');
          sandboxHeadHash = headResult.commitHash || null;
        } catch {
          sandboxHeadHash = null;
        }
      }

      // Step 5: Compare commit hashes to detect changes
      const sandboxHasChanges = sandboxHeadHash && sandboxHeadHash !== lastSyncedHash;
      const ideHasChanges = await GitService.hasUncommittedChanges(activeProjectId, dappFiles);

      // Step 6: Get changed files using git
      const results: string[] = [];
      let appliedChanges = 0;
      const conflicts: string[] = [];

      if (sandboxHasChanges && (direction === 'sandbox-to-ide' || direction === 'bidirectional')) {
        // Pull changes from sandbox
        addConsoleMessage?.('info', '📥 Pulling changes from sandbox...');

        const changedFilesResult = await callGitAPI('getSandboxChangedFiles', { sinceHash: lastSyncedHash });
        const sandboxChangedFiles = changedFilesResult.changedFiles || [];
        const sandboxResponse = await fetch(`/api/beam/sandbox/${activeProjectId}/files`);
        const sandboxData = sandboxResponse.ok ? await sandboxResponse.json() : { files: {} };
        const sandboxFiles = sandboxData.files || {};

        for (const changedFile of sandboxChangedFiles) {
          const idePath = `/dapp/${changedFile.path}`;
          const sandboxPath = `/app/${changedFile.path}`;
          const sandboxContent = sandboxFiles[sandboxPath] as string | undefined;

          if (changedFile.status === 'deleted') {
            const fileToDelete = ideFiles.find((f) => f.path === idePath);
            if (fileToDelete) {
              deleteFile(fileToDelete.id);
              results.push(`🗑️ Deleted ${idePath}`);
              appliedChanges++;
            }
          } else if (sandboxContent !== undefined) {
            const existingFile = ideFiles.find((f) => f.path === idePath);

            // Conflict detection: check if IDE also modified this file
            if (existingFile && ideHasChanges) {
              const ideChangedFiles = await GitService.getChangedFiles(activeProjectId, lastSyncedHash);
              const ideFileChanged = ideChangedFiles.some((f) => f.path === idePath && f.status !== 'deleted');

              if (ideFileChanged) {
                conflicts.push(idePath);
                results.push(`⚠️ Conflict detected: ${idePath} (IDE version kept)`);
                // IDE wins by default
                continue;
              }
            }

            if (existingFile) {
              updateFile(existingFile.id, sandboxContent);
              results.push(`📝 Updated ${idePath}`);
            } else {
              addFile({
                name: idePath.split('/').pop() || 'unknown',
                path: idePath,
                content: sandboxContent,
                type: 'component',
                language: idePath.endsWith('.tsx')
                  ? 'typescriptreact'
                  : idePath.endsWith('.ts')
                    ? 'typescript'
                    : 'json',
              });
              results.push(`➕ Added ${idePath}`);
            }
            appliedChanges++;
          }
        }

        // Commit pulled changes in IDE
        const updatedFiles = useIDEStore.getState().files.filter((f) => f.path.startsWith('/dapp/'));
        if (updatedFiles.length > 0 && sandboxChangedFiles.length > 0) {
          const commitLogResult = await callGitAPI('getSandboxCommitLog', { sinceHash: lastSyncedHash });
          const commitMessages = commitLogResult.commitLog || [];
          const messages = commitMessages.map((c: { message: string }) => c.message).join(', ');
          await GitService.commit(activeProjectId, `Synced from sandbox: ${messages}`, updatedFiles);
        }
      }

      if ((ideHasChanges || direction === 'ide-to-sandbox') && (direction === 'ide-to-sandbox' || direction === 'bidirectional')) {
        // Push changes to sandbox
        addConsoleMessage?.('info', '📤 Pushing changes to sandbox...');

        // Commit IDE changes first
        if (ideHasChanges) {
          await GitService.commit(activeProjectId, 'IDE changes before sync', dappFiles);
        }

        // Get changed files (added/deleted - modified detection is simplified)
        const ideChangedFiles = await GitService.getChangedFiles(activeProjectId, lastSyncedHash);
        const ideFilesToUpload: Record<string, string> = {};

        // For ide-to-sandbox direction, always upload all files to ensure sync
        // For bidirectional, upload files that were added or potentially modified
        if (direction === 'ide-to-sandbox') {
          // Upload all IDE files
          for (const file of dappFiles) {
            const sandboxPath = file.path.replace('/dapp/', '/app/');
            ideFilesToUpload[sandboxPath] = file.content;
          }
        } else {
          // Bidirectional: upload added files and all files (since we can't reliably detect modified)
          // This is a bit inefficient but ensures sync works correctly
          for (const changedFile of ideChangedFiles) {
            if (changedFile.status === 'deleted') {
              // Handle deletions - we'll need to delete from sandbox
              results.push(`🗑️ Marked for deletion: ${changedFile.path}`);
            } else if (changedFile.status === 'added') {
              const file = dappFiles.find((f) => f.path === changedFile.path);
              if (file) {
                const sandboxPath = changedFile.path.replace('/dapp/', '/app/');
                ideFilesToUpload[sandboxPath] = file.content;
              }
            }
          }
          
          // Also upload all files to ensure modified files are synced
          // (Since we can't reliably detect modified files, we sync everything)
          for (const file of dappFiles) {
            const sandboxPath = file.path.replace('/dapp/', '/app/');
            if (!ideFilesToUpload[sandboxPath]) {
              ideFilesToUpload[sandboxPath] = file.content;
            }
          }
        }

        if (Object.keys(ideFilesToUpload).length > 0) {
          await beamClient.uploadFiles(activeProjectId, ideFilesToUpload, false);
          const commitResult = await callGitAPI('commitSandboxState', { message: 'Synced from IDE' });
          sandboxHeadHash = commitResult.commitHash || null;
          results.push(`📤 Uploaded ${Object.keys(ideFilesToUpload).length} files to sandbox`);
          appliedChanges += Object.keys(ideFilesToUpload).length;
        }
      }

      // Step 7: Update last synced commit hash
      if (sandboxHeadHash) {
        setLastSyncedCommitHash(activeProjectId, sandboxHeadHash);
      }

      const summary = [
        `✅ Git-based sync completed: ${direction}`,
        `📊 ${appliedChanges} changes applied`,
        conflicts.length > 0 ? `⚠️ ${conflicts.length} conflicts detected (IDE version kept)` : '',
        ...results,
      ]
        .filter((line) => line)
        .join('\n');

      addConsoleMessage?.('success', summary);

      return {
        success: true,
        message: summary,
        data: {
          direction,
          changes_applied: appliedChanges,
          conflicts: conflicts.length,
          sandboxHeadHash,
        },
      };
    } catch (error) {
      return {
        success: false,
        message: '❌ Git-based sync failed',
        error: String(error),
      };
    }
  }

  /**
   * Calculate file changes between two manifests
   */
  static calculateFileChanges(
    sourceManifest: Record<string, { path: string; size: number; modified: number; content: string }>,
    targetManifest: Record<string, { path: string; size: number; modified: number; content: string }>
  ) {
    const sourcePaths = new Set(Object.keys(sourceManifest));
    const targetPaths = new Set(Object.keys(targetManifest));

    const added = Array.from(sourcePaths).filter(path => !targetPaths.has(path));
    const deleted = Array.from(targetPaths).filter(path => !sourcePaths.has(path));

    const potentiallyModified = Array.from(sourcePaths).filter(path => targetPaths.has(path));
    const modified = potentiallyModified.filter(path => {
      const source = sourceManifest[path];
      const target = targetManifest[path];
      return source.size !== target.size || source.content !== target.content;
    });

    return { added, modified, deleted };
  }

  /**
   * Read files from BEAM sandbox (for two-way sync)
   */
  static async readSandboxFiles(path?: string): Promise<ToolResult> {
    try {
      const { activeProjectId, updateFile, addFile, addConsoleMessage } = useIDEStore.getState();

      if (!activeProjectId) {
        return {
          success: false,
          message: 'No active project',
          error: 'Select or create a project first',
        };
      }

      addConsoleMessage?.('info', `📥 Reading files from sandbox${path ? ` (${path})` : ''}...`);

      const queryParams = path ? `?path=${encodeURIComponent(path)}` : '';
      const response = await fetch(`/api/beam/sandbox/${activeProjectId}/files${queryParams}`);

      if (!response.ok) {
        const error = await response.json();
        return {
          success: false,
          message: '❌ Failed to read files',
          error: error.error || response.statusText,
        };
      }

      const result = await response.json();
      const files = result.files || {};
      const fileCount = Object.keys(files).length;

      if (fileCount === 0) {
        return {
          success: true,
          message: '📁 No files found in sandbox',
          data: { files },
        };
      }

      // Sync files back to IDE store
      for (const [filePath, content] of Object.entries(files)) {
        // Try to find existing file
        const existingFile = useIDEStore.getState().files.find(f => f.path === filePath);

        if (existingFile) {
          // Update existing file
          updateFile?.(existingFile.id, content as string);
        } else {
          // Create new file
          const fileName = filePath.split('/').pop() || 'unknown';
          const fileExt = fileName.split('.').pop() || '';

          let language: any = 'plaintext';
          let type: any = 'component';

          if (fileExt === 'tsx' || fileExt === 'jsx') {
            language = fileExt === 'tsx' ? 'typescriptreact' : 'javascriptreact';
            type = 'component';
          } else if (fileExt === 'ts' || fileExt === 'js') {
            language = fileExt === 'ts' ? 'typescript' : 'javascript';
            type = 'component';
          } else if (fileExt === 'json') {
            language = 'json';
            type = 'config';
          } else if (fileExt === 'css') {
            language = 'css';
            type = 'style';
          }

          addFile?.({
            name: fileName,
            path: filePath,
            content: content as string,
            language,
            type,
          });
        }
      }

      addConsoleMessage?.('success', `✅ Synced ${fileCount} files from sandbox`);

      return {
        success: true,
        message: `✅ Read ${fileCount} files from sandbox and synced to IDE`,
        data: { files, count: fileCount },
      };
    } catch (error) {
      return {
        success: false,
        message: '❌ Failed to read sandbox files',
        error: String(error),
      };
    }
  }

  /**
   * Get recent logs from BEAM sandbox dev server
   */
  static async getSandboxLogs(lines: number = 50): Promise<ToolResult> {
    try {
      const { activeProjectId, addConsoleMessage } = useIDEStore.getState();

      if (!activeProjectId) {
        return {
          success: false,
          message: 'No active project',
          error: 'Select or create a project first',
        };
      }

      addConsoleMessage?.('info', `📋 Fetching last ${lines} log lines...`);

      const response = await fetch(`/api/beam/sandbox/${activeProjectId}/recent-logs?lines=${lines}`);

      if (!response.ok) {
        const error = await response.json();
        return {
          success: false,
          message: '❌ Failed to get logs',
          error: error.error || response.statusText,
        };
      }

      const result = await response.json();
      const logs = result.logs || '';

      if (logs) {
        addConsoleMessage?.('info', logs);
      }

      return {
        success: true,
        message: `✅ Retrieved ${lines} log lines`,
        data: { logs },
      };
    } catch (error) {
      return {
        success: false,
        message: '❌ Failed to get sandbox logs',
        error: String(error),
      };
    }
  }
}
