import { ValidationResult, ToolError, ErrorType } from './types';

/**
 * Validates file paths to prevent security issues
 */
export function validateFilePath(path: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const suggestions: string[] = [];

  if (!path || path === 'undefined') {
    errors.push('Path is required and cannot be undefined');
    return { valid: false, errors, suggestions };
  }

  // Check for path traversal attacks
  if (path.includes('..')) {
    errors.push('Path traversal not allowed (contains "..")');
    suggestions.push('Use absolute paths starting with /contracts/, /dapp/, or /tests/');
    return { valid: false, errors, suggestions };
  }

  // Check for allowed prefixes
  const allowedPrefixes = ['/contracts/', '/dapp/', '/tests/', '/blueprints/'];
  const hasAllowedPrefix = allowedPrefixes.some((prefix) => path.startsWith(prefix));

  if (!hasAllowedPrefix && !path.startsWith('/')) {
    errors.push(`Path must start with one of: ${allowedPrefixes.join(', ')}`);
    suggestions.push(`Use an absolute path like "/contracts/${path.split('/').pop()}"`);
    return { valid: false, errors, suggestions };
  }

  // Check for invalid characters
  if (/[<>:"|?*\x00-\x1f]/.test(path)) {
    errors.push('Path contains invalid characters');
    suggestions.push('Use only alphanumeric characters, dots, slashes, hyphens, and underscores');
    return { valid: false, errors, suggestions };
  }

  // Check path length
  if (path.length > 500) {
    warnings.push('Path is very long (>500 chars), consider using a shorter name');
  }

  return { valid: true, errors: [], warnings, suggestions };
}

/**
 * Validates file content for size and basic sanity checks
 */
export function validateFileContent(content: string, maxSize: number = 10 * 1024 * 1024, filePath?: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const suggestions: string[] = [];

  if (typeof content !== 'string') {
    errors.push('Content must be a string');
    return { valid: false, errors };
  }

  // Check file size (default 10MB limit)
  const sizeInBytes = new Blob([content]).size;
  if (sizeInBytes > maxSize) {
    errors.push(`File size (${(sizeInBytes / 1024 / 1024).toFixed(2)}MB) exceeds maximum (${(maxSize / 1024 / 1024).toFixed(2)}MB)`);
    return { valid: false, errors, suggestions: ['Split large files into smaller modules'] };
  }

  // Warn for very large files
  if (sizeInBytes > 1 * 1024 * 1024) {
    warnings.push(`Large file (${(sizeInBytes / 1024 / 1024).toFixed(2)}MB), may take time to process`);
  }

  // Check for null bytes
  if (content.includes('\x00')) {
    errors.push('File contains null bytes, which are not allowed');
    return { valid: false, errors };
  }

  // File type-specific validation
  if (filePath) {
    const extension = filePath.split('.').pop()?.toLowerCase();
    
    // Validate Python files for blueprint-specific patterns
    if (extension === 'py') {
      // Check for dangerous imports
      const dangerousImports = [
        /^import\s+os\s*$/m,
        /^import\s+subprocess\s*$/m,
        /^import\s+sys\s*$/m,
        /^from\s+os\s+import/m,
        /^from\s+subprocess\s+import/m,
      ];
      
      for (const pattern of dangerousImports) {
        if (pattern.test(content)) {
          warnings.push('Python file contains potentially dangerous imports');
          suggestions.push('Blueprints should not use os, subprocess, or sys modules');
          break;
        }
      }
    }

    // Validate TypeScript/JavaScript files
    if (extension === 'ts' || extension === 'tsx' || extension === 'js' || extension === 'jsx') {
      // Check for dangerous patterns
      const dangerousPatterns = [
        /process\.env/,
        /require\s*\(\s*['"]fs['"]/,
        /require\s*\(\s*['"]child_process['"]/,
        /eval\s*\(/,
        /Function\s*\(/,
      ];
      
      for (const pattern of dangerousPatterns) {
        if (pattern.test(content)) {
          warnings.push('File contains potentially dangerous code patterns');
          suggestions.push('Review the code for security concerns');
          break;
        }
      }
    }
  }

  return { valid: true, errors: [], warnings, suggestions };
}

/**
 * Normalizes and sanitizes file paths
 */
export function normalizePath(path: string): string {
  if (!path) return '/';
  
  // Remove leading/trailing whitespace
  path = path.trim();
  
  // Normalize slashes (convert backslashes to forward slashes)
  path = path.replace(/\\/g, '/');
  
  // Remove duplicate slashes
  path = path.replace(/\/+/g, '/');
  
  // Ensure path starts with /
  if (!path.startsWith('/')) {
    path = '/' + path;
  }
  
  // Remove trailing slash (except for root)
  if (path.length > 1 && path.endsWith('/')) {
    path = path.slice(0, -1);
  }
  
  return path;
}

/**
 * Validates command strings to prevent command injection
 */
export function validateCommand(command: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const suggestions: string[] = [];

  if (!command || command.trim().length === 0) {
    errors.push('Command is required');
    return { valid: false, errors, suggestions };
  }

  // Check for command injection patterns
  const dangerousPatterns = [
    /[;&|`$(){}[\]]/, // Command separators and shell metacharacters
    />\s*\w+/, // Output redirection
    /<\s*\w+/, // Input redirection
    /&&|\|\|/, // Logical operators
    /rm\s+-rf/, // Dangerous rm commands
    /sudo\s+/, // Sudo usage
    /chmod\s+777/, // Dangerous permissions
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(command)) {
      errors.push('Command contains potentially dangerous patterns');
      suggestions.push('Use only safe commands like npm, npx, or yarn');
      return { valid: false, errors, suggestions };
    }
  }

  // Check command length
  if (command.length > 1000) {
    warnings.push('Command is very long (>1000 chars)');
  }

  // Allow only whitelisted commands
  const allowedCommands = ['npm', 'npx', 'yarn', 'node', 'python', 'pip', 'git'];
  const firstWord = command.trim().split(/\s+/)[0];
  const isAllowed = allowedCommands.some(cmd => firstWord.startsWith(cmd));

  if (!isAllowed) {
    warnings.push(`Command "${firstWord}" is not in the allowed list`);
    suggestions.push(`Use one of: ${allowedCommands.join(', ')}`);
  }

  return { valid: true, errors: [], warnings, suggestions };
}

/**
 * Validates that a project is active
 */
export function validateActiveProject(activeProjectId: string | null): ValidationResult {
  if (!activeProjectId) {
    return {
      valid: false,
      errors: ['No active project'],
      suggestions: ['Select or create a project first'],
    };
  }
  return { valid: true, errors: [] };
}

/**
 * Validates blueprint file path
 */
export function validateBlueprintPath(path: string): ValidationResult {
  const pathValidation = validateFilePath(path);
  if (!pathValidation.valid) {
    return pathValidation;
  }

  if (!path.endsWith('.py')) {
    return {
      valid: false,
      errors: ['Blueprint file must have .py extension'],
      suggestions: [`Use a path like "/contracts/${path.split('/').pop() || 'MyBlueprint'}.py"`],
    };
  }

  return { valid: true, errors: [] };
}

/**
 * Validates component file path
 */
export function validateComponentPath(path: string): ValidationResult {
  const pathValidation = validateFilePath(path);
  if (!pathValidation.valid) {
    return pathValidation;
  }

  if (!path.endsWith('.tsx') && !path.endsWith('.jsx')) {
    return {
      valid: false,
      errors: ['Component file must have .tsx or .jsx extension'],
      suggestions: [`Use a path like "/dapp/components/${path.split('/').pop() || 'MyComponent'}.tsx"`],
    };
  }

  if (!path.includes('/components/')) {
    return {
      valid: false,
      errors: ['Component must be in /dapp/components/ directory'],
      suggestions: [`Use a path like "/dapp/components/${path.split('/').pop() || 'MyComponent'}.tsx"`],
    };
  }

  return { valid: true, errors: [] };
}

/**
 * Creates a ToolError from validation result
 */
export function validationResultToError(validation: ValidationResult, code: string = 'VALIDATION_ERROR'): ToolError {
  const message = validation.errors.join('; ') || 'Validation failed';
  return new ToolError(
    message,
    code,
    ErrorType.VALIDATION,
    false, // Validation errors are not recoverable without fixing input
    validation.suggestions,
  );
}

