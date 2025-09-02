import axios from 'axios';
import { pyodideRunner } from './pyodide-runner';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Enable a lightweight mock implementation for e2e tests when
// NEXT_PUBLIC_PYODIDE_MOCK is set. This avoids downloading the full
// Pyodide runtime and large Hathor modules during Playwright runs.
const IS_PYODIDE_MOCK = process.env.NEXT_PUBLIC_PYODIDE_MOCK === 'true';

// Flag to determine if we should use browser-based execution
const USE_BROWSER_EXECUTION = !IS_PYODIDE_MOCK;

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
    if (IS_PYODIDE_MOCK) {
      return {
        success: true,
        blueprint_id: 'mock-blueprint',
        errors: [],
        warnings: [],
        gas_estimate: 0,
      };
    }

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
        gas_estimate: 1000 // Mock gas estimate
      };
    } else {
      // Use backend execution (fallback)
      const response = await api.post('/api/contracts/compile', request);
      return response.data;
    }
  },

  execute: async (request: ExecuteRequest): Promise<ExecuteResponse> => {
    if (IS_PYODIDE_MOCK) {
      return {
        success: true,
        result: null,
        gas_used: 0,
        logs: [],
        state_changes: {},
      };
    }

    if (USE_BROWSER_EXECUTION) {
      // Use browser-based Pyodide execution
      await pyodideRunner.initialize();

      const result = await pyodideRunner.executeContract({
        contract_id: request.contract_id,
        method_name: request.method_name,
        args: request.args || [],
        kwargs: request.kwargs || {},
        caller_address: request.caller_address || 'a1b2c3d4e5f6789012345678901234567890abcdef12345678',
        method_type: request.method_type,
        code: request.code
      });

      return {
        success: result.success,
        result: result.result,
        error: result.error,
        logs: result.output ? [result.output] : [],
        state_changes: {}
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
    if (IS_PYODIDE_MOCK) {
      return { valid: true, errors: [], suggestions: [] };
    }

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
};

export const healthApi = {
  check: async (): Promise<{ status: string }> => {
    const response = await api.get('/health');
    return response.data;
  },
};

export default api;
