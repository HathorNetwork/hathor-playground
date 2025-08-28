import type { File } from '@/store/ide-store';

let git: any;
let http: any;
let LightningFS: any;

async function ensureGit() {
  if (!git) {
    git = await import('isomorphic-git');
    http = (await import('isomorphic-git/http/web')).default;
    LightningFS = (await import('@isomorphic-git/lightning-fs')).default;
  }
}

export class GitClient {
  private fs: any | null = null;
  private dir: string;
  constructor(private repoName: string) {
    this.dir = `/${repoName}`;
  }

  async init(): Promise<void> {
    await ensureGit();
    this.fs = new LightningFS(this.repoName);
    await git.init({ fs: this.fs, dir: this.dir });
  }

  private async ensureDir(filepath: string): Promise<void> {
    if (!this.fs) return;
    const parts = filepath.split('/');
    parts.pop();
    let current = this.dir;
    for (const part of parts) {
      current += `/${part}`;
      try {
        await this.fs.promises.mkdir(current);
      } catch {
        /* ignore existing */
      }
    }
  }

  private async writeFile(filepath: string, content: string): Promise<void> {
    if (!this.fs) return;
    await this.ensureDir(filepath);
    await this.fs.promises.writeFile(`${this.dir}/${filepath}`, content);
  }

  async commitFile(file: File, message: string): Promise<string | null> {
    if (!this.fs) return null;
    await ensureGit();
    const path = file.name;
    await this.writeFile(path, file.content);
    await git.add({ fs: this.fs, dir: this.dir, filepath: path });
    return git.commit({
      fs: this.fs,
      dir: this.dir,
      message,
      author: { name: 'IDE User', email: 'user@example.com' },
    });
  }

  async setRemote(url: string, name = 'origin'): Promise<void> {
    if (!this.fs) return;
    await ensureGit();
    await git.addRemote({ fs: this.fs, dir: this.dir, remote: name, url, force: true });
  }

  async push(remote = 'origin', ref = 'main', username?: string, password?: string): Promise<void> {
    if (!this.fs) return;
    await ensureGit();
    await git.push({
      fs: this.fs,
      http,
      dir: this.dir,
      remote,
      ref,
      onAuth: () => ({ username, password }),
    });
  }

  async log(): Promise<any[] | null> {
    if (!this.fs) return null;
    await ensureGit();
    return git.log({ fs: this.fs, dir: this.dir });
  }

  async checkout(ref: string, filepath: string): Promise<string | null> {
    if (!this.fs) return null;
    await ensureGit();
    await git.checkout({ fs: this.fs, dir: this.dir, ref });
    const content = await this.fs.promises.readFile(`${this.dir}/${filepath}`, 'utf8');
    return content.toString();
  }

  async listBranches(): Promise<string[] | null> {
    if (!this.fs) return null;
    await ensureGit();
    return git.listBranches({ fs: this.fs, dir: this.dir });
  }

  async createBranch(name: string): Promise<void> {
    if (!this.fs) return;
    await ensureGit();
    await git.branch({ fs: this.fs, dir: this.dir, ref: name });
  }

  async switchBranch(name: string, filepath: string): Promise<string | null> {
    if (!this.fs) return null;
    await ensureGit();
    await git.checkout({ fs: this.fs, dir: this.dir, ref: name });
    const content = await this.fs.promises.readFile(`${this.dir}/${filepath}`, 'utf8');
    return content.toString();
  }
}
