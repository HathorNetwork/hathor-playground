'use client';

import React, { useState } from 'react';
import { FileText, Plus, Trash2, FolderOpen, ChevronRight, ChevronDown } from 'lucide-react';
import { useIDEStore, File } from '@/store/ide-store';
import { clsx } from 'clsx';

export const FileExplorer: React.FC = () => {
  const { files, activeFileId, openFile, addFile, deleteFile } = useIDEStore();
  const [isContractsExpanded, setIsContractsExpanded] = useState(true);
  const [isTestsExpanded, setIsTestsExpanded] = useState(true);
  const [showNewFileInput, setShowNewFileInput] = useState<'contracts' | 'tests' | null>(null);
  const [newFileName, setNewFileName] = useState('');

  const handleNewFile = () => {
    if (newFileName.trim() && showNewFileInput) {
      const fileName = newFileName.endsWith('.py') ? newFileName : `${newFileName}.py`;
      const cleanName = newFileName.replace('.py', '').replace(/[^a-zA-Z]/g, '');
      
      const newFile = {
        id: Date.now().toString(),
        name: fileName,
        content: showNewFileInput === 'contracts' 
          ? `from hathor.nanocontracts import Blueprint
from hathor.nanocontracts.context import Context
from hathor.nanocontracts.types import public, view

class ${cleanName}(Blueprint):
    """Your contract description here"""
    
    # Contract state variables
    # example_value: int
    
    @public
    def initialize(self, ctx: Context) -> None:
        """Initialize the contract"""
        pass

__blueprint__ = ${cleanName}`
          : '',
        language: 'python',
        path: showNewFileInput === 'contracts' ? `/contracts/${fileName}` : `/tests/${fileName}`,
        type: showNewFileInput === 'contracts' ? 'contract' : 'test',
      };
      
      addFile(newFile);
      setNewFileName('');
      setShowNewFileInput(null);
    }
  };

  const handleDeleteFile = (e: React.MouseEvent, fileId: string) => {
    e.stopPropagation();
    if (files.length > 1) {
      deleteFile(fileId);
    }
  };

  // Separate files by type
  const contractFiles = files.filter((file: File) => file.type !== 'test');
  const testFiles = files.filter((file: File) => file.type === 'test');

  return (
    <div className="h-full bg-gray-900 text-gray-100 p-4">
      <h3 className="text-lg font-semibold text-white mb-4">File Explorer</h3>
      {/* Contracts Section */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <button
            onClick={() => setIsContractsExpanded(!isContractsExpanded)}
            className="flex items-center gap-2 hover:text-blue-400 transition-colors"
          >
            {isContractsExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            <FolderOpen size={16} />
            <span className="text-sm font-medium">Contracts</span>
          </button>
          <button
            onClick={() => setShowNewFileInput('contracts')}
            className="p-1 hover:bg-gray-800 rounded transition-colors"
            title="New Contract"
          >
            <Plus size={16} />
          </button>
        </div>

        {showNewFileInput === 'contracts' && (
          <div className="mb-2">
            <input
              type="text"
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleNewFile();
                if (e.key === 'Escape') {
                  setShowNewFileInput(null);
                  setNewFileName('');
                }
              }}
              onBlur={handleNewFile}
              placeholder="filename.py"
              className="w-full px-2 py-1 text-sm bg-gray-800 border border-gray-700 rounded focus:outline-none focus:border-blue-500"
              autoFocus
            />
          </div>
        )}

        {isContractsExpanded && (
          <div className="space-y-1 ml-4">
            {contractFiles.map((file: File) => (
              <div
                key={file.id}
                onClick={() => openFile(file.id)}
                className={clsx(
                  'flex items-center justify-between px-2 py-1 rounded cursor-pointer transition-colors group',
                  activeFileId === file.id
                    ? 'bg-blue-600 text-white'
                    : 'hover:bg-gray-800'
                )}
              >
                <div className="flex items-center gap-2">
                  <FileText size={14} />
                  <span className="text-sm">{file.name}</span>
                </div>
                {files.length > 1 && (
                  <button
                    onClick={(e) => handleDeleteFile(e, file.id)}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:bg-gray-700 rounded transition-all"
                    title="Delete File"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Tests Section */}
      <div className="mt-4">
        <div className="flex items-center justify-between mb-2">
          <button
            onClick={() => setIsTestsExpanded(!isTestsExpanded)}
            className="flex items-center gap-2 hover:text-blue-400 transition-colors"
          >
            {isTestsExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            <FolderOpen size={16} />
            <span className="text-sm font-medium">Tests</span>
          </button>
          <button
            onClick={() => setShowNewFileInput('tests')}
            className="p-1 hover:bg-gray-800 rounded transition-colors"
            title="New Test"
          >
            <Plus size={16} />
          </button>
        </div>

        {showNewFileInput === 'tests' && (
          <div className="mb-2">
            <input
              type="text"
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleNewFile();
                if (e.key === 'Escape') {
                  setShowNewFileInput(null);
                  setNewFileName('');
                }
              }}
              onBlur={handleNewFile}
              placeholder="test_filename.py"
              className="w-full px-2 py-1 text-sm bg-gray-800 border border-gray-700 rounded focus:outline-none focus:border-blue-500"
              autoFocus
            />
          </div>
        )}

        {isTestsExpanded && (
          <div className="space-y-1 ml-4">
            {testFiles.map((file: File) => (
              <div
                key={file.id}
                onClick={() => openFile(file.id)}
                className={clsx(
                  'flex items-center justify-between px-2 py-1 rounded cursor-pointer transition-colors group',
                  activeFileId === file.id
                    ? 'bg-blue-600 text-white'
                    : 'hover:bg-gray-800'
                )}
              >
                <div className="flex items-center gap-2">
                  <FileText size={14} />
                  <span className="text-sm">{file.name}</span>
                </div>
                {files.length > 1 && (
                  <button
                    onClick={(e) => handleDeleteFile(e, file.id)}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:bg-gray-700 rounded transition-all"
                    title="Delete File"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))}
            {testFiles.length === 0 && (
              <div className="text-gray-500 text-sm px-2 py-1 italic">
                No test files yet
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};