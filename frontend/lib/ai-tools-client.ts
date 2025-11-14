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

      // Clean up any existing directory first
      const cleanupCmd = `rm -rf ${resolvedAppName}`;
      await AIToolsClient.runCommand(cleanupCmd);

      // Execute scaffold command in sandbox
      const cmd = `npx create-hathor-dapp@latest ${resolvedAppName} --yes --wallet-connect-id=${resolvedWC} --network=${resolvedNetwork}`;
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
      const checkCmd = `ls -la ${resolvedAppName}/package.json 2>/dev/null || echo "missing"`;
      const checkResult = await AIToolsClient.runCommand(checkCmd);
      const packageExists = checkResult.data?.stdout && !checkResult.data?.stdout.includes('missing');

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
   * Two-way sync between IDE and BEAM sandbox
   */
  static async syncDApp(
    direction: 'ide-to-sandbox' | 'sandbox-to-ide' | 'bidirectional' = 'bidirectional',
    projectId?: string
  ): Promise<ToolResult> {
    try {
      // Get project ID from parameter or store (for API route vs tool calls)
      const activeProjectId = projectId || useIDEStore.getState().activeProjectId;
      const { files: ideFiles, addFile, updateFile, deleteFile, addConsoleMessage } = useIDEStore.getState();

      if (!activeProjectId) {
        return {
          success: false,
          message: 'No active project',
          error: 'Select or create a project first',
        };
      }

      addConsoleMessage?.('info', `🔄 Starting ${direction} sync for dApp files...`);

      // Get IDE file manifest (only /dapp/ files)
      const ideManifest = ideFiles
        .filter(f => f.path.startsWith('/dapp/'))
        .reduce((acc, file) => {
          acc[file.path] = {
            path: file.path,
            size: file.content.length,
            modified: Date.now(), // IDE doesn't track modified time
            content: file.content,
          };
          return acc;
        }, {} as Record<string, { path: string; size: number; modified: number; content: string }>);

      let normalizedSandboxManifest: Record<string, { path: string; size: number; modified: number; content: string }> = {};

      // Only read sandbox files for directions that need comparison
      if (direction === 'sandbox-to-ide' || direction === 'bidirectional') {
        // Get sandbox file manifest
        try {
          const sandboxResponse = await fetch(`/api/beam/sandbox/${activeProjectId}/files`);
          if (sandboxResponse.ok) {
            const sandboxData = await sandboxResponse.json();
            const sandboxManifest = sandboxData.files || {};

            // Convert sandbox files to consistent format (sandbox paths to IDE paths)
            for (const [sandboxPath, content] of Object.entries(sandboxManifest)) {
              // Convert sandbox path to IDE path
              let idePath = sandboxPath;
              if (sandboxPath.startsWith('/app/')) {
                idePath = sandboxPath.replace('/app/', '/dapp/');
              }

              normalizedSandboxManifest[idePath] = {
                path: idePath,
                size: (content as string).length,
                modified: Date.now(), // Sandbox doesn't track modified time
                content: content as string,
              };
            }
          } else {
            console.warn('Failed to read sandbox files, continuing with empty manifest');
          }
        } catch (error) {
          console.warn('Error reading sandbox files:', error);
        }
      }

      // Calculate differences (only for directions that need it)
      const changes = direction === 'ide-to-sandbox'
        ? { added: [], modified: [], deleted: [] } // Not needed for ide-to-sandbox
        : AIToolsClient.calculateFileChanges(ideManifest, normalizedSandboxManifest);

      console.log('🔍 Sync analysis:', {
        direction,
        ideFiles: Object.keys(ideManifest),
        sandboxFiles: Object.keys(normalizedSandboxManifest),
        changes
      });

      let appliedChanges = 0;
      const results: string[] = [];

      // Apply changes based on direction
      if (direction === 'ide-to-sandbox') {
        // For ide-to-sandbox, upload all IDE files without needing to compare with sandbox
        const allIdeFiles: Record<string, string> = {};
        for (const [path, file] of Object.entries(ideManifest)) {
          allIdeFiles[path] = file.content;
        }

        if (Object.keys(allIdeFiles).length > 0) {
          try {
            await beamClient.uploadFiles(activeProjectId, allIdeFiles, false);
            results.push(`📤 Uploaded ${Object.keys(allIdeFiles).length} files to sandbox`);
            appliedChanges += Object.keys(allIdeFiles).length;
          } catch (uploadError) {
            console.warn('Upload failed, trying to ensure sandbox exists:', uploadError);
            // Try to ensure sandbox exists and retry
            try {
              await beamClient.ensureSandbox(activeProjectId);
              await beamClient.uploadFiles(activeProjectId, allIdeFiles, false);
              results.push(`📤 Uploaded ${Object.keys(allIdeFiles).length} files to sandbox (after ensuring sandbox)`);
              appliedChanges += Object.keys(allIdeFiles).length;
            } catch (retryError) {
              console.error('Upload failed even after ensuring sandbox:', retryError);
              results.push(`❌ Failed to upload files to sandbox`);
            }
          }
        } else {
          results.push(`📤 No files to upload`);
        }
      } else if (direction === 'sandbox-to-ide') {
        // Add/update files from sandbox to IDE
        for (const path of changes.modified.concat(changes.added)) {
          if (normalizedSandboxManifest[path]) {
            const sandboxFile = normalizedSandboxManifest[path];
            const existingFile = ideFiles.find(f => f.path === path);

            if (existingFile) {
              updateFile(existingFile.id, sandboxFile.content);
            } else {
              addFile({
                name: path.split('/').pop() || 'unknown',
                path: path,
                content: sandboxFile.content,
                type: 'component',
                language: path.endsWith('.tsx') ? 'typescriptreact' : path.endsWith('.ts') ? 'typescript' : 'json',
              });
            }
          }
        }

        // Delete files from IDE that were deleted in sandbox
        for (const deletedPath of changes.deleted) {
          const fileToDelete = ideFiles.find(f => f.path === deletedPath);
          if (fileToDelete) {
            deleteFile(fileToDelete.id);
            results.push(`🗑️ Deleted ${deletedPath} from IDE`);
            appliedChanges++;
          }
        }

        const addedCount = changes.added.length;
        const modifiedCount = changes.modified.length;
        if (addedCount + modifiedCount > 0) {
          results.push(`📥 Synced ${addedCount + modifiedCount} files from sandbox to IDE`);
          appliedChanges += addedCount + modifiedCount;
        }
      } else if (direction === 'bidirectional') {
        // For bidirectional, merge all files without deletions to avoid conflicts
        // Upload all IDE files to sandbox
        const allIdeFiles: Record<string, string> = {};
        for (const [path, file] of Object.entries(ideManifest)) {
          allIdeFiles[path] = file.content;
        }

        if (Object.keys(allIdeFiles).length > 0) {
          await beamClient.uploadFiles(activeProjectId, allIdeFiles, false);
          results.push(`📤 Uploaded ${Object.keys(allIdeFiles).length} files to sandbox`);
          appliedChanges += Object.keys(allIdeFiles).length;
        }

        // Download all sandbox files to IDE
        for (const [path, sandboxFile] of Object.entries(normalizedSandboxManifest)) {
          const existingFile = ideFiles.find(f => f.path === path);

          if (existingFile) {
            // Update existing file
            updateFile(existingFile.id, sandboxFile.content);
            results.push(`📝 Updated ${path} in IDE`);
          } else {
            // Add new file
            addFile({
              name: path.split('/').pop() || 'unknown',
              path: path,
              content: sandboxFile.content,
              type: 'component',
              language: path.endsWith('.tsx') ? 'typescriptreact' : path.endsWith('.ts') ? 'typescript' : 'json',
            });
            results.push(`➕ Added ${path} to IDE`);
          }
          appliedChanges++;
        }

        results.push(`🔄 Bidirectional sync: ${Object.keys(allIdeFiles).length} uploaded, ${Object.keys(normalizedSandboxManifest).length} downloaded`);
      }

      const summary = [
        `✅ Sync completed: ${direction}`,
        `📊 ${appliedChanges} changes applied`,
        ...results,
      ].join('\n');

      addConsoleMessage?.('success', summary);

      return {
        success: true,
        message: summary,
        data: {
          direction,
          changes_applied: appliedChanges,
          added: changes.added.length,
          modified: changes.modified.length,
          deleted: changes.deleted.length,
        },
      };
    } catch (error) {
      return {
        success: false,
        message: '❌ Two-way sync failed',
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
