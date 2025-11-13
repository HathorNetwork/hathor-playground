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
    const instance = await this.getSandbox(projectId);
    if (!instance) throw new Error('No sandbox found for project ' + projectId);

    try {
      await instance.fs.statFile(DEFAULT_CODE_PATH + '/package.json');
      const installCmd = 'cd ' + DEFAULT_CODE_PATH + ' && pnpm install';
      const installProc = await instance.exec('sh', '-c', installCmd);
      await installProc.wait();
    } catch {
      console.log('No package.json, skipping install');
    }

    const devCmd = 'cd ' + DEFAULT_CODE_PATH + ' && npx next dev --port ' + DEFAULT_PORT;
    const process = await instance.exec('sh', '-c', devCmd);
    this.processes.set(projectId, process);

    const url = this.urls.get(projectId);
    if (!url) throw new Error('Sandbox URL not found');

    return { status: 'success', url };
  }

  async runCommand(projectId: string, command: string) {
    const instance = await this.getSandbox(projectId);
    if (!instance) throw new Error('No sandbox found for project ' + projectId);

    try {
      const fullCommand = 'cd ' + DEFAULT_CODE_PATH + ' && ' + command;
      const process = await instance.exec('sh', '-c', fullCommand);
      await process.wait();

      const stdout = await process.stdout.read();
      const stderr = await process.stderr.read();

      return { stdout: stdout || '', stderr: stderr || '', exit_code: '0', command };
    } catch (error: any) {
      return { stdout: '', stderr: error.message || String(error), exit_code: '1', command };
    }
  }

  async downloadFiles(projectId: string, remotePath: string = DEFAULT_CODE_PATH) {
    const instance = await this.getSandbox(projectId);
    if (!instance) throw new Error('No sandbox found for project ' + projectId);

    const files: Record<string, string> = {};
    const findCmd = 'find ' + remotePath + ' -type f';
    const process = await instance.exec('sh', '-c', findCmd);
    await process.wait();
    const output = await process.stdout.read();

    const filePaths = output.split('\n').filter((line: string) => line.trim());

    for (const sandboxFilePath of filePaths) {
      if (!sandboxFilePath.trim()) continue;
      if (sandboxFilePath.includes('node_modules') || sandboxFilePath.includes('/.next/')) continue;

      try {
        const tmpFile = path.join(os.tmpdir(), 'beam-download-' + Date.now() + '-' + path.basename(sandboxFilePath));
        await instance.fs.downloadFile(sandboxFilePath, tmpFile);
        const content = fs.readFileSync(tmpFile, 'utf-8');
        const frontendPath = sandboxFilePath.replace(DEFAULT_CODE_PATH + '/', '/dapp/');
        files[frontendPath] = content;
        fs.unlinkSync(tmpFile);
      } catch (error) {
        console.warn('Failed to download:', sandboxFilePath);
      }
    }

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
}

// Ensure beamService is a true singleton across hot reloads
const globalForBeamService = global as typeof globalThis & {
  beamServiceInstance?: BeamService;
};

export const beamService = globalForBeamService.beamServiceInstance || (globalForBeamService.beamServiceInstance = new BeamService());
