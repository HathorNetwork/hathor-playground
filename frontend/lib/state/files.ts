import { useIDEStore } from '@/store/ide-store';
import type { File } from '@/store/ide-store';

export interface FileSnapshot extends Omit<File, 'id'> {
  id: string;
}

export function getDappFilesSnapshot(): FileSnapshot[] {
  const { files } = useIDEStore.getState();
  return files
    .filter((file) => file.path.startsWith('/dapp/'))
    .map((file) => ({ ...file }));
}

