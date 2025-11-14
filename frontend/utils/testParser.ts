/**
 * Utilities for parsing test files and extracting blueprint class references
 */

import { getHathorTestMocks } from './hathorTestMocks';
import { getHathorHelpers } from './hathorHelpers';

export interface BlueprintReference {
  variableName: string; // e.g., "self.blueprint_id" 
  className: string;    // e.g., "SimpleCounter"
  lineNumber: number;   // Line where the reference was found
}

/**
 * Parse a test file content to find blueprint class references
 * Looks for patterns like: self.nc_catalog.blueprints[self.blueprint_id] = ClassName
 */
export function parseTestFileForBlueprints(testContent: string): BlueprintReference[] {
  const references: BlueprintReference[] = [];
  const lines = testContent.split('\n');
  
  // Regex patterns to match different ways of referencing blueprints
  const patterns = [
    // Pattern: self.nc_catalog.blueprints[self.blueprint_id] = ClassName
    /self\.nc_catalog\.blueprints\[([^\]]+)\]\s*=\s*([A-Za-z][A-Za-z0-9_]*)/,
    // Pattern: self.nc_catalog.blueprints["some_id"] = ClassName  
    /self\.nc_catalog\.blueprints\["([^"]+)"\]\s*=\s*([A-Za-z][A-Za-z0-9_]*)/,
    // Pattern: nc_catalog.blueprints[blueprint_id] = ClassName
    /nc_catalog\.blueprints\[([^\]]+)\]\s*=\s*([A-Za-z][A-Za-z0-9_]*)/,
    // Pattern: self.nc_catalog.blueprints["id"] = ClassName (with quotes)
    /self\.nc_catalog\.blueprints\["([^"]+)"\]\s*=\s*([A-Za-z][A-Za-z0-9_]*)/,
  ];
  
  lines.forEach((line, index) => {
    const trimmedLine = line.trim();
    
    for (const pattern of patterns) {
      const match = trimmedLine.match(pattern);
      if (match) {
        const variableName = match[1];
        const className = match[2];
        
        references.push({
          variableName,
          className,
          lineNumber: index + 1
        });
      }
    }
  });
  
  return references;
}

/**
 * Find contract files that contain the specified blueprint class
 * Returns array of file objects that define the given class
 */
export function findContractFilesByClassName(files: any[], className: string): any[] {
  return files.filter(file => {
    if (file.type === 'test') return false; // Skip test files
    
    const content = file.content;
    if (!content) return false;
    
    // Look for class definition patterns
    const classPattern = new RegExp(`class\\s+${className}\\s*\\([^)]*\\)\\s*:`, 'g');
    const blueprintPattern = new RegExp(`__blueprint__\\s*=\\s*${className}`, 'g');
    
    return classPattern.test(content) || blueprintPattern.test(content);
  });
}

/**
 * Validate that each blueprint reference in a test file has exactly one matching contract file
 * Returns validation results with any errors found
 */
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  references: BlueprintReference[];
  matchedFiles: { [className: string]: any[] };
}

export function validateTestBlueprints(testFile: any, contractFiles: any[]): ValidationResult {
  const references = parseTestFileForBlueprints(testFile.content);
  const errors: string[] = [];
  const matchedFiles: { [className: string]: any[] } = {};
  
  references.forEach(ref => {
    const matches = findContractFilesByClassName(contractFiles, ref.className);
    matchedFiles[ref.className] = matches;
    
    if (matches.length === 0) {
      errors.push(`Blueprint class '${ref.className}' not found in any contract files (line ${ref.lineNumber})`);
    } else if (matches.length > 1) {
      const fileNames = matches.map(f => f.name).join(', ');
      errors.push(`Blueprint class '${ref.className}' found in multiple files: ${fileNames} (line ${ref.lineNumber})`);
    }
  });
  
  return {
    isValid: errors.length === 0,
    errors,
    references,
    matchedFiles
  };
}

/**
 * Generate combined code for pytest execution
 * Combines contract code and test code in proper order for execution
 */
export function combineCodeForTesting(contractFiles: any[], testFile: any, references: BlueprintReference[]): string {
  let combinedCode = '';
  
  // Add imports and Hathor mocks first
  combinedCode += `# Combined code for testing with Hathor mocks
import sys
import pytest
from unittest.mock import MagicMock

# Import our Hathor test framework mocks
`;
  
  // Add the Hathor test mocks (which now include the helpers)
  combinedCode += getHathorTestMocks();
  
/*
  combinedCode += `

# Create global catalog instance for compatibility
nc_catalog = MockNanoContractCatalog()

`;
*/

  // Add contract code (blueprint classes)
  const usedClassNames = new Set(references.map(ref => ref.className));
  
  contractFiles.forEach(contractFile => {
    // Check if this file contains any of the referenced classes
    const hasReferencedClass = Array.from(usedClassNames).some(className => {
      const classPattern = new RegExp(`class\\s+${className}\\s*\\([^)]*\\)\\s*:`, 'g');
      const blueprintPattern = new RegExp(`__blueprint__\\s*=\\s*${className}`, 'g');
      return classPattern.test(contractFile.content) || blueprintPattern.test(contractFile.content);
    });
    
    if (hasReferencedClass) {
      combinedCode += `
# Contract code from ${contractFile.name}
${contractFile.content}

`;
    }
  });
  
  // Add test code with blueprint registration
  combinedCode += `
# Test code from ${testFile.name}
`;

  // Process test file content to replace self references with global references
  let processedTestContent = testFile.content;

  // Replace self.nc_catalog with global nc_catalog
  //processedTestContent = processedTestContent.replace(/self\.nc_catalog/g, 'nc_catalog');

  combinedCode += processedTestContent;

  return combinedCode;
}
