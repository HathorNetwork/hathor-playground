'use client';

import React from 'react';
import { Panel, PanelGroup, PanelResizeHandle, ImperativePanelHandle } from 'react-resizable-panels';
import { EditorTabs } from './Editor/EditorTabs';
import { CodeEditor } from './Editor/CodeEditor';
import { Console } from './Console/Console';
import { Toolbar } from './Toolbar/Toolbar';
import { AIAssistant } from './AI/AIAssistant';
import { PyodideLoader } from './PyodideLoader';
import { useIDEStore, File } from '@/store/ide-store';
import { contractsApi, validationApi } from '@/lib/api';
import { LeftSidebarContent } from './LeftSidebar/LeftSidebarContent';
import { Files, Play, Beaker } from 'lucide-react';
import { clsx } from 'clsx';

export function IDE() {
  
  const [isAICollapsed, setIsAICollapsed] = React.useState(true);
  const [isPyodideReady, setIsPyodideReady] = React.useState(false);
  const [isLeftSidebarCollapsed, setIsLeftSidebarCollapsed] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState('files');
  const aiPanelRef = React.useRef<ImperativePanelHandle>(null);
  const codePanelRef = React.useRef<ImperativePanelHandle>(null);
  const leftSidebarPanelRef = React.useRef<ImperativePanelHandle>(null);
  
  const {
    files,
    activeFileId,
    addConsoleMessage,
    setIsCompiling,
    setIsExecuting,
    setIsRunningTests,
    isCompiling,
    isExecuting,
    isRunningTests,
    addCompiledContract,
    clearContractInstances,
    initializeStore,
  } = useIDEStore();

  // Initialize storage on component mount
  React.useEffect(() => {
    initializeStore();
  }, [initializeStore]);

  React.useEffect(() => {
    if (leftSidebarPanelRef.current) {
      if (isLeftSidebarCollapsed) {
        leftSidebarPanelRef.current.collapse();
      } else {
        leftSidebarPanelRef.current.expand();
      }
    }
  }, [isLeftSidebarCollapsed]);

  React.useEffect(() => {
    if (aiPanelRef.current && codePanelRef.current) {
      if (isAICollapsed) {
        aiPanelRef.current.resize(3);
        codePanelRef.current.resize(67);
      } else {
        aiPanelRef.current.resize(25);
        codePanelRef.current.resize(45);
      }
    }
  }, [isAICollapsed]);

  const activeFile = files.find((f: File) => f.id === activeFileId);

  

  const handleExecute = async () => {
    if (!activeFile) return;

    setIsExecuting(true);
    addConsoleMessage('info', `Executing ${activeFile.name}...`);

    try {
      const compileResult = await contractsApi.compile({
        code: activeFile.content,
        blueprint_name: activeFile.name.replace('.py', ''),
      });

      if (compileResult.success && compileResult.blueprint_id) {
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

  const handleRunTests = async () => {
    if (!activeFile || activeFile.type !== 'test') return;

    setIsRunningTests(true);
    addConsoleMessage('info', `Running tests from ${activeFile.name}...`);

    try {
      const { validateTestBlueprints, combineCodeForTesting } = await import('../utils/testParser');
      const { pyodideRunner } = await import('../lib/pyodide-runner');
      
      const contractFiles = files.filter(file => file.type !== 'test');
      
      const validation = validateTestBlueprints(activeFile, contractFiles);
      
      if (!validation.isValid) {
        validation.errors.forEach(error => {
          addConsoleMessage('error', `❌ ${error}`);
        });
        return;
      }
      
      const combinedCode = combineCodeForTesting(contractFiles, activeFile, validation.references);
      
      const testResult = await pyodideRunner.runTests(combinedCode, activeFile.name);
      
      if (testResult.success) {
        const testsRun = testResult.tests_run || 0;
        const testsPassed = testResult.tests_passed || 0;
        addConsoleMessage('success', `✅ All ${testsRun} test(s) passed successfully`);
      } else {
        const testsRun = testResult.tests_run || 0;
        const testsPassed = testResult.tests_passed || 0;
        const testsFailed = testResult.tests_failed || 0;
        
        if (testsRun > 0) {
          addConsoleMessage('error', `❌ Tests completed: ${testsPassed} passed, ${testsFailed} failed`);
        } else {
          addConsoleMessage('error', '❌ No tests were executed');
        }
      }
      
      if (testResult.output && testResult.output.trim()) {
        addConsoleMessage('info', testResult.output.trim());
      }
      
      if (testResult.error && !testResult.success) {
        addConsoleMessage('error', `💥 Error details: ${testResult.error}`);
      }
      
    } catch (error: any) {
      addConsoleMessage('error', `Test running error: ${error.message || error}`);
      console.error('Full test execution error:', error);
    } finally {
      setIsRunningTests(false);
    }
  };

  const handleTabClick = (tab: string) => {
    if (tab === activeTab) {
      setIsLeftSidebarCollapsed(!isLeftSidebarCollapsed);
    } else {
      setActiveTab(tab);
      if (isLeftSidebarCollapsed) {
        setIsLeftSidebarCollapsed(false);
      }
    }
  };

  return (
    <div className="h-screen flex flex-col bg-gray-900">
      <Toolbar
        fileName={activeFile?.name}
      />
      
      <div className="flex-1 overflow-hidden flex">
        <div className="w-16 bg-gray-800 flex flex-col items-center py-2 space-y-4">
        <button
          onClick={() => handleTabClick('files')}
          className={clsx('p-2 rounded-lg transition-colors relative group', {
            'bg-blue-600 text-white': activeTab === 'files' && !isLeftSidebarCollapsed,
            'text-gray-400 hover:bg-gray-700': activeTab !== 'files' || isLeftSidebarCollapsed,
          })}
          title="File Explorer"
        >
          <Files size={24} />
          <div className="absolute left-full ml-2 top-1/2 transform -translate-y-1/2 bg-gray-900 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-50 pointer-events-none">
            File Explorer
          </div>
        </button>
        <button
          onClick={() => handleTabClick('run')}
          className={clsx('p-2 rounded-lg transition-colors relative group', {
            'bg-blue-600 text-white': activeTab === 'run' && !isLeftSidebarCollapsed,
            'text-gray-400 hover:bg-gray-700': activeTab !== 'run' || isLeftSidebarCollapsed,
          })}
          title="Deploy & Run"
        >
          <Play size={24} />
          <div className="absolute left-full ml-2 top-1/2 transform -translate-y-1/2 bg-gray-900 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-50 pointer-events-none">
            Deploy & Run
          </div>
        </button>
        <button
          onClick={() => handleTabClick('tests')}
          className={clsx('p-2 rounded-lg transition-colors relative group', {
            'bg-blue-600 text-white': activeTab === 'tests' && !isLeftSidebarCollapsed,
            'text-gray-400 hover:bg-gray-700': activeTab !== 'tests' || isLeftSidebarCollapsed,
          })}
          title="Tests"
        >
          <Beaker size={24} />
          <div className="absolute left-full ml-2 top-1/2 transform -translate-y-1/2 bg-gray-900 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-50 pointer-events-none">
            Tests
          </div>
        </button>
      </div>
        <PanelGroup direction="horizontal">
          <Panel ref={leftSidebarPanelRef} collapsible={true} defaultSize={30} minSize={5} maxSize={40}>
            <LeftSidebarContent
              activeTab={activeTab}
              onRunTests={handleRunTests}
            />
          </Panel>
          <PanelResizeHandle className="w-1 bg-gray-800 hover:bg-blue-600 transition-colors" />
          <Panel ref={codePanelRef} defaultSize={45}>
            <PanelGroup direction="vertical">
              <Panel defaultSize={70}>
                <EditorTabs />
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
                
                setTimeout(() => {
                  if (aiPanelRef.current && codePanelRef.current) {
                    if (newCollapsed) {
                      aiPanelRef.current.resize(3);
                      codePanelRef.current.resize(67);
                    } else {
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
      
      {!isPyodideReady && (
        <PyodideLoader onReady={() => setIsPyodideReady(true)} />
      )}
    </div>
  );
}