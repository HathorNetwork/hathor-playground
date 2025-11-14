import { getDappFilesSnapshot } from '../state/files';
import { Manifest, hashContent, diffManifests } from './manifest-utils';

export function buildManifest(): Manifest {
  const files = getDappFilesSnapshot();
  return files.reduce<Manifest>((manifest, file) => {
    manifest[file.path] = {
      path: file.path,
      hash: hashContent(file.content),
      size: file.content.length,
    };
    return manifest;
  }, {});
}

const STORAGE_PREFIX = 'hathor-manifest';

export function loadManifest(projectId: string): Manifest {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}-${projectId}`);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function saveManifest(projectId: string, manifest: Manifest) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}-${projectId}`, JSON.stringify(manifest));
  } catch (error) {
    console.warn('Failed to persist manifest', error);
  }
}

export { diffManifests } from './manifest-utils';
export type { Manifest, ManifestEntry } from './manifest-utils';

