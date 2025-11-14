/**
 * BEAM Cloud service for managing dApp sandboxes using TypeScript SDK
 */

import { Sandbox, Image, beamOpts } from '@beamcloud/beam-js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const DEFAULT_CODE_PATH = '/app';
const DEFAULT_PORT = 3000;

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

    const image = new Image({
      baseImage: 'node:20',
      commands: [
        'apt-get update && apt-get install -y git curl',
        'npm install -g pnpm',
        'mkdir -p /app',
        'chmod 755 /app',
      ],
    });

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
    const sandboxId = instance.id || 'sandbox-' + Date.now();

    this.sandboxes.set(projectId, instance);
    this.urls.set(projectId, url);

    // Add completion message
    const logs = this.buildLogs.get(projectId) || [];
    logs.push('✓ Sandbox created successfully!');
    logs.push('✓ Port exposed: ' + url);
    this.buildLogs.set(projectId, logs);

    return { url, sandbox_id: sandboxId, project_id: projectId };
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

    return {
      sandbox_id: instance.id || 'sandbox-' + projectId,
      url,
      project_id: projectId,
    };
  }

  async uploadFiles(
    projectId: string,
    files: Record<string, string>,
    autoStart: boolean = true
  ): Promise<UploadResult> {
    console.log('[UPLOAD] =================== uploadFiles called for:', projectId);
    let instance = await this.getSandbox(projectId);

    if (!instance) {
      console.log('No existing sandbox, creating new one for:', projectId);
      await this.createSandbox(projectId);
      // After creating, get directly from Map without TTL check
      instance = this.sandboxes.get(projectId);
      // Give newly created sandbox time to be fully ready
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    if (!instance) {
      throw new Error('Could not get or create sandbox for project ' + projectId);
    }

    console.log('Uploading', Object.keys(files).length, 'files to sandbox:', projectId);

    // Test if sandbox is still alive by doing a quick operation
    try {
      await instance.fs.statFile('/');
    } catch (testError) {
      console.warn('Cached sandbox is dead/stale, recreating for:', projectId);
      // Remove stale instance
      this.sandboxes.delete(projectId);
      this.urls.delete(projectId);
      this.processes.delete(projectId);
      // Create fresh sandbox
      await this.createSandbox(projectId);
      instance = this.sandboxes.get(projectId);
      if (!instance) {
        throw new Error('Failed to recreate sandbox for project ' + projectId);
      }
      // Give new sandbox time to be ready
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

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
      } catch (statError) {
        try {
          await instance.exec('mkdir', '-p', parentDir);
        } catch (mkdirError) {
          console.error('Failed to create directory:', parentDir, mkdirError);
          throw mkdirError;
        }
      }

      const tmpFile = path.join(os.tmpdir(), 'beam-upload-' + Date.now() + '-' + path.basename(filePath));
      fs.writeFileSync(tmpFile, content);

      try {
        await instance.fs.uploadFile(tmpFile, sandboxPath);
        console.log('Uploaded:', sandboxPath);
      } catch (uploadError) {
        console.error('Failed to upload file:', sandboxPath, uploadError);
        throw uploadError;
      } finally {
        fs.unlinkSync(tmpFile);
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

  async startDevServer(projectId: string): Promise<{ status: string; url: string }> {
    console.log('[START_DEV] =================== startDevServer called for:', projectId);
    let instance = await this.getSandbox(projectId);

    if (!instance) {
      console.log('No existing sandbox, creating new one for:', projectId);
      await this.createSandbox(projectId);
      // After creating, get directly from Map without TTL check
      instance = this.sandboxes.get(projectId);
      // Give newly created sandbox time to be fully ready
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    if (!instance) {
      throw new Error('Could not get or create sandbox for project ' + projectId);
    }

    console.log('Testing if sandbox is alive for dev server:', projectId);

    // Test if sandbox is still alive by doing a quick operation
    try {
      await instance.fs.statFile('/');
    } catch (testError) {
      console.warn('Cached sandbox is dead/stale, recreating for dev server:', projectId);
      // Remove stale instance
      this.sandboxes.delete(projectId);
      this.urls.delete(projectId);
      this.processes.delete(projectId);
      // Create fresh sandbox
      await this.createSandbox(projectId);
      instance = this.sandboxes.get(projectId);
      if (!instance) {
        throw new Error('Failed to recreate sandbox for project ' + projectId);
      }
      // Give new sandbox time to be ready
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Determine project root: prefer /app, otherwise first subdir with package.json (e.g., /app/hathor-dapp)
    let projectRoot = DEFAULT_CODE_PATH;
    try {
      await instance.fs.statFile(DEFAULT_CODE_PATH + '/package.json');
      projectRoot = DEFAULT_CODE_PATH;
    } catch {
      // Find first package.json within depth 2
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

    // Install deps and start dev server (projectRoot should exist since /app is created during setup)
    try {
      const installCmd = `cd ${projectRoot} && pnpm install`;
      const installProc = await instance.exec('sh', '-c', installCmd);
      await installProc.wait();
    } catch {
      console.log('Dependency install skipped/failed (no package.json yet?)');
    }

    const devCmd = `cd ${projectRoot} && npx next dev --port ${DEFAULT_PORT}`;
    const process = await instance.exec('sh', '-c', devCmd);
    this.processes.set(projectId, process);

    const url = this.urls.get(projectId);
    if (!url) throw new Error('Sandbox URL not found');

    return { status: 'success', url };
  }

  async runCommand(projectId: string, command: string) {
    console.log('[RUN_COMMAND] =================== runCommand called for:', projectId);
    let instance = await this.getSandbox(projectId);

    if (!instance) {
      console.log('No existing sandbox, creating new one for:', projectId);
      await this.createSandbox(projectId);
      // After creating, get directly from Map without TTL check
      instance = this.sandboxes.get(projectId);
      // Give newly created sandbox time to be fully ready
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    if (!instance) {
      throw new Error('Could not get or create sandbox for project ' + projectId);
    }

    console.log('Testing if sandbox is alive for command:', projectId);

    // Test if sandbox is still alive by doing a quick operation
    try {
      await instance.fs.statFile('/');
    } catch (testError) {
      console.warn('Cached sandbox is dead/stale, recreating for command:', projectId);
      // Remove stale instance
      this.sandboxes.delete(projectId);
      this.urls.delete(projectId);
      this.processes.delete(projectId);
      // Create fresh sandbox
      await this.createSandbox(projectId);
      instance = this.sandboxes.get(projectId);
      if (!instance) {
        throw new Error('Failed to recreate sandbox for project ' + projectId);
      }
      // Give new sandbox time to be ready
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

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
    let instance = await this.getSandbox(projectId);

    if (!instance) {
      console.log('No existing sandbox, creating new one for:', projectId);
      await this.createSandbox(projectId);
      // After creating, get directly from Map without TTL check
      instance = this.sandboxes.get(projectId);
      // Give newly created sandbox time to be fully ready
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    if (!instance) {
      throw new Error('Could not get or create sandbox for project ' + projectId);
    }

    // Note: Skipping stale detection for downloadFiles to avoid losing files created by recent commands
    // The sync should run on the same sandbox instance that just executed commands

    const files: Record<string, string> = {};

    // Find all regular files, excluding common large/unnecessary directories
    const excludePatterns = [
      'node_modules',
      '.git',
      '.next',
      '.cache',
      '.npm',
      '.yarn',
      'dist',
      'build',
    ];

    // Build find command - find all files, exclude common build/dependency directories
    // Use a simpler approach: find all files first, then filter in JavaScript
    const findCmd = `find ${remotePath} -type f 2>/dev/null`;
    console.log(`[DOWNLOAD] Executing find command: ${findCmd}`);
    const process = await instance.exec('sh', '-c', findCmd);
    await process.wait();
    const output = await process.stdout.read();
    const stderr = await process.stderr.read();

    console.log(`[DOWNLOAD] Find command stdout (first 1000 chars): ${output?.slice(0, 1000)}`);
    if (stderr && stderr.trim()) {
      console.log(`[DOWNLOAD] Find command stderr: ${stderr}`);
    }

    // Filter out excluded directories and files
    const allPaths = output.split('\n').filter((line: string) => line.trim());
    const filePaths = allPaths.filter((path: string) => {
      // Exclude common build/dependency directories
      if (path.includes('/node_modules/') ||
          path.includes('/.git/') ||
          path.includes('/.next/') ||
          path.includes('/.cache/') ||
          path.includes('/.npm/') ||
          path.includes('/.yarn/') ||
          path.includes('/dist/') ||
          path.includes('/build/') ||
          path.includes('.DS_Store') ||
          (path.endsWith('.log') && path.includes('/logs/'))) {
        return false;
      }
      return true;
    });
    
    console.log(`[DOWNLOAD] Found ${allPaths.length} total paths, ${filePaths.length} after filtering`);
    console.log(`[DOWNLOAD] Sample file paths:`, filePaths.slice(0, 10));

    for (const sandboxFilePath of filePaths) {
      if (!sandboxFilePath.trim()) continue;

      // Additional filtering for edge cases and files not in directories
      if (sandboxFilePath.includes('.DS_Store') ||
          sandboxFilePath.includes('.log') && sandboxFilePath.includes('/logs/')) {
        continue;
      }

      try {
        const tmpFile = path.join(os.tmpdir(), 'beam-download-' + Date.now() + '-' + path.basename(sandboxFilePath));
        await instance.fs.downloadFile(sandboxFilePath, tmpFile);
        const content = fs.readFileSync(tmpFile, 'utf-8');
        const frontendPath = sandboxFilePath.replace(DEFAULT_CODE_PATH + '/', '/dapp/');
        files[frontendPath] = content;
        console.log(`[DOWNLOAD] Successfully downloaded: ${sandboxFilePath} -> ${frontendPath} (${content.length} bytes)`);
        fs.unlinkSync(tmpFile);
      } catch (error: any) {
        console.warn(`[DOWNLOAD] Failed to download ${sandboxFilePath}:`, error.message);
      }
    }

    console.log(`[DOWNLOAD] Returning ${Object.keys(files).length} files. Keys:`, Object.keys(files).slice(0, 10));
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
    let instance = await this.getSandbox(projectId);
    if (!instance) {
      await this.createSandbox(projectId);
      instance = this.sandboxes.get(projectId);
      if (!instance) {
        throw new Error('Failed to create sandbox for git operations');
      }
    }

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

      // Get diff between sinceHash and HEAD
      const diffResult = await this.runCommand(
        projectId,
        `git diff --name-status ${sinceHash}..HEAD`
      );

      if (diffResult.exit_code !== '0') {
        console.warn('git diff failed:', diffResult.stderr);
        return [];
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
