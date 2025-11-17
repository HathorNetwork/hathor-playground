import { useIDEStore } from '@/store/ide-store';
import { beamTools } from '../beam';
import { syncDApp } from '../sync';
import { ToolResult } from '../types';

let queuedAutoSync: Promise<ToolResult> | null = null;
let resolveQueuedAutoSync: ((value: ToolResult) => void) | null = null;
const AUTO_SYNC_DEBOUNCE_MS = 5000;
let autoSyncTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Auto-syncs dApp files to sandbox after file writes (debounced)
 */
export async function autoSyncIfNeeded(path: string): Promise<ToolResult | null> {
  if (!path.startsWith('/dapp/')) {
    return null;
  }

  const { activeProjectId } = useIDEStore.getState();
  if (!activeProjectId) {
    return {
      success: false,
      message: '⚠️ Auto-deploy skipped: no active project selected',
      error: 'Auto-deploy skipped',
    };
  }

  if (!queuedAutoSync) {
    queuedAutoSync = new Promise<ToolResult>((resolve) => {
      resolveQueuedAutoSync = resolve;
    });
  }

  if (autoSyncTimer) {
    clearTimeout(autoSyncTimer);
  }

  autoSyncTimer = setTimeout(() => {
    autoSyncTimer = null;
    performAutoSync()
      .then((result) => resolveQueuedAutoSync?.(result))
      .catch((error: any) =>
        resolveQueuedAutoSync?.({
          success: false,
          message: error?.message || 'Auto-sync failed',
          error: String(error),
        }),
      )
      .finally(() => {
        queuedAutoSync = null;
        resolveQueuedAutoSync = null;
      });
  }, AUTO_SYNC_DEBOUNCE_MS);

  return queuedAutoSync;
}

/**
 * Performs the actual auto-sync operation
 */
async function performAutoSync(): Promise<ToolResult> {
  try {
    const syncResult = await syncDApp('ide-to-sandbox');
    if (syncResult.success) {
      return {
        ...syncResult,
        data: {
          ...syncResult.data,
          autoSyncType: 'sync',
        },
      };
    }

    const fallback = await beamTools.deployDApp();
    return {
      ...fallback,
      message: `Auto-sync failed, fallback deployment triggered.\n${fallback.message}`,
      data: {
        ...fallback.data,
        autoSyncType: 'deploy-fallback',
      },
    };
  } catch (error: any) {
    return {
      success: false,
      message: error?.message || 'Auto-sync failed',
      error: String(error),
    };
  }
}

/**
 * Formats auto-sync result into a user-friendly message
 */
export function formatAutoSyncMessage(baseMessage: string, autoSyncResult: ToolResult | null): string {
  if (!autoSyncResult) {
    return baseMessage;
  }

  if (autoSyncResult.success) {
    const url =
      autoSyncResult.data?.url ||
      autoSyncResult.data?.devServerResult?.data?.url ||
      autoSyncResult.data?.status?.url;

    const isFallback =
      autoSyncResult.data && 'autoSyncType' in autoSyncResult.data
        ? (autoSyncResult.data as any).autoSyncType === 'deploy-fallback'
        : false;

    const suffix = isFallback
      ? '\n\n⚠️ Note: Auto-sync failed, but fallback deployment succeeded.'
      : '\n\n✅ Auto-deployed to sandbox';

    return url ? `${baseMessage}${suffix}\n🌐 ${url}` : `${baseMessage}${suffix}`;
  }

  return `${baseMessage}\n\n⚠️ Auto-deploy failed: ${autoSyncResult.message || autoSyncResult.error}`;
}

