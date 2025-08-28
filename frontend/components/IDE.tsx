'use client';

import React from 'react';
import { Panel, PanelGroup, PanelResizeHandle, ImperativePanelHandle } from 'react-resizable-panels';
import { FileExplorer } from './FileExplorer/FileExplorer';
import { CodeEditor } from './Editor/CodeEditor';
import { Console } from './Console/Console';
import { Toolbar } from './Toolbar/Toolbar';
import { MethodExecutor } from './Execution/MethodExecutor';
import { AIAssistant } from './AI/AIAssistant';
import { PyodideLoader } from './PyodideLoader';
import { useIDEStore, File } from '@/store/ide-store';
import { contractsApi, validationApi } from '@/lib/api';

export function IDE() {
  const [currentBlueprintId, setCurrentBlueprintId] = React.useState<string | undefined>();
  const [isAICollapsed, setIsAICollapsed] = React.useState(false);
  const [isPyodideReady, setIsPyodideReady] = React.useState(false);
  const aiPanelRef = React.useRef<ImperativePanelHandle>(null);
  const codePanelRef = React.useRef<ImperativePanelHandle>(null);
  
  const {
    files,
    activeFileId,
    addConsoleMessage,
    setIsCompiling,
    setIsExecuting,
    isCompiling,
    isExecuting,
    addCompiledContract,
    clearContractInstances,
    initializeStore,
    commitChanges,
    setGitRemote,
    pushToRemote,
    getCommitHistory,
    checkoutVersion,
    listBranches,
    createBranch,
    switchBranch,
  } = useIDEStore();

  // Initialize storage on component mount
  React.useEffect(() => {
    initializeStore();
  }, [initializeStore]);

  // Auto-compile when switching to a different file
  React.useEffect(() => {
    if (activeFile && isPyodideReady && !isCompiling) {
      // Add a small delay to avoid rapid recompilation during initialization
      const timer = setTimeout(() => {
        addConsoleMessage('info', `Auto-compiling ${activeFile.name}...`);
        handleCompile();
      }, 500);

      return () => clearTimeout(timer);
    }
  }, [activeFileId, isPyodideReady]); // Trigger when file changes or Pyodide becomes ready

  const activeFile = files.find((f: File) => f.id === activeFileId);

  const handleCompile = async () => {
    if (!activeFile) return;

    setIsCompiling(true);
    
    // Clear previous contract instances when starting a new compilation
    // This prevents using outdated contract instances with new blueprints
    clearContractInstances();
    
    addConsoleMessage('info', `Compiling ${activeFile.name}...`);

    try {
      // First validate the code
      const validationResult = await validationApi.validate({
        code: activeFile.content,
        strict: true,
      });

      // Log validation warnings/errors
      validationResult.errors.forEach((error) => {
        if (error.severity === 'error') {
          addConsoleMessage('error', `Line ${error.line}: ${error.message}`);
        } else {
          addConsoleMessage('warning', `Line ${error.line}: ${error.message}`);
        }
      });

      if (!validationResult.valid && validationResult.errors.some(e => e.severity === 'error')) {
        addConsoleMessage('error', 'Compilation failed due to validation errors');
        return;
      }

      // Debug: Log the contract code being sent
      console.log('Compiling contract:', activeFile.name);
      console.log('Contract content preview:', activeFile.content.substring(0, 200));
      console.log('Contains "Address":', activeFile.content.includes('Address'));
      console.log('Contains "VertexId":', activeFile.content.includes('VertexId'));
      
      // Compile the contract
      const result = await contractsApi.compile({
        code: activeFile.content,
        blueprint_name: activeFile.name.replace('.py', ''),
      });

      if (result.success) {
        addConsoleMessage('success', `✅ Successfully compiled ${activeFile.name}`);
        if (result.blueprint_id) {
          addConsoleMessage('info', `Blueprint ID: ${result.blueprint_id}`);
        }
        if (result.gas_estimate) {
          addConsoleMessage('info', `Estimated gas: ${result.gas_estimate}`);
        }

        // Add to compiled contracts and set current blueprint
        if (result.blueprint_id) {
          setCurrentBlueprintId(result.blueprint_id);
          addCompiledContract({
            contract_id: result.blueprint_id,
            blueprint_id: result.blueprint_id,
            code: activeFile.content,
            methods: [],
            created_at: new Date().toISOString(),
          });
        }
      } else {
        addConsoleMessage('error', 'Compilation failed');
        result.errors.forEach((error) => {
          addConsoleMessage('error', error);
        });
      }

      result.warnings.forEach((warning) => {
        addConsoleMessage('warning', warning);
      });
    } catch (error: any) {
      addConsoleMessage('error', `Compilation error: ${error.message || error}`);
    } finally {
      setIsCompiling(false);
    }
  };

  const handleExecute = async () => {
    if (!activeFile) return;

    setIsExecuting(true);
    addConsoleMessage('info', `Executing ${activeFile.name}...`);

    try {
      // For now, just compile and create a contract instance
      const compileResult = await contractsApi.compile({
        code: activeFile.content,
        blueprint_name: activeFile.name.replace('.py', ''),
      });

      if (compileResult.success && compileResult.blueprint_id) {
        // Try to execute the initialize method
        const executeResult = await contractsApi.execute({
          contract_id: compileResult.blueprint_id,
          method_name: 'initialize',
          args: [],
          kwargs: {},
        });

        if (executeResult.success) {
          addConsoleMessage('success', '✅ Contract executed successfully');
          if (executeResult.result !== undefined) {
            addConsoleMessage('info', `Result: ${JSON.stringify(executeResult.result)}`);
          }
          if (executeResult.gas_used) {
            addConsoleMessage('info', `Gas used: ${executeResult.gas_used}`);
          }
        } else {
          addConsoleMessage('error', `Execution failed: ${executeResult.error}`);
        }
      }
    } catch (error: any) {
      addConsoleMessage('error', `Execution error: ${error.message || error}`);
    } finally {
      setIsExecuting(false);
    }
  };

  const handleCommit = async () => {
    const message = prompt('Commit message:');
    if (!message) return;
    try {
      await commitChanges(message);
      addConsoleMessage('success', 'Changes committed');
    } catch (e: any) {
      addConsoleMessage('error', `Commit failed: ${e?.message || e}`);
    }
  };

  const handlePush = async () => {
    try {
      const remote = prompt('Remote URL (leave blank to use existing):');
      if (remote) {
        await setGitRemote(remote);
      }
      const username = prompt('Remote username (optional):') || undefined;
      const password = prompt('Remote password/token (optional):') || undefined;
      await pushToRemote(username, password);
      addConsoleMessage('success', 'Pushed to remote');
    } catch (e: any) {
      addConsoleMessage('error', `Push failed: ${e?.message || e}`);
    }
  };

  const handleHistory = async () => {
    try {
      const commits = await getCommitHistory();
      if (commits.length === 0) {
        addConsoleMessage('info', 'No commits found');
      }
      commits.forEach(c => addConsoleMessage('info', `${c.oid}: ${c.commit.message}`));
    } catch (e: any) {
      addConsoleMessage('error', `History failed: ${e?.message || e}`);
    }
  };

  const handleCheckout = async () => {
    const ref = prompt('Commit hash or branch to checkout:');
    if (!ref) return;
    try {
      await checkoutVersion(ref);
      addConsoleMessage('success', `Checked out ${ref}`);
    } catch (e: any) {
      addConsoleMessage('error', `Checkout failed: ${e?.message || e}`);
    }
  };

  const handleListBranches = async () => {
    try {
      const branches = await listBranches();
      if (branches.length === 0) {
        addConsoleMessage('info', 'No branches found');
      }
      branches.forEach(b => addConsoleMessage('info', `Branch: ${b}`));
    } catch (e: any) {
      addConsoleMessage('error', `List branches failed: ${e?.message || e}`);
    }
  };

  const handleCreateBranch = async () => {
    const name = prompt('New branch name:');
    if (!name) return;
    try {
      await createBranch(name);
      addConsoleMessage('success', `Branch ${name} created`);
    } catch (e: any) {
      addConsoleMessage('error', `Create branch failed: ${e?.message || e}`);
    }
  };

  const handleSwitchBranch = async () => {
    const name = prompt('Branch to switch to:');
    if (!name) return;
    try {
      await switchBranch(name);
      addConsoleMessage('success', `Switched to branch ${name}`);
    } catch (e: any) {
      addConsoleMessage('error', `Switch branch failed: ${e?.message || e}`);
    }
  };

  return (
    <div className="h-screen flex flex-col bg-gray-900">
      <Toolbar
        onCompile={handleCompile}
        onExecute={handleExecute}
        onCommit={handleCommit}
        onPush={handlePush}
        onHistory={handleHistory}
        onCheckout={handleCheckout}
        onListBranches={handleListBranches}
        onCreateBranch={handleCreateBranch}
        onSwitchBranch={handleSwitchBranch}
        isCompiling={isCompiling}
        isExecuting={isExecuting}
        fileName={activeFile?.name}
      />
      
      <div className="flex-1 overflow-hidden">
        <PanelGroup direction="horizontal">
          <Panel defaultSize={20} minSize={15} maxSize={25}>
            <FileExplorer />
          </Panel>
          
          <PanelResizeHandle className="w-1 bg-gray-800 hover:bg-blue-600 transition-colors" />
          
          <Panel defaultSize={25} minSize={15} maxSize={30}>
            <MethodExecutor blueprintId={currentBlueprintId} />
          </Panel>
          
          <PanelResizeHandle className="w-1 bg-gray-800 hover:bg-blue-600 transition-colors" />
          
          <Panel ref={codePanelRef} defaultSize={35}>
            <PanelGroup direction="vertical">
              <Panel defaultSize={70}>
                <CodeEditor />
              </Panel>
              
              <PanelResizeHandle className="h-1 bg-gray-800 hover:bg-blue-600 transition-colors" />
              
              <Panel defaultSize={30} minSize={15}>
                <Console />
              </Panel>
            </PanelGroup>
          </Panel>
          
          <PanelResizeHandle className="w-1 bg-gray-800 hover:bg-blue-600 transition-colors" />
          
          <Panel ref={aiPanelRef} defaultSize={20} minSize={3} maxSize={40}>
            <AIAssistant
              isCollapsed={isAICollapsed}
              onToggleCollapse={() => {
                const newCollapsed = !isAICollapsed;
                setIsAICollapsed(newCollapsed);
                
                // Use imperative API to resize panels
                setTimeout(() => {
                  if (aiPanelRef.current && codePanelRef.current) {
                    if (newCollapsed) {
                      // Collapse AI panel to minimum, expand code panel
                      aiPanelRef.current.resize(3);
                      codePanelRef.current.resize(52);
                    } else {
                      // Expand AI panel, shrink code panel
                      aiPanelRef.current.resize(20);
                      codePanelRef.current.resize(35);
                    }
                  }
                }, 10);
              }}
            />
          </Panel>
        </PanelGroup>
      </div>
      
      {/* Pyodide Loader */}
      {!isPyodideReady && (
        <PyodideLoader onReady={() => setIsPyodideReady(true)} />
      )}
    </div>
  );
}