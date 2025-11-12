import { create } from 'zustand';
import type { StateCreator } from 'zustand';
import { Contract } from '@/lib/api';
import { storage, initStorage, StoredFile, ChatSession, ChatMessage } from '@/lib/storage';
import { SAMPLE_PROJECTS } from './sample-projects';
import { beamClient } from '@/lib/beam-client';

export type FileType = 'contract' | 'test' | 'component' | 'hook' | 'style' | 'config';
export type FileLanguage = 'python' | 'typescript' | 'typescriptreact' | 'css' | 'json';

export interface File {
  id: string;
  name: string;
  content: string;
  language: FileLanguage;
  path: string;
  type: FileType;
}

export interface FolderNode {
  name: string;
  path: string;
  files: File[];
  subfolders: FolderNode[];
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  files: File[];
  created: number;
  lastModified: number;
}

export interface ConsoleMessage {
  id: string;
  type: 'info' | 'error' | 'warning' | 'success';
  message: string;
  timestamp: Date;
}

export interface ContractInstance {
  blueprintId: string;
  contractId: string;
  contractName: string;
  timestamp: Date;
}

interface IDEState {
  // Projects
  projects: Project[];
  activeProjectId: string | null;

  // Files (derived from active project)
  files: File[];
  openFileIds: string[];
  activeFileId: string | null;

  // Console
  consoleMessages: ConsoleMessage[];
  messageIdCounter: number;
  lastExecutionLogs: string | null;  // Store last execution logs from Pyodide

  // Contracts
  compiledContracts: Contract[];
  contractInstances: Record<string, ContractInstance>; // Track initialized contract instances by file ID

  // Chat Sessions
  chatSessions: ChatSession[];
  activeChatSessionId: string | null;

  // UI State
  isCompiling: boolean;
  isExecuting: boolean;
  isRunningTests: boolean;
  isStorageInitialized: boolean;

  // Project actions
  createProject: (name: string, description?: string) => string;
  deleteProject: (id: string) => void;
  setActiveProject: (id: string) => void;
  updateProjectName: (id: string, name: string) => void;
  getActiveProject: () => Project | null;

  // File actions
  addFile: (file: Omit<File, 'id'>) => void;
  updateFile: (id: string, content: string) => void;
  deleteFile: (id: string) => void;
  setActiveFile: (id: string) => void;
  openFile: (fileId: string) => void;
  closeFile: (fileId: string) => void;
  reorderFiles: (fromIndex: number, toIndex: number) => void;

  addConsoleMessage: (type: ConsoleMessage['type'], message: string) => void;
  clearConsole: () => void;
  setLastExecutionLogs: (logs: string | null) => void;

  addCompiledContract: (contract: Contract) => void;
  addContractInstance: (fileId: string, instance: ContractInstance) => void;
  getContractInstance: (fileId: string) => ContractInstance | null;
  clearContractInstances: () => void;

  setIsCompiling: (value: boolean) => void;
  setIsExecuting: (value: boolean) => void;
  setIsRunningTests: (value: boolean) => void;

  // Chat session actions
  createChatSession: () => string;
  addChatMessage: (sessionId: string, message: ChatMessage) => void;
  getChatSession: (id: string) => ChatSession | null;
  setActiveChatSession: (id: string) => void;
  deleteChatSession: (id: string) => void;

  // Storage operations
  initializeStore: () => Promise<void>;
  loadFilesFromStorage: () => Promise<void>;
  saveFileToStorage: (file: File) => Promise<void>;
  deleteFileFromStorage: (id: string) => Promise<void>;
  loadChatSessionsFromStorage: () => Promise<void>;
}

// Helper: Build folder tree from flat file list
export function buildFolderTree(files: File[]): FolderNode {
  const root: FolderNode = {
    name: '',
    path: '/',
    files: [],
    subfolders: []
  };

  files.forEach(file => {
    const parts = file.path.split('/').filter(p => p.length > 0);
    let current = root;

    // Navigate/create folder path
    for (let i = 0; i < parts.length - 1; i++) {
      const folderName = parts[i];
      let folder = current.subfolders.find(f => f.name === folderName);

      if (!folder) {
        folder = {
          name: folderName,
          path: '/' + parts.slice(0, i + 1).join('/'),
          files: [],
          subfolders: []
        };
        current.subfolders.push(folder);
      }

      current = folder;
    }

    // Add file to leaf folder
    current.files.push(file);
  });

  return root;
}

// Helper: Save projects to localStorage
function saveProjectsToLocalStorage(projects: Project[], activeProjectId: string | null) {
  try {
    localStorage.setItem('hathor-projects', JSON.stringify(projects));
    if (activeProjectId) {
      localStorage.setItem('hathor-active-project-id', activeProjectId);
    }
    console.log('Projects saved to localStorage');
  } catch (error) {
    console.error('Failed to save projects to localStorage:', error);
  }
}

// Helper: Sync dApp files to Beam
// Debounced to avoid too many uploads
let beamSyncTimeout: NodeJS.Timeout | null = null;
async function syncDAppFilesToBeam(projectId: string, file: File) {
  // Only sync dapp/ files
  if (!file.path.startsWith('/dapp/')) {
    return;
  }

  console.log('Scheduling Beam sync for file:', file.path);

  // Clear existing timeout
  if (beamSyncTimeout) {
    clearTimeout(beamSyncTimeout);
  }

  // Debounce: wait 1 second before uploading
  beamSyncTimeout = setTimeout(async () => {
    try {
      console.log('Syncing file to Beam:', file.path);
      await beamClient.uploadFiles(projectId, {
        [file.path]: file.content
      });
      console.log('File synced to Beam successfully');
    } catch (error) {
      console.error('Failed to sync file to Beam:', error);
    }
  }, 1000);
}

const createIDEStore: StateCreator<IDEState> = (set, get) => {
  // Initialize with sample projects
  const initialProjects = SAMPLE_PROJECTS;
  const initialActiveProjectId = initialProjects[0]?.id || null;
  const initialFiles = initialProjects[0]?.files || [];

  return {
    // Initial state - Projects
    projects: initialProjects,
    activeProjectId: initialActiveProjectId,

    // Initial state - Files (from active project)
    files: initialFiles,
    openFileIds: initialFiles[0] ? [initialFiles[0].id] : [],
    activeFileId: initialFiles[0]?.id || null,

    // Rest of initial state
    consoleMessages: [],
    messageIdCounter: 0,
    lastExecutionLogs: null,
    compiledContracts: [],
    contractInstances: {},
    chatSessions: [],
    activeChatSessionId: null,
    isCompiling: false,
    isExecuting: false,
    isRunningTests: false,
    isStorageInitialized: false,

    // Project actions
    createProject: (name, description) => {
      // New projects start empty - LLM will generate files when integrated with Beam
      const newProject: Project = {
        id: `project-${Date.now()}`,
        name,
        description,
        files: [],
        created: Date.now(),
        lastModified: Date.now(),
      };

      set((state) => {
        const newProjects = [...state.projects, newProject];
        saveProjectsToLocalStorage(newProjects, newProject.id);

        return {
          projects: newProjects,
          activeProjectId: newProject.id,
          files: [],
          openFileIds: [],
          activeFileId: null,
        };
      });

      return newProject.id;
    },

    deleteProject: (id) => {
      set((state) => {
        const newProjects = state.projects.filter((p) => p.id !== id);
        const wasActive = state.activeProjectId === id;

        if (wasActive && newProjects.length > 0) {
          // Switch to first remaining project
          const newActiveProject = newProjects[0];
          return {
            projects: newProjects,
            activeProjectId: newActiveProject.id,
            files: newActiveProject.files,
            openFileIds: newActiveProject.files[0] ? [newActiveProject.files[0].id] : [],
            activeFileId: newActiveProject.files[0]?.id || null,
          };
        }

        return {
          projects: newProjects,
          activeProjectId: wasActive ? null : state.activeProjectId,
        };
      });
    },

    setActiveProject: (id) => {
      const state = get();
      const project = state.projects.find((p) => p.id === id);

      if (project) {
        set({
          activeProjectId: id,
          files: project.files,
          openFileIds: project.files[0] ? [project.files[0].id] : [],
          activeFileId: project.files[0]?.id || null,
        });
      }
    },

    updateProjectName: (id, name) => {
      set((state) => ({
        projects: state.projects.map((p) =>
          p.id === id ? { ...p, name, lastModified: Date.now() } : p
        ),
      }));
    },

    getActiveProject: () => {
      const state = get();
      return state.projects.find((p) => p.id === state.activeProjectId) || null;
    },

    // File actions (updated to work with projects)
    addFile: (file) => {
      const state = get();
      const activeProject = state.getActiveProject();

      if (!activeProject) return;

      // Generate unique ID for the new file
      const fileWithId: File = {
        ...file,
        id: `file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      };

      // Update project's files
      const updatedProjects = state.projects.map((p) =>
        p.id === activeProject.id
          ? { ...p, files: [...p.files, fileWithId], lastModified: Date.now() }
          : p
      );

      // Save to localStorage
      saveProjectsToLocalStorage(updatedProjects, state.activeProjectId);

      set({
        projects: updatedProjects,
        files: [...state.files, fileWithId],
        openFileIds: [...state.openFileIds, fileWithId.id],
        activeFileId: fileWithId.id,
      });

      // Auto-persist to storage
      if (state.isStorageInitialized) {
        state.saveFileToStorage(fileWithId).catch(console.error);
      }

      // Sync dApp files to Beam
      syncDAppFilesToBeam(activeProject.id, fileWithId).catch(console.error);
    },

    updateFile: (id, content) => {
      const state = get();
      const activeProject = state.getActiveProject();

      if (!activeProject) return;

      // Update project's files
      const updatedProjects = state.projects.map((p) =>
        p.id === activeProject.id
          ? {
              ...p,
              files: p.files.map((f) => (f.id === id ? { ...f, content } : f)),
              lastModified: Date.now(),
            }
          : p
      );

      // Save to localStorage
      saveProjectsToLocalStorage(updatedProjects, state.activeProjectId);

      set({
        projects: updatedProjects,
        files: state.files.map((f) => (f.id === id ? { ...f, content } : f)),
      });

      // Get the updated file
      const updatedFile = state.files.find((f) => f.id === id);
      if (updatedFile) {
        const fileWithNewContent = { ...updatedFile, content };

        // Auto-persist to storage
        if (state.isStorageInitialized) {
          state.saveFileToStorage(fileWithNewContent).catch(console.error);
        }

        // Sync dApp files to Beam
        syncDAppFilesToBeam(activeProject.id, fileWithNewContent).catch(console.error);
      }
    },

    deleteFile: (id) => {
      const state = get();
      const activeProject = state.getActiveProject();

      if (!activeProject) return;

      // Update project's files
      const updatedProjects = state.projects.map((p) =>
        p.id === activeProject.id
          ? {
              ...p,
              files: p.files.filter((f) => f.id !== id),
              lastModified: Date.now(),
            }
          : p
      );

      // Save to localStorage
      saveProjectsToLocalStorage(updatedProjects, state.activeProjectId);

      const newOpenFileIds = state.openFileIds.filter((fileId) => fileId !== id);
      let newActiveFileId = state.activeFileId;

      if (state.activeFileId === id) {
        const closingTabIndex = state.openFileIds.indexOf(id);
        newActiveFileId =
          newOpenFileIds[closingTabIndex] ||
          newOpenFileIds[newOpenFileIds.length - 1] ||
          null;
      }

      set({
        projects: updatedProjects,
        files: state.files.filter((f) => f.id !== id),
        openFileIds: newOpenFileIds,
        activeFileId: newActiveFileId,
      });

      // Delete from storage
      if (state.isStorageInitialized) {
        state.deleteFileFromStorage(id).catch(console.error);
      }
    },

    // Keep existing file actions (openFile, closeFile, etc.) - these don't need project changes
    setActiveFile: (id) => {
      set({ activeFileId: id });
      const state = get();
      if (state.isStorageInitialized) {
        storage.setPreference('lastActiveFileId', id).catch(console.error);
      }
    },

    openFile: (fileId) => {
      set((state) => {
        if (!state.openFileIds.includes(fileId)) {
          return {
            openFileIds: [...state.openFileIds, fileId],
            activeFileId: fileId,
          };
        }
        return { activeFileId: fileId };
      });
    },

    closeFile: (fileId) => {
      set((state) => {
        const newOpenFileIds = state.openFileIds.filter((id) => id !== fileId);
        let newActiveFileId = state.activeFileId;

        if (state.activeFileId === fileId) {
          const closingTabIndex = state.openFileIds.indexOf(fileId);
          newActiveFileId =
            newOpenFileIds[closingTabIndex] ||
            newOpenFileIds[newOpenFileIds.length - 1] ||
            null;
        }

        return {
          openFileIds: newOpenFileIds,
          activeFileId: newActiveFileId,
        };
      });
    },

    reorderFiles: (fromIndex, toIndex) => {
      set((state) => {
        const newOpenFileIds = [...state.openFileIds];
        const [movedItem] = newOpenFileIds.splice(fromIndex, 1);
        newOpenFileIds.splice(toIndex, 0, movedItem);
        return { openFileIds: newOpenFileIds };
      });
    },

    // Keep all other actions unchanged
    addConsoleMessage: (type, message) =>
      set((state) => ({
        consoleMessages: [
          ...state.consoleMessages,
          {
            id: `console-${++state.messageIdCounter}-${Date.now()}`,
            type,
            message,
            timestamp: new Date(),
          },
        ],
        messageIdCounter: state.messageIdCounter + 1,
      })),

    clearConsole: () =>
      set(() => ({
        consoleMessages: [],
        messageIdCounter: 0,
        lastExecutionLogs: null,
      })),

    setLastExecutionLogs: (logs) => set(() => ({ lastExecutionLogs: logs })),

    addCompiledContract: (contract) =>
      set((state) => ({
        compiledContracts: [...state.compiledContracts, contract],
      })),

    addContractInstance: (fileId: string, instance: ContractInstance) =>
      set((state) => ({
        contractInstances: {
          ...state.contractInstances,
          [fileId]: instance,
        },
      })),

    getContractInstance: (fileId: string) => {
      const state = get();
      return state.contractInstances[fileId] || null;
    },

    clearContractInstances: () =>
      set(() => ({
        contractInstances: {},
      })),

    // Helper method for AI tools to set compiled contract
    setCompiledContract: (fileId: string, blueprintId: string) =>
      set((state) => {
        const file = state.files.find(f => f.id === fileId);
        if (file) {
          const contract: Contract = {
            contract_id: blueprintId,
            blueprint_id: blueprintId,
            code: file.content,
            methods: [],
            created_at: new Date().toISOString(),
            fileId: fileId, // Store which file this was compiled from
          };
          return {
            compiledContracts: [...state.compiledContracts, contract],
          };
        }
        return state;
      }),

    // Helper method for AI tools to set contract instance
    setContractInstance: (fileId: string, instance: { contractId: string; blueprintId: string }) =>
      set((state) => {
        const file = state.files.find(f => f.id === fileId);
        if (file) {
          const contractInstance: ContractInstance = {
            blueprintId: instance.blueprintId,
            contractId: instance.contractId,
            contractName: file.name.replace('.py', ''),
            timestamp: new Date(),
          };
          return {
            contractInstances: {
              ...state.contractInstances,
              [fileId]: contractInstance,
            },
          };
        }
        return state;
      }),

    setIsCompiling: (value) =>
      set(() => ({
        isCompiling: value,
      })),

    setIsExecuting: (value) =>
      set(() => ({
        isExecuting: value,
      })),

    setIsRunningTests: (value) =>
      set(() => ({
        isRunningTests: value,
      })),

    // Chat session actions (unchanged)
    createChatSession: () => {
      const sessionId = Date.now().toString();
      const newSession: ChatSession = {
        id: sessionId,
        messages: [],
        created: Date.now(),
        lastModified: Date.now(),
        title: 'New Chat Session',
      };

      set((state) => ({
        chatSessions: [...state.chatSessions, newSession],
        activeChatSessionId: sessionId,
      }));

      const state = get();
      if (state.isStorageInitialized) {
        storage.saveChatSession(newSession).catch(console.error);
      }

      return sessionId;
    },

    addChatMessage: (sessionId, message) => {
      set((state) => ({
        chatSessions: state.chatSessions.map((session) =>
          session.id === sessionId
            ? {
                ...session,
                messages: [...session.messages, message],
                lastModified: Date.now(),
              }
            : session
        ),
      }));

      const state = get();
      if (state.isStorageInitialized) {
        const updatedSession = state.chatSessions.find((s) => s.id === sessionId);
        if (updatedSession) {
          storage.saveChatSession(updatedSession).catch(console.error);
        }
      }
    },

    getChatSession: (id) => {
      const state = get();
      return state.chatSessions.find((session) => session.id === id) || null;
    },

    setActiveChatSession: (id) => {
      set(() => ({
        activeChatSessionId: id,
      }));

      const state = get();
      if (state.isStorageInitialized) {
        storage.setPreference('activeChatSessionId', id).catch(console.error);
      }
    },

    deleteChatSession: (id) => {
      set((state) => ({
        chatSessions: state.chatSessions.filter((session) => session.id !== id),
        activeChatSessionId: state.activeChatSessionId === id ? null : state.activeChatSessionId,
      }));

      const state = get();
      if (state.isStorageInitialized) {
        storage.deleteChatSession(id).catch(console.error);
      }
    },

    // Storage operations (simplified for projects)
    initializeStore: async () => {
      try {
        await initStorage();
        set({ isStorageInitialized: true });

        const state = get();
        await state.loadFilesFromStorage();
        await state.loadChatSessionsFromStorage();

        console.log('IDE store initialized with persistent storage');
      } catch (error) {
        console.error('Failed to initialize storage:', error);
        set({ isStorageInitialized: false });
      }
    },

    loadFilesFromStorage: async () => {
      try {
        // Load projects from localStorage
        const storedProjectsJson = localStorage.getItem('hathor-projects');

        if (storedProjectsJson) {
          const storedProjects: Project[] = JSON.parse(storedProjectsJson);

          if (storedProjects.length > 0) {
            // Filter out __init__.py files from all projects (they can resurrect from storage)
            const cleanedProjects = storedProjects.map(project => ({
              ...project,
              files: project.files.filter(f => f.name !== '__init__.py'),
            }));

            const activeProjectId = localStorage.getItem('hathor-active-project-id') || cleanedProjects[0].id;
            const activeProject = cleanedProjects.find(p => p.id === activeProjectId) || cleanedProjects[0];

            set({
              projects: cleanedProjects,
              activeProjectId: activeProject.id,
              files: activeProject.files,
              openFileIds: activeProject.files[0] ? [activeProject.files[0].id] : [],
              activeFileId: activeProject.files[0]?.id || null,
            });

            console.log(`Loaded ${cleanedProjects.length} projects from localStorage`);
            return;
          }
        }

        // Fallback: no stored projects, keep sample projects
        console.log('No stored projects found, using sample projects');
      } catch (error) {
        console.error('Failed to load projects from storage:', error);
        // Fallback to sample projects on error
      }
    },

    saveFileToStorage: async (file: File) => {
      try {
        const storedFile: StoredFile = {
          id: file.id,
          name: file.name,
          content: file.content,
          lastModified: Date.now(),
          created: Date.now(),
          type: file.type || 'contract',
        };

        const existingFile = await storage.getFile(file.id);
        if (existingFile) {
          storedFile.created = existingFile.created;
        }

        await storage.saveFile(storedFile);
      } catch (error) {
        console.error('Failed to save file to storage:', error);
      }
    },

    deleteFileFromStorage: async (id: string) => {
      try {
        await storage.deleteFile(id);
      } catch (error) {
        console.error('Failed to delete file from storage:', error);
      }
    },

    loadChatSessionsFromStorage: async () => {
      try {
        const storedSessions = await storage.getAllChatSessions();

        if (storedSessions.length > 0) {
          const activeSessionId = await storage.getPreference('activeChatSessionId', null);
          const validActiveSessionId =
            storedSessions.find((s) => s.id === activeSessionId)?.id || null;

          set({
            chatSessions: storedSessions,
            activeChatSessionId: validActiveSessionId,
          });

          console.log(`Loaded ${storedSessions.length} chat sessions from storage`);
        } else {
          console.log('No chat sessions found in storage');
        }
      } catch (error) {
        console.error('Failed to load chat sessions from storage:', error);
      }
    },
  };
};

// Remove all the old file initialization code below this line

export const useIDEStore = create<IDEState>(createIDEStore);
