import { beamClient } from '../beam-client';
import { getDappFilesSnapshot, shouldIgnorePath } from '../state/files';
import { buildManifest, diffManifests, loadManifest, saveManifest } from '../sync/manifest';
import { useIDEStore } from '@/store/ide-store';

import { ToolResult } from './types';

type SyncDirection = 'ide-to-sandbox' | 'sandbox-to-ide' | 'bidirectional';

const MAX_SANDBOX_WAIT_MS = 60000; // 1 minute
const SANDBOX_POLL_INTERVAL_MS = 2000; // 2 seconds

// Prevent concurrent wait operations on the same sandbox
const sandboxReadyPromises = new Map<string, Promise<boolean>>();

interface SandboxEntry {
  path: string;
  encoding: 'base64';
  size: number;
  content: string;
}

async function fetchSandboxPage(projectId: string, path?: string, cursor?: string) {
  const params = new URLSearchParams();
  if (path) params.set('path', path);
  if (cursor) params.set('cursor', cursor);
  params.set('limit', '200');
  const response = await fetch(`/api/beam/sandbox/${projectId}/files?${params.toString()}`);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || response.statusText);
  }
  return response.json();
}

async function fetchAllSandboxFiles(projectId: string, path?: string): Promise<SandboxEntry[]> {
  let cursor: string | null = null;
  const entries: SandboxEntry[] = [];

  do {
    const page = await fetchSandboxPage(projectId, path, cursor ?? undefined);
    entries.push(...(page.entries || []));
    cursor = page.cursor;
    if (!page.hasMore) {
      break;
    }
  } while (cursor);

  return entries;
}

function decodeEntryContent(entry: SandboxEntry): string {
  if (entry.encoding === 'base64') {
    if (typeof window === 'undefined') return '';
    const binary = window.atob(entry.content);
    const length = binary.length;
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
  }
  return entry.content;
}

interface SyncOptions {
  forceFullUpload?: boolean;
}

async function _doWaitForSandboxReady(projectId: string): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < MAX_SANDBOX_WAIT_MS) {
    try {
      // Try to fetch sandbox info
      const response = await fetch(`/api/beam/sandbox/${projectId}`);

      if (response.ok) {
        const data = await response.json();
        if (data && data.url) {
          console.log('[SYNC] Sandbox ready:', projectId);
          return true;
        }
      }

      if (response.status === 404) {
        console.log('[SYNC] Sandbox not found, creating...');
        // Trigger sandbox creation (only once per concurrent batch)
        const createResponse = await fetch(`/api/beam/sandbox/create`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project_id: projectId }),
        });

        if (!createResponse.ok) {
          console.error('[SYNC] Failed to create sandbox');
          return false;
        }
      }

      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, SANDBOX_POLL_INTERVAL_MS));
    } catch (error: any) {
      console.warn('[SYNC] Error checking sandbox:', error?.message);
      // Continue retrying
    }
  }

  console.error('[SYNC] Timeout waiting for sandbox to be ready');
  return false;
}

async function waitForSandboxReady(projectId: string): Promise<boolean> {
  // Check if another sync is already waiting for this sandbox
  const existing = sandboxReadyPromises.get(projectId);
  if (existing) {
    console.log('[SYNC] Reusing existing wait promise for:', projectId);
    return existing;
  }

  // Start new wait operation
  const promise = _doWaitForSandboxReady(projectId);
  sandboxReadyPromises.set(projectId, promise);

  try {
    return await promise;
  } finally {
    // Clean up after completion
    sandboxReadyPromises.delete(projectId);
  }
}

export async function syncDApp(
  direction: SyncDirection = 'bidirectional',
  projectId?: string,
  options?: SyncOptions,
): Promise<ToolResult> {
  try {
    const activeProjectId = projectId || useIDEStore.getState().activeProjectId;
    const { addConsoleMessage } = useIDEStore.getState();

    if (!activeProjectId) {
      return {
        success: false,
        message: 'No active project',
        error: 'Select or create a project first',
      };
    }

    // Wait for sandbox to be ready before syncing
    addConsoleMessage?.('info', '⏳ Checking sandbox status...');
    const sandboxReady = await waitForSandboxReady(activeProjectId);

    if (!sandboxReady) {
      return {
        success: false,
        message: '❌ Sandbox not ready',
        error: 'Sandbox failed to start or timeout waiting for sandbox',
      };
    }

    addConsoleMessage?.('info', `🔄 Starting ${direction} manifest sync...`);

    const currentManifest = buildManifest();
    const previousManifest = loadManifest(activeProjectId);
    const { addedOrChanged, deleted } = diffManifests(currentManifest, previousManifest);

    let uploaded = 0;
    let downloaded = 0;
    let removed = 0;

    if (direction === 'ide-to-sandbox' || direction === 'bidirectional') {
      const snapshot = getDappFilesSnapshot();
      const filesToUpload =
        options?.forceFullUpload || !previousManifest || Object.keys(previousManifest).length === 0
          ? snapshot.map((file) => file.path)
          : addedOrChanged;

      if (filesToUpload.length > 0) {
        const payload: Record<string, string> = {};
        for (const filePath of filesToUpload) {
          const file = snapshot.find((entry) => entry.path === filePath);
          if (file && !shouldIgnorePath(file.path)) {
            payload[file.path.replace('/dapp/', '/app/')] = file.content;
          }
        }

        if (Object.keys(payload).length > 0) {
          await beamClient.uploadFiles(activeProjectId, payload, false);
          uploaded = Object.keys(payload).length;
        }
      }
    }

    if (direction === 'sandbox-to-ide' || direction === 'bidirectional') {
      const sandboxEntries = await fetchAllSandboxFiles(activeProjectId);

      for (const entry of sandboxEntries) {
      const idePath = entry.path.startsWith('/dapp/')
        ? entry.path
        : entry.path.replace('/app/', '/dapp/');
      if (shouldIgnorePath(idePath)) {
        continue;
      }
        const storeState = useIDEStore.getState();
        const existingFile = storeState.files.find((f) => f.path === idePath);
        const decodedContent = decodeEntryContent(entry);

        if (existingFile) {
          storeState.updateFile(existingFile.id, decodedContent);
        } else {
          storeState.addFile({
            name: idePath.split('/').pop() || 'unknown',
            path: idePath,
            content: decodedContent,
            type: 'component',
            language: idePath.endsWith('.tsx')
              ? 'typescriptreact'
              : idePath.endsWith('.ts')
              ? 'typescript'
              : idePath.endsWith('.json')
              ? 'json'
              : idePath.endsWith('.css')
              ? 'css'
              : 'typescript',
          });
        }
        downloaded++;
      }
    }

    if ((direction === 'sandbox-to-ide' || direction === 'bidirectional') && deleted.length > 0) {
      const storeState = useIDEStore.getState();
      for (const path of deleted) {
        const file = storeState.files.find((f) => f.path === path);
        if (file) {
          storeState.deleteFile(file.id);
          removed++;
        }
      }
    }

    saveManifest(activeProjectId, buildManifest());

    const summary = [
      '✅ Manifest sync completed',
      uploaded ? `📤 Uploaded ${uploaded} file(s)` : '',
      downloaded ? `📥 Downloaded ${downloaded} file(s)` : '',
      removed ? `🗑️ Removed ${removed} file(s)` : '',
    ]
      .filter(Boolean)
      .join('\n');

    addConsoleMessage?.('success', summary);

    return {
      success: true,
      message: summary,
      data: {
        direction,
        uploaded,
        downloaded,
        removed,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: '❌ Manifest sync failed',
      error: String(error),
    };
  }
}

