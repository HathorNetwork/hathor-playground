import axios from 'axios';
import { pyodideRunner } from './pyodide-runner';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Flag to determine if we should use browser-based execution
const USE_BROWSER_EXECUTION = true;

export interface CompileRequest {
  code: string;
  blueprint_name?: string;
}

export interface CompileResponse {
  success: boolean;
  blueprint_id?: string;
  errors: string[];
  warnings: string[];
  gas_estimate?: number;
  traceback?: string;
}

export interface ValidationRequest {
  code: string;
  strict?: boolean;
}

export interface ValidationResponse {
  valid: boolean;
  errors: Array<{
    line: number;
    column: number;
    message: string;
    severity: string;
    rule: string;
  }>;
  suggestions: string[];
}

export interface ExecuteRequest {
  contract_id: string;
  method_name: string;
  args?: any[];
  kwargs?: Record<string, any>;
  actions?: Array<Record<string, any>>;
  context?: Record<string, any>;
  caller_address?: string;
  method_type?: 'public' | 'view';
  code?: string; // Contract code for method type detection
  
}

export interface ExecuteResponse {
  success: boolean;
  result?: any;
  error?: string;
  gas_used?: number;
  logs: string[];
  state_changes: Record<string, any>;
  traceback?: string;
}

export interface Contract {
  contract_id: string;
  blueprint_id: string;
  code: string;
  methods: string[];
  created_at: string;
}

export interface StorageInfo {
  type: string;
  contracts_count: number;
  total_size: number;
}

export const contractsApi = {
  compile: async (request: CompileRequest): Promise<CompileResponse> => {
    if (USE_BROWSER_EXECUTION) {
      // Use browser-based Pyodide execution
      await pyodideRunner.initialize();

      const result = await pyodideRunner.compileContract(
        request.code,
        request.blueprint_name || 'Contract'
      );

      return {
        success: result.success,
        blueprint_id: result.blueprint_id,
        errors: result.error ? [result.error] : [],
        warnings: [],
        gas_estimate: 1000, // Mock gas estimate
        // Pass through traceback for detailed error display
        ...(result.traceback && { traceback: result.traceback })
      };
    } else {
      // Use backend execution (fallback)
      const response = await api.post('/api/contracts/compile', request);
      return response.data;
    }
  },

  execute: async (request: ExecuteRequest): Promise<ExecuteResponse> => {
    if (USE_BROWSER_EXECUTION) {
      // Use browser-based Pyodide execution
      await pyodideRunner.initialize();

      const result = await pyodideRunner.executeContract({
        contract_id: request.contract_id,
        method_name: request.method_name,
        args: request.args || [],
        kwargs: request.kwargs || {},
        caller_address: request.caller_address,
        method_type: request.method_type,
        code: request.code,
        actions: request.actions
      });

      return {
        success: result.success,
        result: result.result,
        error: result.error,
        logs: result.output ? [result.output] : [],
        state_changes: {},
        // Pass through traceback for detailed error display
        ...(result.traceback && { traceback: result.traceback })
      };
    } else {
      // Use backend execution (fallback)
      const response = await api.post('/api/contracts/execute', request);
      return response.data;
    }
  },

  list: async (): Promise<Contract[]> => {
    if (USE_BROWSER_EXECUTION) {
      // In browser mode, we don't persist contracts across sessions
      return [];
    } else {
      const response = await api.get('/api/contracts/list');
      return response.data;
    }
  },

  get: async (contractId: string): Promise<Contract> => {
    if (USE_BROWSER_EXECUTION) {
      // Mock contract data for browser mode
      return {
        contract_id: contractId,
        blueprint_id: contractId,
        code: '# Contract code not available in browser mode',
        methods: [],
        created_at: new Date().toISOString()
      };
    } else {
      const response = await api.get(`/api/contracts/${contractId}`);
      return response.data;
    }
  },

  getMethods: async (contractId: string): Promise<any[]> => {
    if (USE_BROWSER_EXECUTION) {
      // Methods are parsed by frontend contractParser
      return [];
    } else {
      const response = await api.get(`/api/contracts/${contractId}/methods`);
      return response.data;
    }
  },

  getState: async (contractId: string): Promise<Record<string, any>> => {
    if (USE_BROWSER_EXECUTION) {
      // State is managed in browser memory
      return {};
    } else {
      const response = await api.get(`/api/contracts/${contractId}/state`);
      return response.data;
    }
  },
};

export const validationApi = {
  validate: async (request: ValidationRequest): Promise<ValidationResponse> => {
    if (USE_BROWSER_EXECUTION) {
      // Use browser-based validation
      await pyodideRunner.initialize();

      const result = await pyodideRunner.validateContract(request.code);

      return {
        valid: result.valid,
        errors: result.errors.map(error => ({
          line: error.line,
          column: 1,
          message: error.message,
          severity: error.severity,
          rule: 'python-syntax'
        })),
        suggestions: []
      };
    } else {
      // Use backend validation (fallback)
      const response = await api.post('/api/validation/validate', request);
      return response.data;
    }
  },

  getRules: async (): Promise<any[]> => {
    if (USE_BROWSER_EXECUTION) {
      // Return basic validation rules for browser mode
      return [
        { id: 'python-syntax', name: 'Python Syntax', description: 'Basic Python syntax validation' }
      ];
    } else {
      const response = await api.get('/api/validation/rules');
      return response.data.rules;
    }
  },
};

export const storageApi = {
  getInfo: async (): Promise<StorageInfo> => {
    const response = await api.get('/api/storage/info');
    return response.data;
  },

  reset: async (): Promise<void> => {
    await api.post('/api/storage/reset');
  },
};

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  message: string;
  current_file_content?: string;
  current_file_name?: string;
  console_messages?: string[];
  execution_logs?: string;  // Logs from Pyodide execution
  context?: Record<string, any>;
  conversation_history?: ChatMessage[];
}

export interface ChatResponse {
  success: boolean;
  message: string;
  error?: string;
  suggestions?: string[];
  original_code?: string;
  modified_code?: string;
}

export interface GenerateDAppRequest {
  description: string;
  project_id: string;
}

export interface GeneratedFile {
  path: string;
  content: string;
  language: string;
}

export interface GenerateDAppResponse {
  success: boolean;
  files: GeneratedFile[];
  error?: string;
}

export interface AgenticChatRequest {
  message: string;
  project_id: string;
  files: Record<string, string>;
  conversation_history?: Array<{ role: string; content: string }>;
}

export interface ToolCall {
  tool: string;
  args: Record<string, any>;
  result: string;
}

export interface AgenticChatResponse {
  success: boolean;
  message: string;
  tool_calls: ToolCall[];
  updated_files: Record<string, string>;
  error?: string;
}

export type EnvironmentType = 'blueprint' | 'dapp' | 'mixed' | 'empty';

export interface UnifiedChatRequest {
  readonly message: string;
  readonly project_id: string;
  readonly files: Record<string, string>;
  readonly conversation_history?: ReadonlyArray<{ role: string; content: string }>;
  readonly force_environment?: EnvironmentType;
}

export interface UnifiedChatResponse {
  readonly success: boolean;
  readonly message: string;
  readonly environment: EnvironmentType;
  readonly confidence: number;
  readonly tool_calls: ToolCall[];
  readonly updated_files: Record<string, string>;
  readonly sandbox_url?: string;
  readonly error?: string;
}

export const aiApi = {
  chat: async (request: ChatRequest): Promise<ChatResponse> => {
    const response = await api.post('/api/ai/chat', request);
    return response.data;
  },

  getSuggestions: async (): Promise<{ suggestions: string[] }> => {
    const response = await api.get('/api/ai/suggestions');
    return response.data;
  },

  getExamples: async (): Promise<{ examples: any[] }> => {
    const response = await api.get('/api/ai/examples');
    return response.data;
  },

  generateDApp: async (request: GenerateDAppRequest): Promise<GenerateDAppResponse> => {
    const response = await api.post('/api/ai/generate-dapp', request);
    return response.data;
  },

  agenticChat: async (request: AgenticChatRequest): Promise<AgenticChatResponse> => {
    const response = await api.post('/api/ai/agentic-chat', request);
    return response.data;
  },

  unifiedChat: async (request: UnifiedChatRequest): Promise<UnifiedChatResponse> => {
    const response = await api.post('/api/ai/unified-chat', request);
    return response.data;
  },
};

export const healthApi = {
  check: async (): Promise<{ status: string }> => {
    const response = await api.get('/health');
    return response.data;
  },
};

export default api;
