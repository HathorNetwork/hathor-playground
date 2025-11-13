/**
 * BEAM Cloud service for managing dApp sandboxes using TypeScript SDK
 */

import { Sandbox, Image, beamOpts } from '@beamcloud/beam-js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

beamOpts.token = process.env.BEAM_TOKEN || '';
beamOpts.workspaceId = process.env.BEAM_WORKSPACE_ID || '';
beamOpts.gatewayUrl = 'https://app.beam.cloud';

const DEFAULT_CODE_PATH = '/app';
const DEFAULT_PORT = 3000;

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

export class BeamService {
  private sandboxes: Map<string, any> = new Map();
  private urls: Map<string, string> = new Map();
  private processes: Map<string, any> = new Map();

  async createSandbox(projectId: string): Promise<SandboxInfo> {
    console.log('Creating sandbox for project:', projectId);

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

    const instance = await sandbox.create();
    const url = await instance.exposePort(DEFAULT_PORT);
    const sandboxId = instance.id || 'sandbox-' + Date.now();

    this.sandboxes.set(projectId, instance);
    this.urls.set(projectId, url);

    return { url, sandbox_id: sandboxId, project_id: projectId };
  }

  async getSandbox(projectId: string): Promise<any | null> {
    const instance = this.sandboxes.get(projectId);
    if (!instance) return null;

    try {
      await instance.updateTtl(300);
      return instance;
    } catch (error) {
      this.sandboxes.delete(projectId);
      return null;
    }
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
    let instance = await this.getSandbox(projectId);

    if (!instance) {
      await this.createSandbox(projectId);
      instance = await this.getSandbox(projectId);
    }

    if (!instance) {
      throw new Error('Could not get or create sandbox for project ' + projectId);
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
      } catch {
        await instance.exec('mkdir', '-p', parentDir);
      }

      const tmpFile = path.join(os.tmpdir(), 'beam-upload-' + Date.now() + '-' + path.basename(filePath));
      fs.writeFileSync(tmpFile, content);

      try {
        await instance.fs.uploadFile(tmpFile, sandboxPath);
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
}

export const beamService = new BeamService();
