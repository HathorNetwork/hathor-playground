'use client';

import React from 'react';
import { useIDEStore } from '@/store/ide-store';
import { contractsApi } from '@/lib/api';
import { steps, Step } from './steps';

export function Walkthrough() {
  const { files, activeFileId, addConsoleMessage } = useIDEStore();
  const activeFile = files.find(f => f.id === activeFileId);
  const [stepIndex, setStepIndex] = React.useState(0);
  const [isRunning, setIsRunning] = React.useState(false);
  const [finalBlueprintId, setFinalBlueprintId] = React.useState<string>('');

  const currentStep: Step | undefined = steps[stepIndex];

  const runTest = async () => {
    if (!activeFile || !currentStep) return;
    setIsRunning(true);
    addConsoleMessage('info', `Testing step ${stepIndex + 1}: ${currentStep.title}`);
    try {
      const result = await contractsApi.compile({
        code: activeFile.content,
        blueprint_name: activeFile.name.replace('.py', ''),
      });
      if (!result.success || !result.blueprint_id) {
        addConsoleMessage('error', 'Compilation failed');
        setIsRunning(false);
        return;
      }
      const passed = await currentStep.test({
        code: activeFile.content,
        blueprintId: result.blueprint_id,
      });
      if (passed) {
        addConsoleMessage('success', `Step ${stepIndex + 1} passed`);
        setStepIndex(stepIndex + 1);
      } else {
        addConsoleMessage('warning', 'Step requirements not met');
      }
    } catch (err: any) {
      addConsoleMessage('error', `Test error: ${err.message}`);
    } finally {
      setIsRunning(false);
    }
  };

  React.useEffect(() => {
    if (!currentStep && activeFile && !finalBlueprintId) {
      const compile = async () => {
        const result = await contractsApi.compile({
          code: activeFile.content,
          blueprint_name: activeFile.name.replace('.py', ''),
        });
        if (result.success && result.blueprint_id) {
          setFinalBlueprintId(result.blueprint_id);
        } else {
          addConsoleMessage('error', 'Compilation failed');
        }
      };
      compile();
    }
  }, [currentStep, activeFile, finalBlueprintId, addConsoleMessage]);

  const copyBlueprint = () => {
    if (!activeFile) return;
    navigator.clipboard
      .writeText(activeFile.content)
      .then(() => addConsoleMessage('success', 'Blueprint code copied to clipboard'))
      .catch(err => addConsoleMessage('error', `Failed to copy blueprint: ${err.message}`));
  };

  const copyBlueprintId = () => {
    if (!finalBlueprintId) return;
    navigator.clipboard
      .writeText(finalBlueprintId)
      .then(() => addConsoleMessage('success', 'Blueprint ID copied to clipboard'))
      .catch(err => addConsoleMessage('error', `Failed to copy blueprint ID: ${err.message}`));
  };

  if (!currentStep) {
    return (
      <div className="p-4 text-white space-y-4">
        <h2 className="text-xl font-bold">Congratulations!</h2>
        <p>You have finished building the Crowdfund blueprint. Your blueprint ID is:</p>
        {finalBlueprintId && (
          <p className="break-all font-mono">{finalBlueprintId}</p>
        )}
        <div className="flex space-x-2">
          <button
            onClick={copyBlueprintId}
            className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded"
          >
            Copy Blueprint ID
          </button>
          <button
            onClick={copyBlueprint}
            className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded"
          >
            Copy Blueprint Code
          </button>
        </div>
        <pre className="bg-gray-800 p-2 rounded text-sm overflow-auto max-h-96">
{activeFile?.content}
</pre>
        <p className="text-sm">
          During the beta phase of nano contracts the Hathor team is reviewing all
          blueprint code that is deployed to the network. You can send it to
          <a href="mailto:pedro@hathor.network" className="underline ml-1 mr-1">
            pedro@hathor.network
          </a>
          or create a pull request to
          <a
            href="https://github.com/hathornetwork/hathor-core"
            className="underline ml-1"
          >
            github.com/hathornetwork/hathor-core
          </a>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 text-white space-y-4">
      <h2 className="text-xl font-bold">Step {stepIndex + 1}: {currentStep.title}</h2>
      <p>{currentStep.description}</p>
      <button
        onClick={runTest}
        disabled={isRunning}
        className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded"
      >
        {isRunning ? 'Running...' : 'Run Step Test'}
      </button>
    </div>
  );
}
