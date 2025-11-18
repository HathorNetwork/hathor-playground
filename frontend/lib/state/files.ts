import { useIDEStore } from '@/store/ide-store';
import type { File } from '@/store/ide-store';

export interface FileSnapshot extends Omit<File, 'id'> {
  id: string;
}

const IGNORED_FILENAMES = new Set(['.DS_Store', 'Thumbs.db']);

export function shouldIgnorePath(path: string): boolean {
  const fileName = path.split('/').pop() || '';
  if (!fileName) {
    return false;
  }

  if (fileName.startsWith('._')) {
    return true;
  }

  return IGNORED_FILENAMES.has(fileName);
}

function removeIgnoredFilesFromStore() {
  const store = useIDEStore.getState();
  const ignoredFiles = store.files.filter((file) => shouldIgnorePath(file.path));

  if (ignoredFiles.length === 0) {
    return;
  }

  ignoredFiles.forEach((file) => {
    store.deleteFile(file.id);
  });
}

export function getDappFilesSnapshot(): FileSnapshot[] {
  removeIgnoredFilesFromStore();

  const { files } = useIDEStore.getState();
  return files
    .filter((file) => file.path.startsWith('/dapp/') && !shouldIgnorePath(file.path))
    .map((file) => ({ ...file }));
}

