
'use client';

import React from 'react';
import { FileExplorer } from '../FileExplorer/FileExplorer';
import { MethodExecutor } from '../Execution/MethodExecutor';
import { useIDEStore, File } from '@/store/ide-store';

interface LeftSidebarContentProps {
  activeTab: 'files' | 'run' | 'tests';
  onRunTests: () => void;
}

const TestsView: React.FC<{ onRunTests: () => void }> = ({ onRunTests }) => {
  const { files, setActiveFile, activeFileId } = useIDEStore();
  const testFiles = files.filter((file) => file.type === 'test');
  const activeTestFile = files.find((file) => file.id === activeFileId && file.type === 'test');

  React.useEffect(() => {
    if (!activeTestFile && testFiles.length > 0) {
      setActiveFile(testFiles[0].id);
    }
  }, [activeTestFile, testFiles, setActiveFile]);

  return (
    <div className="p-4">
      <h3 className="text-lg font-semibold text-white mb-4">Tests</h3>
      <div className="space-y-4">
        <div>
          <label htmlFor="test-file-select" className="block text-sm font-medium text-gray-300 mb-1">
            Test File
          </label>
          <select
            id="test-file-select"
            value={activeFileId || ''}
            onChange={(e) => setActiveFile(e.target.value)}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {testFiles.map((file) => (
              <option key={file.id} value={file.id}>
                {file.name}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={onRunTests}
          disabled={!activeTestFile}
          className="w-full bg-blue-600 text-white py-2 rounded-md hover:bg-blue-700 transition-colors disabled:bg-gray-600 disabled:cursor-not-allowed"
        >
          Run Tests
        </button>
      </div>
    </div>
  );
};

export const LeftSidebarContent: React.FC<LeftSidebarContentProps> = ({ activeTab, onRunTests }) => {
  switch (activeTab) {
    case 'files':
      return <FileExplorer />;
    case 'run':
      return <MethodExecutor onRunTests={() => {}} />;
    case 'tests':
      return <TestsView onRunTests={onRunTests} />;
    default:
      return null;
  }
};
