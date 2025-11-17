/**
 * File tools module - provides file system operations for the IDE
 * 
 * This module is split into focused sub-modules:
 * - list.ts: File listing and project structure
 * - read.ts: File reading and searching
 * - write.ts: File creation and deletion
 * - dependencies.ts: Dependency analysis
 * - integration.ts: Component integration
 * - blueprint-publish.ts: Blueprint publishing
 * - sync-helpers.ts: Auto-sync utilities
 */

// List operations
export { listFiles, getProjectStructure, listKeyFiles } from './list';

// Read operations
export { readFile, findFile, searchSymbol, summarizeFile } from './read';

// Write operations
export { writeFile, deleteFile } from './write';

// Batch operations
export { batchWriteFiles, batchReadFiles, type BatchFileOperation } from './batch';

// Dependency analysis
export { getFileDependencies, analyzeComponent } from './dependencies';

// Component integration
export { integrateComponent } from './integration';

// Blueprint publishing
export { publishBlueprint } from './blueprint-publish';

// Sync helpers (internal use)
export { autoSyncIfNeeded, formatAutoSyncMessage } from './sync-helpers';

// Re-export types
import type { ToolResult } from '../types';

// Create the unified fileTools object
import * as listModule from './list';
import * as readModule from './read';
import * as writeModule from './write';
import * as dependenciesModule from './dependencies';
import * as integrationModule from './integration';
import * as blueprintPublishModule from './blueprint-publish';
import * as batchModule from './batch';

export const fileTools = {
  // List operations
  listFiles: listModule.listFiles,
  getProjectStructure: listModule.getProjectStructure,
  listKeyFiles: listModule.listKeyFiles,

  // Read operations
  readFile: readModule.readFile,
  findFile: readModule.findFile,
  searchSymbol: readModule.searchSymbol,
  summarizeFile: readModule.summarizeFile,

  // Write operations
  writeFile: writeModule.writeFile,
  deleteFile: writeModule.deleteFile,

  // Batch operations
  batchWriteFiles: batchModule.batchWriteFiles,
  batchReadFiles: batchModule.batchReadFiles,

  // Dependency analysis
  getFileDependencies: dependenciesModule.getFileDependencies,
  analyzeComponent: dependenciesModule.analyzeComponent,

  // Component integration
  integrateComponent: integrationModule.integrateComponent,

  // Blueprint publishing
  publishBlueprint: blueprintPublishModule.publishBlueprint,
};

export type FileTools = typeof fileTools;

