import { ToolResult } from './types';

/**
 * Cache entry for tool results
 */
interface CacheEntry {
  result: ToolResult;
  timestamp: number;
  key: string;
}

/**
 * Tool result cache with TTL support
 */
class ToolResultCache {
  private cache = new Map<string, CacheEntry>();
  private defaultTTL: number;

  constructor(defaultTTL: number = 5000) {
    this.defaultTTL = defaultTTL;
  }

  /**
   * Generates a cache key from tool name and arguments
   */
  private generateKey(toolName: string, args: any): string {
    // Handle array arguments (for functions with multiple parameters)
    let argsString: string;
    if (Array.isArray(args)) {
      // For array arguments, stringify each element
      argsString = JSON.stringify(args.map(arg => {
        if (typeof arg === 'object' && arg !== null) {
          // Sort object keys for consistent hashing
          return JSON.stringify(arg, Object.keys(arg).sort());
        }
        return arg;
      }));
    } else if (typeof args === 'object' && args !== null) {
      argsString = JSON.stringify(args, Object.keys(args).sort());
    } else {
      argsString = JSON.stringify(args);
    }
    return `${toolName}:${argsString}`;
  }

  /**
   * Gets a cached result if available and not expired
   */
  get(toolName: string, args: any, ttl?: number): ToolResult | null {
    const key = this.generateKey(toolName, args);
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    const age = Date.now() - entry.timestamp;
    const effectiveTTL = ttl || this.defaultTTL;

    if (age > effectiveTTL) {
      this.cache.delete(key);
      return null;
    }

    // Return cached result with metadata
    return {
      ...entry.result,
      metadata: {
        ...entry.result.metadata,
        cached: true,
        executionTime: age, // Age of cache entry
      },
    };
  }

  /**
   * Sets a cached result
   */
  set(toolName: string, args: any, result: ToolResult): void {
    const key = this.generateKey(toolName, args);
    this.cache.set(key, {
      result,
      timestamp: Date.now(),
      key,
    });
  }

  /**
   * Invalidates cache for a specific tool or all cache
   */
  invalidate(toolName?: string, args?: any): void {
    if (!toolName) {
      // Clear all cache
      this.cache.clear();
      return;
    }

    if (args) {
      // Clear specific entry
      const key = this.generateKey(toolName, args);
      this.cache.delete(key);
    } else {
      // Clear all entries for this tool
      const prefix = `${toolName}:`;
      const keysToDelete: string[] = [];
      for (const [key] of Array.from(this.cache.entries())) {
        if (key.startsWith(prefix)) {
          keysToDelete.push(key);
        }
      }
      for (const key of keysToDelete) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Invalidates cache when files are modified
   */
  invalidateOnFileChange(filePath: string): void {
    // Invalidate tools that depend on file state
    const fileDependentTools = ['read_file', 'list_files', 'get_file_dependencies', 'analyze_component'];
    
    for (const toolName of fileDependentTools) {
      this.invalidate(toolName);
    }
  }

  /**
   * Gets cache statistics
   */
  getStats(): { size: number; entries: Array<{ key: string; age: number }> } {
    const entries = Array.from(this.cache.entries()).map(([key, entry]) => ({
      key,
      age: Date.now() - entry.timestamp,
    }));

    return {
      size: this.cache.size,
      entries,
    };
  }

  /**
   * Cleans up expired entries
   */
  cleanup(ttl?: number): number {
    const effectiveTTL = ttl || this.defaultTTL;
    const now = Date.now();
    let cleaned = 0;

    const keysToDelete: string[] = [];
    for (const [key, entry] of Array.from(this.cache.entries())) {
      if (now - entry.timestamp > effectiveTTL) {
        keysToDelete.push(key);
        cleaned++;
      }
    }
    for (const key of keysToDelete) {
      this.cache.delete(key);
    }

    return cleaned;
  }
}

// Global cache instance
export const toolCache = new ToolResultCache(5000);

// Counter for anonymous function cache keys
let anonymousFunctionCounter = 0;
const functionToKeyMap = new WeakMap<Function, string>();

/**
 * Creates a cached wrapper for a tool executor
 */
export function withCache<T extends any[]>(
  executor: (...args: T) => Promise<ToolResult>,
  ttl?: number
): (...args: T) => Promise<ToolResult> {
  // Generate a unique key for this executor function
  let toolName: string;
  if ((executor as any).name && (executor as any).name !== '') {
    toolName = (executor as any).name;
  } else {
    // For anonymous functions, use a WeakMap to track them
    if (!functionToKeyMap.has(executor)) {
      const key = `anonymous_${anonymousFunctionCounter++}`;
      functionToKeyMap.set(executor, key);
      toolName = key;
    } else {
      toolName = functionToKeyMap.get(executor)!;
    }
  }

  return async (...args: T): Promise<ToolResult> => {
    // Check cache
    const cached = toolCache.get(toolName, args, ttl);
    if (cached) {
      return cached;
    }

    // Execute and cache result
    const result = await executor(...args);

    // Only cache successful results
    if (result.success) {
      toolCache.set(toolName, args, result);
    }

    return result;
  };
}

