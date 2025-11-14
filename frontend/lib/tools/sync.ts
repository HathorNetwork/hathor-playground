import { beamClient } from '../beam-client';
import { getDappFilesSnapshot } from '../state/files';
import { buildManifest, diffManifests, loadManifest, saveManifest } from '../sync/manifest';
import { useIDEStore } from '@/store/ide-store';

import { ToolResult } from './types';

type SyncDirection = 'ide-to-sandbox' | 'sandbox-to-ide' | 'bidirectional';

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

export async function syncDApp(
  direction: SyncDirection = 'bidirectional',
  projectId?: string,
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
        previousManifest && Object.keys(previousManifest).length > 0
          ? addedOrChanged
          : snapshot.map((file) => file.path);

      if (filesToUpload.length > 0) {
        const payload: Record<string, string> = {};
        for (const filePath of filesToUpload) {
          const file = snapshot.find((entry) => entry.path === filePath);
          if (file) {
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

