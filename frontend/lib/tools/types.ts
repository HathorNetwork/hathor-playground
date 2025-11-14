import type { File } from '@/store/ide-store';

export interface ToolResult<T = any> {
  success: boolean;
  message: string;
  data?: T;
  error?: string;
}

export type HathorFile = Omit<File, 'id'>;

