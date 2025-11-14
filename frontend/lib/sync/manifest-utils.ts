export interface ManifestEntry {
  path: string;
  hash: string;
  size: number;
}

export type Manifest = Record<string, ManifestEntry>;

export function hashContent(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
}

export function diffManifests(current: Manifest, previous: Manifest) {
  const addedOrChanged: string[] = [];
  const deleted: string[] = [];

  for (const [path, entry] of Object.entries(current)) {
    const prev = previous[path];
    if (!prev || prev.hash !== entry.hash) {
      addedOrChanged.push(path);
    }
  }

  for (const path of Object.keys(previous)) {
    if (!current[path]) {
      deleted.push(path);
    }
  }

  return { addedOrChanged, deleted };
}

