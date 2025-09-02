'use client';

import React from 'react';
import { Panel, PanelGroup, PanelResizeHandle, ImperativePanelHandle } from 'react-resizable-panels';
import { Files } from 'lucide-react';
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
  const [isFileExplorerCollapsed, setIsFileExplorerCollapsed] = React.useState(false);
  const aiPanelRef = React.useRef<ImperativePanelHandle>(null);
  const codePanelRef = React.useRef<ImperativePanelHandle>(null);
  const fileExplorerPanelRef = React.useRef<ImperativePanelHandle>(null);
  
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
          code: activeFile.content,
        });

        if (executeResult.success) {
          addConsoleMessage('success', '✅ Contract executed successfully');
          if (executeResult.result !== undefined) {
            addConsoleMessage('info', `Result: ${JSON.stringify(executeResult.result)}`);
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

  const toggleFileExplorer = () => {
    const newCollapsed = !isFileExplorerCollapsed;
    setIsFileExplorerCollapsed(newCollapsed);
    
    // Use imperative API to resize panels
    setTimeout(() => {
      if (fileExplorerPanelRef.current && codePanelRef.current) {
        if (newCollapsed) {
          // Collapse file explorer to minimum, expand other panels
          fileExplorerPanelRef.current.resize(3);
        } else {
          // Expand file explorer, adjust other panels
          fileExplorerPanelRef.current.resize(20);
        }
      }
    }, 10);
  };

  return (
    <div className="h-screen flex flex-col bg-gray-900">
      <Toolbar
        onCompile={handleCompile}
        onExecute={handleExecute}
        isCompiling={isCompiling}
        isExecuting={isExecuting}
        fileName={activeFile?.name}
      />
      
      <div className="flex-1 overflow-hidden flex">
        {/* Left Sidebar with Icons */}
        <div className="flex">
          <div className="w-12 bg-gray-800 flex flex-col items-center py-2">
            <button
              onClick={toggleFileExplorer}
              className={`p-2 hover:bg-gray-700 rounded transition-colors relative group ${
                !isFileExplorerCollapsed ? 'bg-gray-700 text-white' : 'text-gray-400'
              }`}
              title="File Explorer"
            >
              <Files size={18} />
              
              {/* Tooltip - show when collapsed to identify icons */}
              <div className="absolute left-full ml-2 top-1/2 transform -translate-y-1/2 bg-gray-900 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-50 pointer-events-none">
                File Explorer
              </div>
            </button>
          </div>
          
          {/* File Explorer Panel - only show if not collapsed */}
          {!isFileExplorerCollapsed && (
            <div className="w-64 border-r border-gray-800">
              <FileExplorer />
            </div>
          )}
        </div>

        {/* Main Content Area */}
        <div className="flex-1">
          <PanelGroup direction="horizontal">
            <Panel defaultSize={30} minSize={15} maxSize={35}>
              <MethodExecutor blueprintId={currentBlueprintId} />
            </Panel>
            
            <PanelResizeHandle className="w-1 bg-gray-800 hover:bg-blue-600 transition-colors" />
            
            <Panel ref={codePanelRef} defaultSize={45}>
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
            
            <Panel ref={aiPanelRef} defaultSize={25} minSize={3} maxSize={40}>
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
                        codePanelRef.current.resize(67);
                      } else {
                        // Expand AI panel, shrink code panel
                        aiPanelRef.current.resize(25);
                        codePanelRef.current.resize(45);
                      }
                    }
                  }, 10);
                }}
              />
            </Panel>
          </PanelGroup>
        </div>
      </div>
      
      {/* Pyodide Loader */}
      {!isPyodideReady && (
        <PyodideLoader onReady={() => setIsPyodideReady(true)} />
      )}
    </div>
  );
}
