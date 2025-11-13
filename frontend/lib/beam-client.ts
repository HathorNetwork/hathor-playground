/**
 * Beam Cloud API client for dApp deployment
 */

const API_BASE = '/api/beam';

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

export class BeamClient {
  /**
   * Create a new sandbox for a project
   */
  async createSandbox(projectId: string): Promise<SandboxInfo> {
    const response = await fetch(`${API_BASE}/sandbox/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ project_id: projectId }),
    });

    if (!response.ok) {
      throw new Error(`Failed to create sandbox: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Get sandbox info for a project
   */
  async getSandbox(projectId: string): Promise<SandboxInfo | null> {
    const response = await fetch(`${API_BASE}/sandbox/${projectId}`);

    if (response.status === 404 || response.status === 204) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`Failed to get sandbox: ${response.statusText}`);
    }

    const data = await response.json();
    return data || null;
  }

  /**
   * Upload files to sandbox
   */
  async uploadFiles(
    projectId: string,
    files: Record<string, string>,
    autoStart: boolean = true
  ): Promise<UploadResult> {
    const response = await fetch(`${API_BASE}/sandbox/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        project_id: projectId,
        files,
        auto_start: autoStart,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to upload files: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Start development server in sandbox
   */
  async startDevServer(projectId: string): Promise<{ status: string; url: string }> {
    const response = await fetch(`${API_BASE}/sandbox/${projectId}/start`, {
      method: 'POST',
    });

    if (!response.ok) {
      throw new Error(`Failed to start dev server: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Ensure sandbox exists for project and return its URL
   */
  async ensureSandbox(projectId: string): Promise<string> {
    // Check if sandbox exists
    let sandbox = await this.getSandbox(projectId);

    // Create if it doesn't exist
    if (!sandbox) {
      console.log('Creating new sandbox for project:', projectId);
      sandbox = await this.createSandbox(projectId);
    }

    return sandbox.url;
  }

  /**
   * Deploy dApp files to sandbox
   * This will create sandbox if needed and upload all dapp/ files
   */
  async deployDApp(projectId: string, files: Record<string, string>): Promise<string> {
    // Filter to only dapp/ files
    const dappFiles = Object.fromEntries(
      Object.entries(files).filter(([path]) => path.startsWith('/dapp/'))
    );

    if (Object.keys(dappFiles).length === 0) {
      throw new Error('No dApp files to deploy');
    }

    // Ensure sandbox exists
    await this.ensureSandbox(projectId);

    // Upload files
    console.log('Uploading files to sandbox:', projectId, Object.keys(dappFiles));
    await this.uploadFiles(projectId, dappFiles);

    // Start dev server
    const result = await this.startDevServer(projectId);

    return result.url;
  }

  /**
   * Stream logs from sandbox using Server-Sent Events
   * Returns an EventSource that emits log lines
   */
  streamLogs(projectId: string, onLog: (log: string) => void, onError?: (error: Event) => void): EventSource {
    const eventSource = new EventSource(`${API_BASE}/sandbox/${projectId}/logs`);

    eventSource.onmessage = (event) => {
      onLog(event.data);
    };

    eventSource.onerror = (error) => {
      console.error('SSE Error:', error);

      // Close the connection to prevent infinite reconnect attempts
      eventSource.close();

      // Notify caller
      if (onError) {
        onError(error);
      } else {
        // Default error handling if no callback provided
        console.warn('Log streaming failed. Connection closed.');
      }
    };

    // Handle when connection opens successfully
    eventSource.onopen = () => {
      console.log('Log stream connected for project:', projectId);
    };

    return eventSource;
  }

  /**
   * Stream build logs from sandbox creation using Server-Sent Events
   * Returns an EventSource that emits build log lines in real-time
   */
  streamBuildLogs(projectId: string, onLog: (log: string) => void, onError?: (error: Event) => void, onComplete?: () => void): EventSource {
    const eventSource = new EventSource(`${API_BASE}/sandbox/${projectId}/build-logs`);

    eventSource.onmessage = (event) => {
      onLog(event.data);
    };

    eventSource.onerror = (error) => {
      console.error('Build log SSE Error:', error);

      // Close the connection
      eventSource.close();

      // Notify complete callback
      if (onComplete) {
        onComplete();
      }

      // Notify error callback
      if (onError) {
        onError(error);
      } else {
        console.warn('Build log streaming closed.');
      }
    };

    // Handle when connection opens successfully
    eventSource.onopen = () => {
      console.log('Build log stream connected for project:', projectId);
    };

    return eventSource;
  }
}

// Global instance
export const beamClient = new BeamClient();
