/**
 * Git Service for IDE - Manages git repositories in IndexedDB using isomorphic-git
 * Each project has its own git repository stored in IndexedDB
 */

import * as git from 'isomorphic-git';
import { File } from '@/store/ide-store';

// Simple IndexedDB-backed filesystem adapter for isomorphic-git
class IndexedDBFS {
  private dbName: string;
  private db: IDBDatabase | null = null;

  constructor(projectId: string) {
    this.dbName = `git-repo-${projectId}`;
  }

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);

      request.onerror = () => reject(new Error('Failed to open IndexedDB for git'));
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains('files')) {
          db.createObjectStore('files', { keyPath: 'path' });
        }
      };
    });
  }

  private ensureDB(): IDBDatabase {
    if (!this.db) {
      throw new Error('IndexedDB not initialized');
    }
    return this.db;
  }

  async readFile(path: string): Promise<Uint8Array> {
    const db = this.ensureDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['files'], 'readonly');
      const store = transaction.objectStore('files');
      const request = store.get(path);

      request.onsuccess = () => {
        const result = request.result;
        if (result && result.content) {
          // Convert base64 or string to Uint8Array
          if (typeof result.content === 'string') {
            const bytes = new TextEncoder().encode(result.content);
            resolve(bytes);
          } else {
            resolve(result.content);
          }
        } else {
          reject(new Error(`File not found: ${path}`));
        }
      };
      request.onerror = () => reject(new Error(`Failed to read file: ${path}`));
    });
  }

  async writeFile(path: string, data: Uint8Array): Promise<void> {
    const db = this.ensureDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['files'], 'readwrite');
      const store = transaction.objectStore('files');
      const request = store.put({ path, content: data });

      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error(`Failed to write file: ${path}`));
    });
  }

  async mkdir(path: string): Promise<void> {
    // IndexedDB doesn't need explicit directories, but we'll track them
    const db = this.ensureDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['files'], 'readwrite');
      const store = transaction.objectStore('files');
      // Create a marker file for the directory
      const request = store.put({ path: `${path}/.gitkeep`, content: new TextEncoder().encode('') });

      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error(`Failed to create directory: ${path}`));
    });
  }

  async readdir(path: string): Promise<string[]> {
    const db = this.ensureDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['files'], 'readonly');
      const store = transaction.objectStore('files');
      const request = store.getAll();

      request.onsuccess = () => {
        const results = request.result || [];
        const files = results
          .map((r: any) => r.path)
          .filter((p: string) => p.startsWith(path) && p !== path)
          .map((p: string) => p.substring(path.length + 1).split('/')[0])
          .filter((name: string, index: number, arr: string[]) => arr.indexOf(name) === index);
        resolve(files);
      };
      request.onerror = () => reject(new Error(`Failed to read directory: ${path}`));
    });
  }

  async stat(path: string): Promise<{ type: 'file' | 'dir' }> {
    const db = this.ensureDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['files'], 'readonly');
      const store = transaction.objectStore('files');
      const request = store.get(path);

      request.onsuccess = () => {
        const result = request.result;
        if (result) {
          resolve({ type: 'file' });
        } else {
          // Check if it's a directory by looking for files with this prefix
          const getAllRequest = store.getAll();
          getAllRequest.onsuccess = () => {
            const allResults = getAllRequest.result || [];
            const isDir = allResults.some((r: any) => r.path.startsWith(`${path}/`));
            resolve({ type: isDir ? 'dir' : 'file' });
          };
          getAllRequest.onerror = () => reject(new Error(`Failed to stat: ${path}`));
        }
      };
      request.onerror = () => reject(new Error(`Failed to stat: ${path}`));
    });
  }

  async unlink(path: string): Promise<void> {
    const db = this.ensureDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['files'], 'readwrite');
      const store = transaction.objectStore('files');
      const request = store.delete(path);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error(`Failed to delete file: ${path}`));
    });
  }

  async rmdir(path: string): Promise<void> {
    // Delete all files in the directory
    const db = this.ensureDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['files'], 'readwrite');
      const store = transaction.objectStore('files');
      const getAllRequest = store.getAll();

      getAllRequest.onsuccess = () => {
        const results = getAllRequest.result || [];
        const filesToDelete = results.filter((r: any) => r.path.startsWith(`${path}/`));
        
        if (filesToDelete.length === 0) {
          resolve();
          return;
        }

        let deleted = 0;
        filesToDelete.forEach((file: any) => {
          const deleteRequest = store.delete(file.path);
          deleteRequest.onsuccess = () => {
            deleted++;
            if (deleted === filesToDelete.length) {
              resolve();
            }
          };
          deleteRequest.onerror = () => reject(new Error(`Failed to delete file: ${file.path}`));
        });
      };
      getAllRequest.onerror = () => reject(new Error(`Failed to read directory: ${path}`));
    });
  }
}

export interface GitCommit {
  hash: string;
  message: string;
  author: { name: string; email: string };
  timestamp: number;
}

export interface ChangedFile {
  path: string;
  status: 'added' | 'modified' | 'deleted';
}

export class GitService {
  private static fsCache: Map<string, IndexedDBFS> = new Map();

  private static getFS(projectId: string): IndexedDBFS {
    if (!this.fsCache.has(projectId)) {
      this.fsCache.set(projectId, new IndexedDBFS(projectId));
    }
    return this.fsCache.get(projectId)!;
  }

  /**
   * Initialize git repository for a project
   */
  static async initRepo(projectId: string): Promise<void> {
    const fs = this.getFS(projectId);
    await fs.init();

    try {
      await git.init({
        fs,
        dir: '/',
        defaultBranch: 'main',
      });
    } catch (error: any) {
      // Repository might already exist, check if it's a real error
      if (!error.message?.includes('already exists')) {
        throw error;
      }
    }
  }

  /**
   * Check if git repository is initialized
   */
  static async isInitialized(projectId: string): Promise<boolean> {
    try {
      const fs = this.getFS(projectId);
      await fs.init();
      await fs.stat('/.git');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get current HEAD commit hash
   */
  static async getHeadCommit(projectId: string): Promise<string | null> {
    try {
      const fs = this.getFS(projectId);
      await fs.init();
      const ref = await git.resolveRef({ fs, dir: '/', ref: 'HEAD' });
      return ref;
    } catch {
      return null;
    }
  }

  /**
   * Commit current IDE files to git
   */
  static async commit(
    projectId: string,
    message: string,
    files: File[],
    author: { name: string; email: string } = { name: 'IDE User', email: 'ide@hathor.local' }
  ): Promise<string> {
    const fs = this.getFS(projectId);
    await fs.init();

    // Ensure repo is initialized
    const isInit = await this.isInitialized(projectId);
    if (!isInit) {
      await this.initRepo(projectId);
    }

    // Add all files to git
    for (const file of files) {
      if (file.path.startsWith('/dapp/')) {
        const gitPath = file.path.replace('/dapp/', '');
        const content = new TextEncoder().encode(file.content);
        await fs.writeFile(gitPath, content);
        await git.add({ fs, dir: '/', filepath: gitPath });
      }
    }

    // Create commit
    const commitHash = await git.commit({
      fs,
      dir: '/',
      message,
      author,
    });

    return commitHash;
  }

  /**
   * Get commit history since a specific hash
   */
  static async getCommitHistory(projectId: string, sinceHash: string | null): Promise<GitCommit[]> {
    try {
      const fs = this.getFS(projectId);
      await fs.init();

      const log = await git.log({
        fs,
        dir: '/',
        ref: 'HEAD',
      });

      const commits: GitCommit[] = [];
      for (const logEntry of log) {
        if (sinceHash && logEntry.oid === sinceHash) {
          break;
        }
        commits.push({
          hash: logEntry.oid,
          message: logEntry.commit.message,
          author: logEntry.commit.author,
          timestamp: logEntry.commit.author.timestamp * 1000, // Convert to milliseconds
        });
        if (sinceHash && logEntry.oid === sinceHash) {
          break;
        }
      }

      return commits;
    } catch {
      return [];
    }
  }

  /**
   * Get list of changed files since a specific commit
   */
  static async getChangedFiles(projectId: string, sinceHash: string | null): Promise<ChangedFile[]> {
    try {
      const fs = this.getFS(projectId);
      await fs.init();

      if (!sinceHash) {
        // All files are new
        const files = await git.listFiles({ fs, dir: '/' });
        return files.map((path) => ({ path: `/dapp/${path}`, status: 'added' as const }));
      }

      // Get list of files in HEAD
      const headFiles = await git.listFiles({ fs, dir: '/', ref: 'HEAD' });
      const headFilesSet = new Set(headFiles);

      // Get list of files in the sinceHash commit
      const sinceFiles = await git.listFiles({ fs, dir: '/', ref: sinceHash });
      const sinceFilesSet = new Set(sinceFiles);

      const changedFiles: ChangedFile[] = [];

      // Find added files (in HEAD but not in sinceHash)
      for (const file of headFiles) {
        if (!sinceFilesSet.has(file)) {
          changedFiles.push({ path: `/dapp/${file}`, status: 'added' });
        }
      }

      // Find deleted files (in sinceHash but not in HEAD)
      for (const file of sinceFiles) {
        if (!headFilesSet.has(file)) {
          changedFiles.push({ path: `/dapp/${file}`, status: 'deleted' });
        }
      }

      // Note: We're not detecting modified files here because it requires complex tree traversal
      // The sync logic will handle content comparison when syncing files
      // This function primarily detects added/deleted files for efficiency

      return changedFiles;
    } catch (error) {
      console.error('Error getting changed files:', error);
      // Fallback: return all files as potentially changed
      try {
        const fs = this.getFS(projectId);
        await fs.init();
        const files = await git.listFiles({ fs, dir: '/' });
        return files.map((path) => ({ path: `/dapp/${path}`, status: 'modified' as const }));
      } catch {
        return [];
      }
    }
  }

  /**
   * Check if there are uncommitted changes
   */
  static async hasUncommittedChanges(projectId: string, files: File[]): Promise<boolean> {
    try {
      const fs = this.getFS(projectId);
      await fs.init();

      const headHash = await this.getHeadCommit(projectId);
      if (!headHash) {
        return files.length > 0; // No commits yet, any files = uncommitted
      }

      // Compare current files with HEAD
      const changedFiles = await this.getChangedFiles(projectId, headHash);
      return changedFiles.length > 0;
    } catch {
      return false;
    }
  }
}

