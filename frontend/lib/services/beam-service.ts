/**
 * BEAM Cloud service for managing dApp sandboxes using TypeScript SDK
 */

import { Sandbox, Image, beamOpts, Pod, TaskPolicy } from '@beamcloud/beam-js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec as execCallback } from 'child_process';
import { promisify } from 'util';

const exec = promisify(execCallback);
const fsp = fs.promises;

const DEFAULT_CODE_PATH = '/app';
const DEFAULT_PORT = 3000;

const baseImagePromise: Promise<Image> = (async () => {
  configureBEAM();
  const image = new Image({
    baseImage: 'node:20',
    commands: [
      'apt-get update && apt-get install -y git curl',
      'npm install -g pnpm',
      'mkdir -p /app',
      'chmod 755 /app',
    ],
  });
  await image.build();
  return image;
})();

/**
 * Configure BEAM SDK with environment variables
 * Called at runtime to ensure env vars are loaded
 */
function configureBEAM() {
  if (!beamOpts.token) {
    beamOpts.token = process.env.BEAM_TOKEN || '';
    beamOpts.workspaceId = process.env.BEAM_WORKSPACE_ID || '';
    beamOpts.gatewayUrl = 'https://app.beam.cloud';

    console.log('BEAM SDK configured:', {
      hasToken: !!beamOpts.token,
      hasWorkspaceId: !!beamOpts.workspaceId,
      tokenLength: beamOpts.token?.length || 0
    });

    if (!beamOpts.token || !beamOpts.workspaceId) {
      throw new Error('BEAM_TOKEN and BEAM_WORKSPACE_ID must be set in environment variables');
    }
  }
}

export interface SandboxInfo {
  url: string;
  sandbox_id: string;
  project_id: string;
  dev_server_running?: boolean;
}

export interface UploadResult {
  status: string;
  project_id: string;
  files_uploaded: number;
}

// Use global to persist across Next.js hot reloads in development
const globalForBeam = global as typeof globalThis & {
  beamSandboxes?: Map<string, any>;
  beamUrls?: Map<string, string>;
  beamProcesses?: Map<string, any>;
  beamBuildLogs?: Map<string, string[]>;
  beamBuildInProgress?: Map<string, boolean>;
};

export class BeamService {
  private sandboxes: Map<string, any>;
  private urls: Map<string, string>;
  private processes: Map<string, any>;
  private buildLogs: Map<string, string[]>;
  private buildInProgress: Map<string, boolean>;

  constructor() {
    // Reuse existing maps if they exist (persists across hot reloads)
    this.sandboxes = globalForBeam.beamSandboxes || new Map();
    this.urls = globalForBeam.beamUrls || new Map();
    this.processes = globalForBeam.beamProcesses || new Map();
    this.buildLogs = globalForBeam.beamBuildLogs || new Map();
    this.buildInProgress = globalForBeam.beamBuildInProgress || new Map();

    // Store in global
    globalForBeam.beamSandboxes = this.sandboxes;
    globalForBeam.beamUrls = this.urls;
    globalForBeam.beamProcesses = this.processes;
    globalForBeam.beamBuildLogs = this.buildLogs;
    globalForBeam.beamBuildInProgress = this.buildInProgress;
  }

  private async ensureSandboxInstance(projectId: string) {
    let instance = this.sandboxes.get(projectId);
    if (!instance) {
      await this.createSandbox(projectId);
      instance = this.sandboxes.get(projectId);
    }

    if (!instance) {
      throw new Error('Failed to create sandbox for project ' + projectId);
    }

    return instance;
  }

  private async ensureLiveSandbox(projectId: string) {
    let instance = await this.ensureSandboxInstance(projectId);
    try {
      await instance.fs.statFile('/');
      return instance;
    } catch {
      console.warn('Cached sandbox is dead/stale, recreating for:', projectId);
      this.invalidateSandbox(projectId);
      await this.createSandbox(projectId);
      instance = this.sandboxes.get(projectId);
      if (!instance) {
        throw new Error('Failed to recreate sandbox for project ' + projectId);
      }
      return instance;
    }
  }

  private invalidateSandbox(projectId: string) {
    this.sandboxes.delete(projectId);
    this.urls.delete(projectId);
    this.processes.delete(projectId);
  }

  private getSandboxId(instance: any, projectId: string) {
    if (!instance) {
      return `sandbox-${projectId}`;
    }
    if (typeof instance.sandboxId === 'function') {
      try {
        const id = instance.sandboxId();
        if (id) return id;
      } catch {
        // fall through
      }
    }
    return instance.id || `sandbox-${projectId}`;
  }

  private async isDevServerRunning(projectId: string): Promise<boolean> {
    const process = this.processes.get(projectId);
    if (!process) {
      return false;
    }

    if (typeof process.status === 'function') {
      try {
        const [exitCode, status] = await process.status();
        if (typeof status === 'string') {
          const running = status.toLowerCase() === 'running';
          if (!running) {
            this.processes.delete(projectId);
          }
          return running;
        }

        if (typeof exitCode === 'number' && exitCode >= 0) {
          this.processes.delete(projectId);
          return false;
        }
      } catch (error) {
        console.warn('[DEV_SERVER] status() failed, assuming process ended:', error);
        this.processes.delete(projectId);
        return false;
      }
    }

    return true;
  }

  private shouldSkipPath(sandboxPath: string) {
    return (
      sandboxPath.includes('/node_modules/') ||
      sandboxPath.includes('/.git/') ||
      sandboxPath.includes('/.next/') ||
      sandboxPath.includes('/.cache/') ||
      sandboxPath.includes('/.npm/') ||
      sandboxPath.includes('/.yarn/') ||
      sandboxPath.includes('/dist/') ||
      sandboxPath.includes('/build/') ||
      sandboxPath.endsWith('.DS_Store') ||
      (sandboxPath.includes('/logs/') && sandboxPath.endsWith('.log'))
    );
  }

  private async collectSandboxFiles(
    instance: any,
    remotePath: string,
    files: Array<{ path: string; content: Buffer }>,
  ) {
    let entries: Array<{ name: string; isDir: boolean }> = [];
    try {
      entries = await instance.fs.listFiles(remotePath);
    } catch (error: any) {
      console.warn(`[DOWNLOAD] Failed to list ${remotePath}:`, error?.message || error);
      return;
    }

    for (const entry of entries) {
      const entryName = entry.name;
      if (!entryName || entryName === '.' || entryName === '..') continue;
      const fullPath = path.posix.join(remotePath, entryName);

      if (entry.isDir) {
        if (this.shouldSkipPath(fullPath + '/')) {
          continue;
        }
        await this.collectSandboxFiles(instance, fullPath, files);
        continue;
      }

      if (this.shouldSkipPath(fullPath)) {
        continue;
      }

      try {
        const tmpFile = path.join(
          os.tmpdir(),
          'beam-download-' + Date.now() + '-' + path.basename(fullPath),
        );
        await instance.fs.downloadFile(fullPath, tmpFile);
        const content = fs.readFileSync(tmpFile);
        const frontendPath = fullPath.replace(DEFAULT_CODE_PATH + '/', '/dapp/');
        files.push({ path: frontendPath, content });
        fs.unlinkSync(tmpFile);
      } catch (error: any) {
        console.warn(`[DOWNLOAD] Failed to download ${fullPath}:`, error?.message || error);
      }
    }
  }

  private sanitizeArchivePath(filePath: string) {
    const normalized = filePath.replace(/^\/+/, '');
    return normalized.replace(/\.\./g, '');
  }

  private async createArchiveFromFiles(files: Record<string, string>) {
    const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'beam-sync-'));
    const stagingDir = path.join(tempRoot, 'payload');
    await fsp.mkdir(stagingDir, { recursive: true });

    for (const [sandboxPath, content] of Object.entries(files)) {
      const relativePath = this.sanitizeArchivePath(sandboxPath);
      const targetPath = path.join(stagingDir, relativePath);
      await fsp.mkdir(path.dirname(targetPath), { recursive: true });
      await fsp.writeFile(targetPath, content, 'utf-8');
    }

    const archivePath = path.join(tempRoot, 'upload.tgz');
    await exec(`cd "${stagingDir}" && tar -czf "${archivePath}" .`);

    return {
      archivePath,
      cleanup: () => fsp.rm(tempRoot, { recursive: true, force: true }),
    };
  }

  private async uploadFilesIndividually(
    instance: any,
    files: Record<string, string>,
  ) {
    for (const [filePath, content] of Object.entries(files)) {
      let sandboxPath = filePath;
      if (sandboxPath.startsWith('/dapp/')) {
        sandboxPath = sandboxPath.replace('/dapp/', DEFAULT_CODE_PATH + '/');
      } else if (!sandboxPath.startsWith(DEFAULT_CODE_PATH)) {
        sandboxPath = DEFAULT_CODE_PATH + sandboxPath;
      }

      const parentDir = path.dirname(sandboxPath);
      try {
        await instance.fs.statFile(parentDir);
      } catch {
        await instance.exec('mkdir', '-p', parentDir);
      }

      const tmpFile = path.join(
        os.tmpdir(),
        'beam-upload-' + Date.now() + '-' + path.basename(filePath),
      );
      fs.writeFileSync(tmpFile, content);

      try {
        await instance.fs.uploadFile(tmpFile, sandboxPath);
        console.log('Uploaded:', sandboxPath);
      } finally {
        fs.unlinkSync(tmpFile);
      }
    }
  }

  private async uploadFilesWithArchive(
    instance: any,
    files: Record<string, string>,
  ) {
    const { archivePath, cleanup } = await this.createArchiveFromFiles(files);
    try {
      const remoteArchive = '/tmp/dapp-upload.tgz';
      await instance.fs.uploadFile(archivePath, remoteArchive);
      const extractProc = await instance.exec(
        'sh',
        '-c',
        `tar -xzf ${remoteArchive} -C / && rm ${remoteArchive}`,
      );
      await extractProc.wait();
    } finally {
      await cleanup();
    }
  }

  /**
   * Capture console output during a function execution
   */
  private captureConsoleOutput(projectId: string, fn: () => Promise<any>) {
    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;

    const captureLog = (...args: any[]) => {
      const message = args.map(arg => String(arg)).join(' ');
      const logs = this.buildLogs.get(projectId) || [];
      logs.push(message);
      this.buildLogs.set(projectId, logs);
      originalLog(...args); // Still log to console
    };

    console.log = captureLog;
    console.error = captureLog;
    console.warn = captureLog;

    return fn().finally(() => {
      console.log = originalLog;
      console.error = originalError;
      console.warn = originalWarn;
      this.buildInProgress.set(projectId, false);
    });
  }

  async createSandbox(projectId: string): Promise<SandboxInfo> {
    configureBEAM(); // Ensure SDK is configured

    // Check if we already have this sandbox in memory
    const existingInstance = this.sandboxes.get(projectId);
    if (existingInstance) {
      console.log('Sandbox already exists in memory for project:', projectId);
      const existingUrl = this.urls.get(projectId);
      if (existingUrl) {
        return {
          url: existingUrl,
          sandbox_id: existingInstance.id || 'sandbox-' + projectId,
          project_id: projectId
        };
      }
    }

    console.log('Creating sandbox for project:', projectId);

    // Initialize build logs
    this.buildLogs.set(projectId, ['Starting sandbox creation...', 'Building Docker image...']);
    this.buildInProgress.set(projectId, true);

    const image = await baseImagePromise;
    const sandbox = new Sandbox({
      name: 'hathor-dapp-' + projectId,
      cpu: 1,
      memory: '1Gi',
      image: image,
      keepWarmSeconds: 300,
    });

    // Capture console output during sandbox creation
    const instance = await this.captureConsoleOutput(projectId, async () => {
      return await sandbox.create();
    });

    const url = await instance.exposePort(DEFAULT_PORT);
    const sandboxId = this.getSandboxId(instance, projectId);

    this.sandboxes.set(projectId, instance);
    this.urls.set(projectId, url);

    // Add completion message
    const logs = this.buildLogs.get(projectId) || [];
    logs.push('✓ Sandbox created successfully!');
    logs.push('✓ Port exposed: ' + url);
    this.buildLogs.set(projectId, logs);

    return { url, sandbox_id: sandboxId, project_id: projectId, dev_server_running: this.processes.has(projectId) };
  }

  async getSandbox(projectId: string): Promise<any | null> {
    console.log('[getSandbox] Looking for projectId:', projectId);
    console.log('[getSandbox] Available sandboxes:', Array.from(this.sandboxes.keys()));
    const instance = this.sandboxes.get(projectId);
    if (!instance) {
      console.log('[getSandbox] NOT FOUND for:', projectId);
      return null;
    }

    console.log('[getSandbox] FOUND sandbox for:', projectId);
    // Note: We're NOT calling updateTtl() because BEAM API returns 501 (Not Implemented)
    // The sandbox keepWarmSeconds is set during creation instead
    return instance;
  }

  async getSandboxInfo(projectId: string): Promise<SandboxInfo | null> {
    const instance = await this.getSandbox(projectId);
    if (!instance) return null;

    const url = this.urls.get(projectId);
    if (!url) return null;

    const running = await this.isDevServerRunning(projectId);

    return {
      sandbox_id: this.getSandboxId(instance, projectId),
      url,
      project_id: projectId,
      dev_server_running: running,
    };
  }

  async uploadFiles(
    projectId: string,
    files: Record<string, string>,
    autoStart: boolean = true
  ): Promise<UploadResult> {
    console.log('[UPLOAD] =================== uploadFiles called for:', projectId);
    let instance = await this.ensureLiveSandbox(projectId);

    console.log('Uploading', Object.keys(files).length, 'files to sandbox:', projectId);

    if (Object.keys(files).length > 0) {
      console.log('Creating archive for', Object.keys(files).length, 'files');
      try {
        await this.uploadFilesWithArchive(instance, files);
      } catch (archiveError) {
        console.warn('Archive upload failed, falling back to per-file upload:', archiveError);
        await this.uploadFilesIndividually(instance, files);
      }
    }

    if (autoStart && !this.processes.has(projectId)) {
      try {
        await this.startDevServer(projectId);
      } catch (error) {
        console.warn('Failed to auto-start:', error);
      }
    }

    return {
      status: 'success',
      project_id: projectId,
      files_uploaded: Object.keys(files).length,
    };
  }

  async startDevServer(projectId: string): Promise<{ status: string; url: string; logs: string[] }> {
    const logs: string[] = [];
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;

    const capture = (...args: any[]) => {
      const message = args.map(arg => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ');
      logs.push(message);
      originalLog(...args);
    };

    console.log = capture;
    console.warn = capture;
    console.error = capture;

    try {
      console.log('[START_DEV] =================== startDevServer called for:', projectId);
      let instance = await this.ensureLiveSandbox(projectId);

      let projectRoot = DEFAULT_CODE_PATH;
      try {
        await instance.fs.statFile(DEFAULT_CODE_PATH + '/package.json');
        projectRoot = DEFAULT_CODE_PATH;
      } catch {
        const findProc = await instance.exec('sh', '-c', `find ${DEFAULT_CODE_PATH} -maxdepth 2 -name package.json | head -n 1 | xargs dirname`);
        await findProc.wait();
        const detected = (await findProc.stdout.read())?.trim();
        if (detected) {
          projectRoot = detected;
          console.log('Detected project root at', projectRoot);
        } else {
          console.log('No package.json found under /app; dev server may fail to start');
        }
      }

      try {
        const installCmd = `cd ${projectRoot} && pnpm install`;
        const installProc = await instance.exec('sh', '-c', installCmd);
        await installProc.wait();
      } catch {
        console.log('Dependency install skipped/failed (no package.json yet?)');
      }

      const devCmd = `cd ${projectRoot} && npx next dev --port ${DEFAULT_PORT}`;
      console.log('Starting dev server with command:', devCmd);
      const process = await instance.exec('sh', '-c', devCmd);
      this.processes.set(projectId, process);

      const url = this.urls.get(projectId);
      if (!url) throw new Error('Sandbox URL not found');

      console.log('Dev server exposed at:', url);

      return { status: 'success', url, logs };
    } catch (error) {
      console.error('Failed to start dev server:', error);
      throw error;
    } finally {
      console.log = originalLog;
      console.warn = originalWarn;
      console.error = originalError;
    }
  }

  async stopDevServer(projectId: string): Promise<{ status: string }> {
    const process = this.processes.get(projectId);
    if (!process) {
      return { status: 'not_running' };
    }

    try {
      if (typeof process.kill === 'function') {
        await process.kill();
      } else if (typeof process.terminate === 'function') {
        await process.terminate();
      } else {
        await this.runCommand(projectId, `pkill -f "next dev --port ${DEFAULT_PORT}"`);
      }
    } catch (error: any) {
      console.warn('Failed to stop dev server process:', error);
      throw new Error(error?.message || 'Failed to stop dev server process');
    } finally {
      this.processes.delete(projectId);
    }

    return { status: 'stopped' };
  }

  async terminateSandbox(projectId: string): Promise<{ status: string }> {
    const instance = this.sandboxes.get(projectId);
    if (!instance) {
      return { status: 'not_found' };
    }

    try {
      if (typeof instance.terminate === 'function') {
        await instance.terminate();
      } else {
        // Fallback: stop dev server and invalidate maps
        await this.stopDevServer(projectId);
      }
    } finally {
      this.invalidateSandbox(projectId);
    }

    return { status: 'terminated' };
  }

  async runHeavyTask(command: string, cwd: string = DEFAULT_CODE_PATH): Promise<{ output: string; url?: string }> {
    configureBEAM();
    const image = await baseImagePromise;
    const pod = new Pod({
      name: `hathor-heavy-${Date.now()}`,
      cpu: 2,
      memory: '2Gi',
      image,
      taskPolicy: new TaskPolicy({
        timeout: 900,
        maxRetries: 0,
      }),
    });

    const entrypoint = ['sh', '-c', `cd ${cwd} && ${command}`];
    const result = await pod.create(entrypoint);
    const output = Array.isArray(result.logs) ? result.logs.join('\n') : result.logs || '';

    return {
      output,
      url: result.url,
    };
  }

  async runCommand(projectId: string, command: string) {
    console.log('[RUN_COMMAND] =================== runCommand called for:', projectId);
    let instance = await this.ensureLiveSandbox(projectId);

    try {
      // Ensure /app exists (for backward compatibility with existing sandboxes)
      try {
        await instance.fs.statFile(DEFAULT_CODE_PATH);
      } catch {
        console.log('Creating missing /app directory for existing sandbox');
        await instance.exec('mkdir', '-p', DEFAULT_CODE_PATH);
      }

      // Now cd to /app and run the command
      const fullCommand = `cd ${DEFAULT_CODE_PATH} && ${command}`;
      console.log('Executing command:', fullCommand);
      const process = await instance.exec('sh', '-c', fullCommand);
      const result = await process.wait();

      const stdout = await process.stdout.read();
      const stderr = await process.stderr.read();

      const exitCode = result.exitCode?.toString() || '0';
      console.log('Command result - exit code:', exitCode, 'stdout:', stdout?.slice(0, 200), 'stderr:', stderr?.slice(0, 200));
      return { stdout: stdout || '', stderr: stderr || '', exit_code: exitCode, command };
    } catch (error: any) {
      console.error('Command execution error:', error);
      return { stdout: '', stderr: error.message || String(error), exit_code: '1', command };
    }
  }

  async downloadFiles(projectId: string, remotePath: string = DEFAULT_CODE_PATH) {
    console.log('[DOWNLOAD] =================== downloadFiles called for:', projectId);
    const instance = await this.ensureLiveSandbox(projectId);
    const files: Array<{ path: string; content: Buffer }> = [];

    await this.collectSandboxFiles(instance, remotePath, files);

    console.log(`[DOWNLOAD] Returning ${files.length} files. Keys:`, files.slice(0, 10).map((f) => f.path));
    return files;
  }

  async getRecentLogs(projectId: string, lines: number = 50): Promise<string> {
    const process = this.processes.get(projectId);
    if (!process) return 'No active process found. Start the dev server first.';

    try {
      const stdout = await process.stdout.read();
      const logLines = stdout.split('\n');
      return logLines.slice(-lines).join('\n') || 'No logs available yet.';
    } catch (error: any) {
      return 'Error getting logs: ' + error.message;
    }
  }

  async *streamLogs(projectId: string): AsyncGenerator<string> {
    const process = this.processes.get(projectId);
    if (!process) {
      yield 'No active dev server found\n';
      return;
    }

    try {
      while (true) {
        const stdout = await process.stdout.read();
        if (stdout) yield stdout + '\n';
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (error: any) {
      yield 'ERROR: ' + error.message + '\n';
    }
  }

  /**
   * Stream build logs for a project
   * Returns accumulated logs + new logs as they arrive
   */
  async *streamBuildLogs(projectId: string): AsyncGenerator<string> {
    let lastIndex = 0;

    while (true) {
      const logs = this.buildLogs.get(projectId) || [];
      const buildInProgress = this.buildInProgress.get(projectId) || false;

      // Send new logs
      for (let i = lastIndex; i < logs.length; i++) {
        yield logs[i];
        lastIndex = i + 1;
      }

      // If build is complete and we've sent all logs, stop
      if (!buildInProgress && lastIndex >= logs.length) {
        break;
      }

      // Wait before checking for more logs
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Clean up logs after streaming completes
    setTimeout(() => {
      this.buildLogs.delete(projectId);
    }, 60000); // Keep logs for 1 minute after completion
  }

  /**
   * Get all build logs for a project (for debugging)
   */
  getBuildLogs(projectId: string): string[] {
    return this.buildLogs.get(projectId) || [];
  }

  /**
   * Ensure git repository exists in sandbox, initialize if needed
   */
  async ensureGitRepo(projectId: string): Promise<void> {
    const instance = await this.ensureLiveSandbox(projectId);

    // Check if .git exists
    try {
      await instance.fs.statFile(`${DEFAULT_CODE_PATH}/.git`);
      // Git repo exists
      return;
    } catch {
      // Git repo doesn't exist, initialize it
      const initResult = await this.runCommand(projectId, 'git init');
      if (initResult.exit_code !== '0') {
        throw new Error(`Failed to initialize git repo: ${initResult.stderr}`);
      }

      // Configure git user (required for commits)
      await this.runCommand(projectId, 'git config user.name "Sandbox User"');
      await this.runCommand(projectId, 'git config user.email "sandbox@hathor.local"');
    }
  }

  /**
   * Commit current sandbox state
   */
  async commitSandboxState(projectId: string, message: string = 'Sync checkpoint'): Promise<string> {
    await this.ensureGitRepo(projectId);

    // Add all files (including in subdirectories)
    const addResult = await this.runCommand(projectId, 'git add -A');
    if (addResult.exit_code !== '0' && !addResult.stderr.includes('nothing to commit')) {
      console.warn('git add failed:', addResult.stderr);
    }

    // Check if there are changes to commit
    const statusResult = await this.runCommand(projectId, 'git status --porcelain');
    const hasChanges = statusResult.stdout.trim().length > 0;
    
    if (!hasChanges) {
      // No changes, return current HEAD if it exists
      const headResult = await this.getSandboxHeadCommit(projectId);
      return headResult || '';
    }

    // Create commit
    const commitResult = await this.runCommand(
      projectId,
      `git commit -m "${message.replace(/"/g, '\\"')}"`
    );

    if (commitResult.exit_code !== '0') {
      // Check if it's because there's nothing to commit (empty repo with no files)
      if (commitResult.stderr.includes('nothing to commit') || 
          commitResult.stderr.includes('no changes') ||
          commitResult.stderr.includes('nothing added to commit')) {
        // Try to get existing HEAD, or return empty string if no commits exist
        const headHash = await this.getSandboxHeadCommit(projectId);
        return headHash || '';
      }
      // Log the error but don't throw - we want to continue even if commit fails
      console.warn(`Failed to commit sandbox state: ${commitResult.stderr}`);
      // Try to get existing HEAD anyway
      const headHash = await this.getSandboxHeadCommit(projectId);
      return headHash || '';
    }

    // Get the new commit hash
    const headHash = await this.getSandboxHeadCommit(projectId);
    return headHash || '';
  }

  /**
   * Get sandbox HEAD commit hash
   */
  async getSandboxHeadCommit(projectId: string): Promise<string | null> {
    try {
      await this.ensureGitRepo(projectId);
      
      // First check if there are any commits
      const logResult = await this.runCommand(projectId, 'git log --oneline -n 1');
      // Check both exit code and stderr for "no commits" messages
      if (logResult.exit_code !== '0' || 
          !logResult.stdout.trim() || 
          logResult.stderr.includes('does not have any commits') ||
          logResult.stderr.includes('fatal: your current branch')) {
        // No commits yet
        return null;
      }
      
      // Get the actual commit hash
      const result = await this.runCommand(projectId, 'git rev-parse HEAD');
      if (result.exit_code === '0' && result.stdout.trim()) {
        const hash = result.stdout.trim();
        // Make sure it's not the literal "HEAD" string and is a valid hash
        if (hash === 'HEAD' || hash.length < 7 || result.stderr.includes('unknown revision')) {
          return null;
        }
        return hash;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Get list of changed files since a specific commit hash
   */
  async getSandboxChangedFiles(projectId: string, sinceHash: string | null): Promise<Array<{ path: string; status: 'added' | 'modified' | 'deleted' }>> {
    try {
      await this.ensureGitRepo(projectId);

      if (!sinceHash) {
        // All files are new
        const listResult = await this.runCommand(projectId, 'git ls-files');
        const files = listResult.stdout.split('\n').filter((f: string) => f.trim());
        return files.map((path: string) => ({
          path: path.replace(/^\.\//, ''), // Remove leading ./
          status: 'added' as const,
        }));
      }

      // First, check if the commit exists
      const checkCommitResult = await this.runCommand(
        projectId,
        `git rev-parse --verify ${sinceHash}`
      );

      // If commit doesn't exist, treat as first sync (all files are new)
      if (checkCommitResult.exit_code !== '0' || 
          checkCommitResult.stderr.includes('fatal:') ||
          checkCommitResult.stderr.includes('Invalid revision')) {
        console.warn(`[SYNC] Commit ${sinceHash} doesn't exist in sandbox, treating as first sync`);
        const listResult = await this.runCommand(projectId, 'git ls-files');
        const files = listResult.stdout.split('\n').filter((f: string) => f.trim());
        return files.map((path: string) => ({
          path: path.replace(/^\.\//, ''), // Remove leading ./
          status: 'added' as const,
        }));
      }

      // Get diff between sinceHash and HEAD
      const diffResult = await this.runCommand(
        projectId,
        `git diff --name-status ${sinceHash}..HEAD`
      );

      // Check for "Invalid revision range" error even if exit code is 0
      if (diffResult.exit_code !== '0' || 
          diffResult.stderr.includes('Invalid revision range') ||
          diffResult.stderr.includes('fatal: Invalid revision')) {
        console.warn(`[SYNC] Invalid revision range ${sinceHash}..HEAD, treating as first sync`);
        // Fallback: return all files as new
        const listResult = await this.runCommand(projectId, 'git ls-files');
        const files = listResult.stdout.split('\n').filter((f: string) => f.trim());
        return files.map((path: string) => ({
          path: path.replace(/^\.\//, ''), // Remove leading ./
          status: 'added' as const,
        }));
      }

      const changedFiles: Array<{ path: string; status: 'added' | 'modified' | 'deleted' }> = [];
      const lines = diffResult.stdout.split('\n').filter((l: string) => l.trim());

      for (const line of lines) {
        const match = line.match(/^([AMD])\s+(.+)$/);
        if (match) {
          const [, statusCode, path] = match;
          let status: 'added' | 'modified' | 'deleted';
          if (statusCode === 'A') {
            status = 'added';
          } else if (statusCode === 'M') {
            status = 'modified';
          } else {
            status = 'deleted';
          }
          changedFiles.push({ path, status });
        }
      }

      return changedFiles;
    } catch (error) {
      console.error('Error getting sandbox changed files:', error);
      return [];
    }
  }

  /**
   * Get commit log since a specific hash
   */
  async getSandboxCommitLog(projectId: string, sinceHash: string | null): Promise<Array<{ hash: string; message: string }>> {
    try {
      await this.ensureGitRepo(projectId);

      let logCommand = 'git log --oneline --format="%H|%s"';
      if (sinceHash) {
        logCommand += ` ${sinceHash}..HEAD`;
      } else {
        logCommand += ' HEAD';
      }

      const result = await this.runCommand(projectId, logCommand);
      if (result.exit_code !== '0') {
        return [];
      }

      const commits: Array<{ hash: string; message: string }> = [];
      const lines = result.stdout.split('\n').filter((l: string) => l.trim());

      for (const line of lines) {
        const [hash, ...messageParts] = line.split('|');
        if (hash) {
          commits.push({
            hash: hash.trim(),
            message: messageParts.join('|').trim(),
          });
        }
      }

      return commits;
    } catch (error) {
      console.error('Error getting sandbox commit log:', error);
      return [];
    }
  }
}

// Ensure beamService is a true singleton across hot reloads
const globalForBeamService = global as typeof globalThis & {
  beamServiceInstance?: BeamService;
};

export const beamService = globalForBeamService.beamServiceInstance || (globalForBeamService.beamServiceInstance = new BeamService());
