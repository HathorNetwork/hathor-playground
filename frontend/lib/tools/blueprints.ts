import { pyodideRunner } from '../pyodide-runner';
import { useIDEStore } from '@/store/ide-store';

import { ToolResult } from './types';
import { validateBlueprintPath, validationResultToError } from './validation';
import { executeTool } from './middleware';

async function compileBlueprint(path: string): Promise<ToolResult> {
  // Pre-flight validation
  const pathValidation = validateBlueprintPath(path);
  if (!pathValidation.valid) {
    return validationResultToError(pathValidation, 'INVALID_BLUEPRINT_PATH').toToolResult();
  }

  return executeTool(
    'compile_blueprint',
    async () => {
      const files = useIDEStore.getState().files;
      const file = files.find((f) => f.path === path);

      if (!file) {
        return {
          success: false,
          message: `File not found: ${path}`,
          error: 'Cannot compile non-existent file',
        };
      }

      if (!path.startsWith('/blueprints/') && !path.startsWith('/contracts/')) {
        return {
          success: false,
          message: `Invalid blueprint path: ${path}`,
          error: 'Blueprints must be in /blueprints/ or /contracts/',
        };
      }

    await pyodideRunner.initialize();

    const result = await pyodideRunner.compileContract(file.content, file.name.replace('.py', ''));

    if (result.success) {
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
    }

      return {
        success: false,
        message: `❌ Compilation failed for ${path}`,
        error: result.error || 'Unknown compilation error',
        data: {
          traceback: result.traceback,
        },
      };
    },
    {
      retries: 0, // Compilation shouldn't be retried automatically
      timeout: 60000, // 60 second timeout for compilation
    }
  );
}

async function executeMethod(
  path: string,
  methodName: string,
  args: any[] = [],
  callerAddress?: string,
): Promise<ToolResult> {
  // Pre-flight validation
  const pathValidation = validateBlueprintPath(path);
  if (!pathValidation.valid) {
    return validationResultToError(pathValidation, 'INVALID_BLUEPRINT_PATH').toToolResult();
  }

  if (!methodName || typeof methodName !== 'string') {
    return {
      success: false,
      message: 'Method name is required and must be a string',
      error: 'Invalid method name',
    };
  }

  return executeTool(
    'execute_method',
    async () => {
      const files = useIDEStore.getState().files;
      const file = files.find((f) => f.path === path);

      if (!file) {
        return {
          success: false,
          message: `File not found: ${path}`,
          error: 'Cannot execute method on non-existent file',
        };
      }

    const { contractInstances, compiledContracts } = useIDEStore.getState();
    let contractId = contractInstances[file.id]?.contractId;

    if (!contractId) {
      const compiled = compiledContracts.find((c: any) => c.fileId === file.id);
      if (methodName === 'initialize' && compiled) {
        contractId = compiled.blueprint_id;
      } else {
        return {
          success: false,
          message: `No contract instance found for ${path}`,
          error:
            methodName === 'initialize'
              ? 'Compile the blueprint first using compile_blueprint()'
              : 'Compile the blueprint and call initialize() first',
        };
      }
    }

    await pyodideRunner.initialize();

    const result = await pyodideRunner.executeContract({
      contract_id: contractId,
      method_name: methodName,
      args,
      code: file.content,
      caller_address: callerAddress || 'WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp',
      actions: [],
    });

    if (result.success) {
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
    }

      const errorMsg = [
        `❌ Execution failed: ${methodName}()`,
        ``,
        `Error: ${result.error || 'Unknown error'}`,
        result.traceback ? `\nTraceback:\n${result.traceback}` : '',
      ]
        .filter(Boolean)
        .join('\n');

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
    },
    {
      retries: 0, // Method execution shouldn't be retried automatically
      timeout: 30000, // 30 second timeout
    }
  );
}

async function runTests(testPath: string): Promise<ToolResult> {
  // Pre-flight validation
  const pathValidation = validateFilePath(testPath);
  if (!pathValidation.valid) {
    return validationResultToError(pathValidation, 'INVALID_TEST_PATH').toToolResult();
  }

  if (!testPath.startsWith('/tests/')) {
    return {
      success: false,
      message: `Invalid test path: ${testPath}`,
      error: 'Test files must be in /tests/',
    };
  }

  if (!testPath.endsWith('.py')) {
    return {
      success: false,
      message: 'Test file must have .py extension',
      error: 'Invalid test file extension',
    };
  }

  return executeTool(
    'run_tests',
    async () => {
      const files = useIDEStore.getState().files;
      const testFile = files.find((f) => f.path === testPath);

      if (!testFile) {
        return {
          success: false,
          message: `Test file not found: ${testPath}`,
          error: 'Cannot run non-existent test file',
        };
      }

      await pyodideRunner.initialize();

      const contractFiles = files.filter(
        (f) =>
          (f.path.startsWith('/contracts/') || f.path.startsWith('/blueprints/')) &&
          f.type === 'contract',
      );

      const result = await pyodideRunner.runTests(testFile.content, testFile.name, contractFiles);

      if (result.success) {
        const passRate = result.tests_run ? `${result.tests_passed}/${result.tests_run} passed` : 'unknown';

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
      }

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
    },
    {
      retries: 0, // Test execution shouldn't be retried automatically
      timeout: 120000, // 2 minute timeout for tests
    }
  );
}

async function validateBlueprint(path: string): Promise<ToolResult> {
  // Pre-flight validation
  const pathValidation = validateBlueprintPath(path);
  if (!pathValidation.valid) {
    return validationResultToError(pathValidation, 'INVALID_BLUEPRINT_PATH').toToolResult();
  }

  return executeTool(
    'validate_blueprint',
    async () => {
      const files = useIDEStore.getState().files;
      const file = files.find((f) => f.path === path);

      if (!file) {
        return {
          success: false,
          message: `File not found: ${path}`,
          error: 'Cannot validate non-existent file',
        };
      }

    const code = file.content;
    const issues: string[] = [];

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
      }

      return {
        success: false,
        message: `🔍 Validation issues found in ${path}:\n\n${issues.map((i) => `  ${i}`).join('\n')}`,
        data: { valid: false, issues },
        warnings: issues.filter((i) => i.startsWith('⚠️')),
      };
    },
    {
      retries: 0, // Validation is deterministic, no retry needed
      timeout: 5000, // Quick validation, 5 second timeout
    }
  );
}

async function listMethods(path: string): Promise<ToolResult> {
  try {
    const files = useIDEStore.getState().files;
    const file = files.find((f) => f.path === path);

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
      ...publicMethods.map((m) => `  ${m}`),
      '',
      `👁️  @view methods (${viewMethods.length}):`,
      ...viewMethods.map((m) => `  ${m}`),
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

export const blueprintTools = {
  compileBlueprint,
  executeMethod,
  runTests,
  validateBlueprint,
  listMethods,
};

export type BlueprintTools = typeof blueprintTools;

