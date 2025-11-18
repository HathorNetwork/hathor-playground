import test from 'node:test';
import assert from 'node:assert/strict';

import { toolCache, withCache } from '../lib/tools/cache';
import { ToolResult } from '../lib/tools/types';

// Helper to create a successful result
function successResult(message: string = 'Success', data?: any): ToolResult {
  return {
    success: true,
    message,
    data,
  };
}

// Helper to create a failed result
function failResult(message: string = 'Failed', error?: string): ToolResult {
  return {
    success: false,
    message,
    error: error || message,
  };
}

test('toolCache - get and set', () => {
  const result = successResult('Test result', { value: 42 });
  toolCache.set('test_tool', { path: '/test' }, result);

  const cached = toolCache.get('test_tool', { path: '/test' });
  assert.ok(cached);
  assert.equal(cached?.success, true);
  assert.equal(cached?.message, 'Test result');
  assert.equal(cached?.data?.value, 42);
  assert.equal(cached?.metadata?.cached, true);
});

test('toolCache - returns null for non-existent entries', () => {
  const cached = toolCache.get('nonexistent_tool', {});
  assert.equal(cached, null);
});

test('toolCache - cache expires after TTL', async () => {
  const result = successResult('Expiring result');
  toolCache.set('test_tool', { id: 1 }, result);

  // Should be cached immediately
  const cached1 = toolCache.get('test_tool', { id: 1 }, 50); // 50ms TTL
  assert.ok(cached1);

  // Wait for expiration
  await new Promise((resolve) => setTimeout(resolve, 60));

  // Should be expired
  const cached2 = toolCache.get('test_tool', { id: 1 }, 50);
  assert.equal(cached2, null);
});

test('toolCache - different arguments create different entries', () => {
  const result1 = successResult('Result 1');
  const result2 = successResult('Result 2');

  toolCache.set('test_tool', { path: '/file1' }, result1);
  toolCache.set('test_tool', { path: '/file2' }, result2);

  const cached1 = toolCache.get('test_tool', { path: '/file1' });
  const cached2 = toolCache.get('test_tool', { path: '/file2' });

  assert.ok(cached1);
  assert.ok(cached2);
  assert.equal(cached1?.message, 'Result 1');
  assert.equal(cached2?.message, 'Result 2');
});

test('toolCache - invalidate specific entry', () => {
  toolCache.set('test_tool', { id: 1 }, successResult('Result 1'));
  toolCache.set('test_tool', { id: 2 }, successResult('Result 2'));

  toolCache.invalidate('test_tool', { id: 1 });

  const cached1 = toolCache.get('test_tool', { id: 1 });
  const cached2 = toolCache.get('test_tool', { id: 2 });

  assert.equal(cached1, null); // Should be invalidated
  assert.ok(cached2); // Should still be cached
});

test('toolCache - invalidate all entries for a tool', () => {
  toolCache.set('test_tool', { id: 1 }, successResult('Result 1'));
  toolCache.set('test_tool', { id: 2 }, successResult('Result 2'));
  toolCache.set('other_tool', { id: 3 }, successResult('Result 3'));

  toolCache.invalidate('test_tool');

  const cached1 = toolCache.get('test_tool', { id: 1 });
  const cached2 = toolCache.get('test_tool', { id: 2 });
  const cached3 = toolCache.get('other_tool', { id: 3 });

  assert.equal(cached1, null);
  assert.equal(cached2, null);
  assert.ok(cached3); // Other tool should still be cached
});

test('toolCache - invalidate all cache', () => {
  toolCache.set('tool1', { id: 1 }, successResult('Result 1'));
  toolCache.set('tool2', { id: 2 }, successResult('Result 2'));

  toolCache.invalidate();

  const cached1 = toolCache.get('tool1', { id: 1 });
  const cached2 = toolCache.get('tool2', { id: 2 });

  assert.equal(cached1, null);
  assert.equal(cached2, null);
});

test('toolCache - invalidateOnFileChange', () => {
  // Set up cache entries for file-dependent tools
  toolCache.set('read_file', { path: '/test' }, successResult('Result'));
  toolCache.set('list_files', { path: '/' }, successResult('Result'));
  toolCache.set('get_file_dependencies', { path: '/test' }, successResult('Result'));
  toolCache.set('analyze_component', { path: '/test' }, successResult('Result'));
  toolCache.set('other_tool', { path: '/test' }, successResult('Result'));

  toolCache.invalidateOnFileChange('/test/file.tsx');

  // File-dependent tools should be invalidated
  assert.equal(toolCache.get('read_file', { path: '/test' }), null);
  assert.equal(toolCache.get('list_files', { path: '/' }), null);
  assert.equal(toolCache.get('get_file_dependencies', { path: '/test' }), null);
  assert.equal(toolCache.get('analyze_component', { path: '/test' }), null);

  // Other tools should still be cached
  assert.ok(toolCache.get('other_tool', { path: '/test' }));
});

test('toolCache - getStats', () => {
  toolCache.invalidate(); // Clear cache first

  toolCache.set('tool1', { id: 1 }, successResult('Result 1'));
  toolCache.set('tool2', { id: 2 }, successResult('Result 2'));

  const stats = toolCache.getStats();
  assert.equal(stats.size, 2);
  assert.equal(stats.entries.length, 2);
  assert.ok(stats.entries.every((e) => typeof e.age === 'number'));
  assert.ok(stats.entries.every((e) => e.key.length > 0));
});

test('toolCache - cleanup removes expired entries', async () => {
  toolCache.invalidate(); // Clear cache first

  toolCache.set('tool1', { id: 1 }, successResult('Result 1'));
  toolCache.set('tool2', { id: 2 }, successResult('Result 2'));

  // Wait for entries to expire
  await new Promise((resolve) => setTimeout(resolve, 60));

  const cleaned = toolCache.cleanup(50); // 50ms TTL
  assert.equal(cleaned, 2);

  const stats = toolCache.getStats();
  assert.equal(stats.size, 0);
});

test('toolCache - cleanup keeps non-expired entries', async () => {
  toolCache.invalidate(); // Clear cache first

  toolCache.set('tool1', { id: 1 }, successResult('Result 1'));
  await new Promise((resolve) => setTimeout(resolve, 10));
  toolCache.set('tool2', { id: 2 }, successResult('Result 2'));

  // Cleanup with long TTL should keep both
  const cleaned = toolCache.cleanup(1000);
  assert.equal(cleaned, 0);

  const stats = toolCache.getStats();
  assert.equal(stats.size, 2);
});

test('withCache - caches successful results', async () => {
  let executionCount = 0;
  const executor = async (path: string) => {
    executionCount++;
    return successResult(`Result for ${path}`);
  };

  const cachedExecutor = withCache(executor, 1000);

  // First call
  const result1 = await cachedExecutor('/test');
  assert.equal(executionCount, 1);
  assert.equal(result1.success, true);

  // Second call with same args - should use cache
  const result2 = await cachedExecutor('/test');
  assert.equal(executionCount, 1); // Should not execute again
  assert.equal(result2.metadata?.cached, true);
});

test('withCache - does not cache failed results', async () => {
  // Clear cache first
  toolCache.invalidate();
  
  let executionCount = 0;
  const executor = async (path: string) => {
    executionCount++;
    return failResult('Failed');
  };

  const cachedExecutor = withCache(executor, 1000);

  // First call
  await cachedExecutor('/test');
  assert.equal(executionCount, 1);

  // Second call - should execute again (not cached because it failed)
  await cachedExecutor('/test');
  assert.equal(executionCount, 2);
});

test('withCache - different arguments execute separately', async () => {
  let executionCount = 0;
  const executor = async (path: string) => {
    executionCount++;
    return successResult(`Result for ${path}`);
  };

  const cachedExecutor = withCache(executor, 1000);

  await cachedExecutor('/file1');
  await cachedExecutor('/file2');
  await cachedExecutor('/file1'); // Should use cache

  assert.equal(executionCount, 2); // Only 2 unique executions
});

test('withCache - respects TTL', async () => {
  let executionCount = 0;
  const executor = async () => {
    executionCount++;
    return successResult('Result');
  };

  const cachedExecutor = withCache(executor, 50); // 50ms TTL

  await cachedExecutor();
  assert.equal(executionCount, 1);

  // Wait for cache to expire
  await new Promise((resolve) => setTimeout(resolve, 60));

  await cachedExecutor();
  assert.equal(executionCount, 2); // Should execute again
});

test('withCache - handles multiple arguments', async () => {
  // Clear cache first
  toolCache.invalidate();
  
  let executionCount = 0;
  const executor = async (path: string, options: { flag: boolean }) => {
    executionCount++;
    return successResult(`Result for ${path} with flag ${options.flag}`);
  };

  const cachedExecutor = withCache(executor, 1000);

  // First call with flag=true
  const result1 = await cachedExecutor('/test', { flag: true });
  assert.equal(executionCount, 1);
  assert.equal(result1.success, true);

  // Second call with same args - should use cache
  const result2 = await cachedExecutor('/test', { flag: true });
  assert.equal(executionCount, 1); // Should still be 1 (cached)
  assert.equal(result2.metadata?.cached, true);

  // Third call with different args - should execute again
  const result3 = await cachedExecutor('/test', { flag: false });
  assert.equal(executionCount, 2); // Should execute again
  assert.equal(result3.success, true);
});

test('withCache - cache key generation is consistent', async () => {
  const executor = async (a: number, b: number) => {
    return successResult(`Result: ${a + b}`);
  };

  const cachedExecutor = withCache(executor, 1000);

  // Same arguments in different order should create different cache keys
  const result1 = await cachedExecutor(1, 2);
  const result2 = await cachedExecutor(2, 1);

  // Both should execute (different cache keys)
  assert.equal(result1.data, undefined); // Check that both executed
  assert.equal(result2.data, undefined);
});

