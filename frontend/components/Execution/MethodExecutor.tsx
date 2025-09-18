'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Play, Settings, TestTube, Loader2, Plus, Trash2 } from 'lucide-react';
import { useIDEStore, File, ContractInstance } from '@/store/ide-store';
import { contractsApi } from '@/lib/api';
import { parseContractMethods, MethodDefinition } from '@/utils/contractParser';

interface MethodExecutorProps { }

interface Action {
  id: string;
  type: 'deposit' | 'withdrawal';
  tokenId: string;
  amount: string;
}

export const MethodExecutor: React.FC<MethodExecutorProps> = ({ }) => {
  const [selectedMethod, setSelectedMethod] = useState('');
  const [parameterValues, setParameterValues] = useState<Record<string, string>>({});
  const [isExecuting, setIsExecuting] = useState(false);
  const [selectedCaller, setSelectedCaller] = useState<string>('Alice');
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [actions, setActions] = useState<Action[]>([]);
  const { addConsoleMessage, files, contractInstances, addContractInstance, isCompiling, isRunningTests } = useIDEStore();

  const contractFiles = files.filter((f) => f.type === 'contract');

  // Set default selected file
  useEffect(() => {
    if (!selectedFileId && contractFiles.length > 0) {
      setSelectedFileId(contractFiles[0].id);
    }
  }, [contractFiles, selectedFileId]);

  // Get current file content to parse methods
  const activeFile = files.find((f: File) => f.id === selectedFileId);

  // Parse methods from current file
  const methodDefinitions = useMemo(() => {
    if (!activeFile?.content) return [];
    return parseContractMethods(activeFile.content);
  }, [activeFile?.content]);

  // Get contract instance from store (persisted across address changes)
  const contractInstance = activeFile ? contractInstances[activeFile.id] : null;
  const contractId = contractInstance?.contractId;

  // Reset method selection when switching files and set default method
  useEffect(() => {
    if (methodDefinitions.length > 0) {
      // Try to find 'initialize' method first, otherwise use the first method
      const initMethod = methodDefinitions.find(m => m.name === 'initialize');
      const defaultMethod = initMethod ? initMethod.name : methodDefinitions[0].name;
      setSelectedMethod(defaultMethod);
      setParameterValues({}); // Clear parameter values when switching contracts
      setActions([]);
    } else {
      setSelectedMethod('');
      setParameterValues({});
      setActions([]);
    }
  }, [methodDefinitions, selectedFileId]);

  // Update parameter values when method changes
  const handleMethodChange = (method: string) => {
    setSelectedMethod(method);
    setParameterValues({}); // Clear parameter values when switching methods
    setActions([]);
  };

  const updateParameterValue = (paramName: string, value: string) => {
    setParameterValues(prev => ({ ...prev, [paramName]: value }));
  };

  const addAction = (type: 'deposit' | 'withdrawal') => {
    setActions(prev => [...prev, { id: Date.now().toString(), type, tokenId: '00', amount: '' }]);
  };

  const updateAction = (id: string, field: keyof Action, value: string) => {
    setActions(prev => prev.map(a => a.id === id ? { ...a, [field]: value } : a));
  };

  const removeAction = (id: string) => {
    setActions(prev => prev.filter(a => a.id !== id));
  };

  // Predefined caller addresses for testing (25 bytes = 50 hex characters for Address)
  // All addresses must be exactly 50 hex characters (0-9, a-f)
  const callerAddresses = {
    Alice: 'HMDhngejVRvLTTdFYMHMSpHACG1xqTVAVf',
    Bob: 'H8A264ZmEatQkb4X1RqPbnrXQpU2wKMApx',
    Charlie: 'HKMXcwTRWuSYEHW3WuWqqsMVHoPaLGoKmf',
    David: 'HFgg1irSHUDA1HSKXayUCZ8QZaeZ85U38F',
    owner: 'HQwMgXpvNuYX954RQVkVW4xRniAtc1DG4V',
  };

  // Predefined sample values for different Hathor SDK types
  const sampleValues = {
    tokenuid: {
      htr: '00',
      token_a: '00000943573723a28e3dd980c10e08419d0e00bc647a95f4ca9671ebea7d5669',
      token_b: '000002d4c7e859c6b1ba1bb2a3d59bb1e2d0ff3bb9a5b3b4b5f5e3c9d8e8c9bb',
      token_c: '0000854b320676bbd60eb7ca46a727fc4da6192d15c6782a23876b6a95c92256',
      token_d: '0000218fb19e736a546c472a1dfce039658f171ec41f06204795ab031cf7b8c6',
      token_e: '0000010ef9889a2d2f1a487d680b345f99289dd973468546232debc227ec1b55',
    },
    contractid: {
      contract_1: '000063f99b133c7630bc9d0117919f5b8726155412ad063dbbd618bdc7f85d7a',
      contract_2: '0001b8c4e2d1c3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8',
      contract_3: '000005ddb7e2cc3893c0406c082285cc73794492e40bbbdedbe1b6fcfc057b5f',
      contract_4: '000005ec47140ba6f1c7db766154bc2985f1af5435dc25cc7c5d167cd15539e4',
    },
    blueprintid: {
      blueprint_1: '3cb032600bdf7db784800e4ea911b10676fa2f67591f82bb62628c234e771595',
      blueprint_2: '4dc143711cef8ec895911f5fb822c21787fa3f78502f93cc73739d345f882606',
      blueprint_3: '000006d8a2c2fd50ee9a44fe2092f8a0ee12fd82a28bef5672dac56c38dde82a',
      blueprint_4: '0000085a6c3d058d11d7e40010cc368707cbd9164a5187779ab797b6ff1d9131',
    },
  };

  const _truncateAddress = (address: string) => {
    const start = address.substring(0, 6);
    const end = address.substring(address.length - 6);
    return `${start}...${end}`;
  }

  const _truncateId = (id: string) => {
    if (id === '00') return id;
    const start = id.substring(0, 8);
    const end = id.substring(id.length - 8);
    return `${start}...${end}`;
  }

  const handleExecute = async () => {
    if (!activeFile) {
      addConsoleMessage('error', 'No contract file selected.');
      return;
    }

    setIsExecuting(true);

    try {
      let blueprintIdToUse: string | undefined;
      let contractIdToUse: string | undefined;

      if (selectedMethod === 'initialize') {
        addConsoleMessage('info', `Deploying ${activeFile.name}...`);
        const compileResult = await contractsApi.compile({
          code: activeFile.content,
          blueprint_name: activeFile.name.replace('.py', ''),
        });

        if (!compileResult.success || !compileResult.blueprint_id) {
          addConsoleMessage('error', 'Deploy failed');
          compileResult.errors.forEach((error) => {
            addConsoleMessage('error', error);
          });
          setIsExecuting(false);
          return;
        }
        addConsoleMessage('success', `✅ Successfully deployed ${activeFile.name}`);
        addConsoleMessage('info', `Blueprint ID: ${compileResult.blueprint_id}`);
        blueprintIdToUse = compileResult.blueprint_id;
        contractIdToUse = compileResult.blueprint_id; // For initialize, contractId is the blueprintId
      } else {
        const instance = contractInstances[activeFile.id];
        if (!instance) {
          addConsoleMessage('error', 'Please initialize the contract first.');
          setIsExecuting(false);
          return;
        }
        blueprintIdToUse = instance.blueprintId;
        contractIdToUse = instance.contractId;
        addConsoleMessage('info', `Executing ${selectedMethod} on ${activeFile.name}...`);
      }

      addConsoleMessage('info', `Calling method: ${selectedMethod}...`);

      const currentMethod = methodDefinitions.find(m => m.name === selectedMethod);
      let args: any[] = [];
      if (currentMethod?.parameters && currentMethod.parameters.length > 0) {
        args = currentMethod.parameters.map(param => {
          const value = parameterValues[param.name] || '';
          if (!value && param.name !== 'initial_value' && param.name !== 'initial_supply') {
            throw new Error(`Missing required parameter: ${param.name}`);
          }
          if (param.type === 'int') {
            const numValue = parseInt(value || '0');
            if (isNaN(numValue)) {
              throw new Error(`Invalid integer value for ${param.name}: ${value}`);
            }
            return numValue;
          } else if (param.type === 'float') {
            const floatValue = parseFloat(value || '0');
            if (isNaN(floatValue)) {
              throw new Error(`Invalid float value for ${param.name}: ${value}`);
            }
            return floatValue;
          } else if (param.type === 'address') {
            if (value in callerAddresses) {
              return callerAddresses[value as keyof typeof callerAddresses];
            }
            return value;
          } else if (param.type === 'tokenuid' && value === '00') {
            return value;
          } else if (param.type === 'tokenuid' || param.type === 'contractid' || param.type === 'blueprintid' || param.type === 'vertexid') {
            const finalValue = value || '';
            if (finalValue && (!/^[0-9a-fA-F]{64}$/.test(finalValue))) {
              throw new Error(`Invalid ${param.type} for ${param.name}: ${finalValue}. Must be 64 hex characters (32 bytes).`);
            }
            return finalValue;
          } else if (param.type === 'amount') {
            const amountValue = parseInt(value || '0');
            if (isNaN(amountValue) || amountValue < 0) {
              throw new Error(`Invalid amount for ${param.name}: ${value}. Must be a non-negative integer where last 2 digits are decimals.`);
            }
            return amountValue;
          } else if (param.type === 'timestamp') {
            const timestampValue = parseInt(value || '0');
            if (isNaN(timestampValue) || timestampValue < 0) {
              throw new Error(`Invalid timestamp for ${param.name}: ${value}. Must be a non-negative integer (Unix epoch seconds).`);
            }
            return timestampValue;
          } else if (param.type === 'hex') {
            if (value && !/^[0-9a-fA-F]*$/.test(value)) {
              throw new Error(`Invalid hex value for ${param.name}: ${value}. Use only 0-9 and a-f characters.`);
            }
            return value;
          } else {
            return value;
          }
        });
      }

      const result = await contractsApi.execute({
        contract_id: contractIdToUse!,
        method_name: selectedMethod,
        args,
        kwargs: {},
        caller_address: callerAddresses[selectedCaller as keyof typeof callerAddresses],
        method_type: currentMethod?.decorator,
        code: activeFile?.content,
        actions: actions.map(a => ({ ...a, amount: Math.round(parseFloat(a.amount) * 100) }))
      });

      // Save execution logs from Pyodide to store
      if (result.logs && result.logs.length > 0) {
        setLastExecutionLogs(result.logs.join('\n'));
      } else if ((result as any).output) {
        // Fallback to output field if logs is not available
        setLastExecutionLogs((result as any).output);
      }

      if (result.success) {
        addConsoleMessage('success', `✅ Method '${selectedMethod}' executed successfully`);
        setActions([]);

        if (selectedMethod === 'initialize' && result.result && typeof result.result === 'object' && 'contract_id' in result.result) {
          const newContractId = (result.result as any).contract_id;
          const newInstance: ContractInstance = {
            blueprintId: blueprintIdToUse!,
            contractId: newContractId,
            contractName: activeFile?.name.replace('.py', '') || 'Unknown',
            timestamp: new Date()
          };
          addContractInstance(activeFile.id, newInstance);
          addConsoleMessage('info', `Contract created with ID: ${newContractId}`);
        } else if (result.result !== undefined && result.result !== null) {
          addConsoleMessage('info', `Result: ${JSON.stringify(result.result)}`);
        } else {
          addConsoleMessage('info', 'Method completed (no return value)');
        }
      } else {
        const errorMessage = result.error || 'Unknown error occurred';
        addConsoleMessage('error', `❌ Method execution failed:`);

        if (errorMessage.includes('AttributeError')) {
          addConsoleMessage('error', `  → ${errorMessage}`);
          if (errorMessage.includes('cannot set a container field')) {
            addConsoleMessage('warning', '  💡 Hint: Container fields (dict, list, set) are auto-initialized. Remove assignments like self.balances = {}');
          } else if (errorMessage.includes("'Context' object has no attribute 'address'")) {
            addConsoleMessage('warning', '  💡 Hint: Use ctx.vertex.hash instead of ctx.address for caller identity');
          }
        } else if (errorMessage.includes('ValueError')) {
          addConsoleMessage('error', `  → ${errorMessage}`);
        } else if (errorMessage.includes('TypeError')) {
          addConsoleMessage('error', `  → ${errorMessage}`);
        } else {
          addConsoleMessage('error', `  → ${errorMessage}`);
        }
      }
    } catch (error: any) {
      addConsoleMessage('error', `Execution error: ${error.message || error}`);
      // Clear execution logs on error
      setLastExecutionLogs(null);
    } finally {
      setIsExecuting(false);
    }
  };

  if (methodDefinitions.length === 0 && activeFile?.type !== 'test') {
    return (
      <div className="h-full p-4 flex items-center justify-center">
        <div className="text-gray-400 text-center">
          <Settings className="mx-auto mb-2" size={20} />
          <p className="text-sm">No methods found in contract</p>
          <p className="text-xs mt-1">Make sure your contract has @public or @view decorated methods</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full p-4 overflow-y-auto">
      <h3 className="text-lg font-semibold text-white mb-4">Deploy & Run</h3>
      <div className="flex flex-col gap-4">
        {contractInstance && (
          <div className="bg-green-900/30 border border-green-700 rounded p-2 text-sm">
            <span className="text-green-400">✅ Contract Initialized</span>
            <div className="text-green-300 text-xs mt-1">
              <div>Name: {contractInstance.contractName}</div>
              <div>ID: {_truncateId(contractInstance.contractId)}</div>
              <div>Created: {contractInstance.timestamp.toLocaleTimeString()}</div>
            </div>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Contract File:</label>
          <select
            value={selectedFileId || ''}
            onChange={(e) => setSelectedFileId(e.target.value)}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:outline-none focus:border-blue-500 mb-2"
          >
            {contractFiles.map((file) => (
              <option key={file.id} value={file.id}>
                {file.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Caller Address:
          </label>
          <select
            value={selectedCaller}
            onChange={(e) => setSelectedCaller(e.target.value)}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:outline-none focus:border-blue-500 mb-2"
          >
            {Object.keys(callerAddresses).map((name) => (
              <option key={name} value={name}>
                {name} ({_truncateAddress(callerAddresses[name as keyof typeof callerAddresses])})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Method to Execute:
          </label>
          <select
            value={selectedMethod}
            onChange={(e) => handleMethodChange(e.target.value)}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:outline-none focus:border-blue-500"
          >
            {methodDefinitions.map((method) => (
              <option key={method.name} value={method.name}>
                {method.name} - {method.description}
              </option>
            ))}
          </select>
        </div>

        {/* Parameter inputs */}
        {methodDefinitions.find(m => m.name === selectedMethod)?.parameters.map((param) => (
          <div key={param.name}>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              {param.name} ({param.type})
              <span className="text-gray-400 text-xs ml-1">- {param.description}</span>
            </label>
            {param.type === 'address' ? (
              <select
                value={parameterValues[param.name] || ''}
                onChange={(e) => updateParameterValue(param.name, e.target.value)}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:outline-none focus:border-blue-500"
              >
                <option value="">Select address...</option>
                {Object.keys(callerAddresses).map((name) => (
                  <option key={name} value={name}>
                    {name} ({_truncateAddress(callerAddresses[name as keyof typeof callerAddresses])})
                  </option>
                ))}
              </select>
            ) : param.type === 'tokenuid' ? (
              <div className="space-y-2">
                <select
                  value={parameterValues[param.name] || ''}
                  onChange={(e) => updateParameterValue(param.name, e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="">Select token UID or enter custom...</option>
                  {Object.entries(sampleValues.tokenuid).map(([name, uid]) => (
                    <option key={name} value={uid}>
                      {name.toUpperCase()} ({_truncateId(uid)})
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={parameterValues[param.name] || ''}
                  onChange={(e) => updateParameterValue(param.name, e.target.value)}
                  placeholder={param.placeholder}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                  maxLength={64}
                  pattern="[0-9a-fA-F]{64}"
                  title="Enter exactly 64 hexadecimal characters (0-9, a-f, A-F)"
                />
              </div>
            ) : param.type === 'contractid' ? (
              <div className="space-y-2">
                <select
                  value={parameterValues[param.name] || ''}
                  onChange={(e) => updateParameterValue(param.name, e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="">Select contract ID or enter custom...</option>
                  {Object.entries(sampleValues.contractid).map(([name, id]) => (
                    <option key={name} value={id}>
                      {name.replace('_', ' ').toUpperCase()} ({_truncateId(id)})
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={parameterValues[param.name] || ''}
                  onChange={(e) => updateParameterValue(param.name, e.target.value)}
                  placeholder={param.placeholder}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                  maxLength={64}
                  pattern="[0-9a-fA-F]{64}"
                  title="Enter exactly 64 hexadecimal characters (0-9, a-f, A-F)"
                />
              </div>
            ) : param.type === 'blueprintid' ? (
              <div className="space-y-2">
                <select
                  value={parameterValues[param.name] || ''}
                  onChange={(e) => updateParameterValue(param.name, e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="">Select blueprint ID or enter custom...</option>
                  {Object.entries(sampleValues.blueprintid).map(([name, id]) => (
                    <option key={name} value={id}>
                      {name.replace('_', ' ').toUpperCase()} ({_truncateId(id)})
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={parameterValues[param.name] || ''}
                  onChange={(e) => updateParameterValue(param.name, e.target.value)}
                  placeholder={param.placeholder}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                  maxLength={64}
                  pattern="[0-9a-fA-F]{64}"
                  title="Enter exactly 64 hexadecimal characters (0-9, a-f, A-F)"
                />
              </div>
            ) : (
              <input
                type={
                  param.type === 'int' || param.type === 'amount' || param.type === 'timestamp'
                    ? 'number'
                    : param.type === 'float'
                      ? 'number'
                      : 'text'
                }
                value={parameterValues[param.name] || ''}
                onChange={(e) => updateParameterValue(param.name, e.target.value)}
                placeholder={param.placeholder}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                step={param.type === 'float' ? '0.1' : param.type === 'amount' || param.type === 'timestamp' ? '1' : undefined}
                min={param.type === 'amount' || param.type === 'timestamp' ? '0' : undefined}
                maxLength={
                  param.type === 'tokenuid' || param.type === 'contractid' || param.type === 'blueprintid' || param.type === 'vertexid'
                    ? 64
                    : undefined
                }
                pattern={
                  param.type === 'tokenuid' || param.type === 'contractid' || param.type === 'blueprintid' || param.type === 'vertexid'
                    ? '[0-9a-fA-F]{64}'
                    : param.type === 'hex'
                      ? '[0-9a-fA-F]*'
                      : undefined
                }
                title={
                  param.type === 'tokenuid' || param.type === 'contractid' || param.type === 'blueprintid' || param.type === 'vertexid'
                    ? 'Enter exactly 64 hexadecimal characters (0-9, a-f, A-F)'
                    : param.type === 'hex'
                      ? 'Enter hexadecimal characters (0-9, a-f, A-F)'
                      : param.type === 'amount'
                        ? 'Enter amount where last 2 digits represent decimals (e.g., 1025 = 10.25 tokens)'
                        : param.type === 'timestamp'
                          ? 'Enter Unix timestamp in seconds'
                          : undefined
                }
              />
            )}
          </div>
        ))}

        {/* Actions Section */}
        <div className="space-y-2">
          <h4 className="text-md font-semibold text-gray-300">Actions</h4>
          {actions.map((action, index) => (
            <div key={action.id} className="flex items-center gap-2 p-2 border border-gray-700 rounded">
              <div className="flex-1 space-y-2">
                <div className="text-sm font-medium text-gray-400 capitalize">{action.type}</div>
                <select
                  value={action.tokenId}
                  onChange={(e) => updateAction(action.id, 'tokenId', e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:outline-none focus:border-blue-500"
                >
                  {Object.entries(sampleValues.tokenuid).map(([name, uid]) => (
                    <option key={name} value={uid}>
                      {name.toUpperCase()} ({_truncateId(uid)})
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  value={action.amount}
                  onChange={(e) => updateAction(action.id, 'amount', e.target.value)}
                  placeholder="Amount"
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                  step="0.01"
                  min="0"
                  onWheel={(e) => e.currentTarget.blur()}
                />
              </div>
              <button onClick={() => removeAction(action.id)} className="p-1 text-gray-400 hover:text-white">
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          <div className="flex gap-2">
            <button onClick={() => addAction('deposit')} className="flex items-center gap-1 text-sm text-blue-400 hover:text-blue-300">
              <Plus size={14} /> Add Deposit
            </button>
            <button onClick={() => addAction('withdrawal')} className="flex items-center gap-1 text-sm text-blue-400 hover:text-blue-300">
              <Plus size={14} /> Add Withdrawal
            </button>
          </div>
        </div>

        {/* Execute Method Button */}
        {activeFile?.type !== 'test' && (
          <button
            onClick={handleExecute}
            disabled={isExecuting || isCompiling || isRunningTests}
            className={`flex items-center justify-center gap-2 px-4 py-2 rounded font-medium transition-colors ${isExecuting || isCompiling || isRunningTests
                ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                : 'bg-green-600 text-white hover:bg-green-700'
              }`}
          >
            {isExecuting ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Play size={16} />
            )}
            {isExecuting ? 'Executing...' : `Execute ${selectedMethod}`}
          </button>
        )}
      </div>
    </div>
  );
};
