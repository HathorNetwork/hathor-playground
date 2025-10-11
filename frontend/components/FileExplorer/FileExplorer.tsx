'use client';

import React, { useState, useMemo } from 'react';
import { FileText, Plus, Trash2, Folder, FolderOpen, ChevronRight, ChevronDown, FileCode } from 'lucide-react';
import { useIDEStore, File, buildFolderTree, FolderNode, FileType } from '@/store/ide-store';
import { ProjectSelector } from '../ProjectSelector/ProjectSelector';
import { clsx } from 'clsx';

// File type icons
const getFileIcon = (file: File) => {
  switch (file.type) {
    case 'component':
    case 'hook':
      return <FileCode size={14} className="text-blue-400" />;
    case 'style':
      return <FileCode size={14} className="text-pink-400" />;
    case 'config':
      return <FileCode size={14} className="text-yellow-400" />;
    case 'test':
      return <FileText size={14} className="text-green-400" />;
    case 'contract':
    default:
      return <FileText size={14} className="text-purple-400" />;
  }
};

// File templates
const getFileTemplate = (type: FileType, fileName: string): string => {
  const cleanName = fileName.replace(/\.(py|tsx?|css|json)$/, '').replace(/[^a-zA-Z]/g, '');

  switch (type) {
    case 'contract':
      return `from hathor.nanocontracts import Blueprint
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

__blueprint__ = ${cleanName}`;

    case 'component':
      return `import React from 'react';

interface ${cleanName}Props {
  // Add your props here
}

export const ${cleanName}: React.FC<${cleanName}Props> = (props) => {
  return (
    <div className="p-4">
      <h2 className="text-xl font-bold">${cleanName}</h2>
      {/* Add your component content here */}
    </div>
  );
};
`;

    case 'hook':
      return `import { useState, useEffect } from 'react';

export const use${cleanName} = () => {
  // Add your hook logic here

  return {
    // Return values
  };
};
`;

    case 'style':
      return `/* Styles for ${cleanName} */
`;

    case 'config':
      return `{
  "name": "${fileName}",
  "description": "Configuration file"
}
`;

    case 'test':
      return `# Test file for ${cleanName}
`;

    default:
      return '';
  }
};

// Folder component (recursive)
interface FolderComponentProps {
  folder: FolderNode;
  level: number;
}

const FolderComponent: React.FC<FolderComponentProps> = ({ folder, level }) => {
  const { activeFileId, openFile, deleteFile, files, addFile } = useIDEStore();
  const [isExpanded, setIsExpanded] = useState(true);
  const [showNewFileMenu, setShowNewFileMenu] = useState(false);
  const [showNewFileInput, setShowNewFileInput] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [newFileType, setNewFileType] = useState<FileType>('contract');

  const handleNewFile = () => {
    if (!newFileName.trim()) return;

    let fileName = newFileName;
    let language: 'python' | 'typescript' | 'typescriptreact' | 'css' | 'json' = 'python';
    let fileType = newFileType;

    // Auto-detect language from extension
    if (fileName.endsWith('.tsx')) {
      language = 'typescriptreact';
      fileType = 'component';
    } else if (fileName.endsWith('.ts')) {
      language = 'typescript';
      fileType = 'hook';
    } else if (fileName.endsWith('.css')) {
      language = 'css';
      fileType = 'style';
    } else if (fileName.endsWith('.json')) {
      language = 'json';
      fileType = 'config';
    } else if (fileName.endsWith('.py')) {
      language = 'python';
      // Keep the selected type (contract or test)
    } else {
      // Add extension based on file type
      if (fileType === 'component') {
        fileName += '.tsx';
        language = 'typescriptreact';
      } else if (fileType === 'hook') {
        fileName += '.ts';
        language = 'typescript';
      } else if (fileType === 'style') {
        fileName += '.css';
        language = 'css';
      } else if (fileType === 'config') {
        fileName += '.json';
        language = 'json';
      } else {
        fileName += '.py';
        language = 'python';
      }
    }

    const newFile: File = {
      id: Date.now().toString(),
      name: fileName,
      content: getFileTemplate(fileType, fileName),
      language,
      path: `${folder.path}/${fileName}`,
      type: fileType,
    };

    addFile(newFile);
    setNewFileName('');
    setShowNewFileInput(false);
    setShowNewFileMenu(false);
  };

  const handleDeleteFile = (e: React.MouseEvent, fileId: string) => {
    e.stopPropagation();
    if (files.length > 1) {
      deleteFile(fileId);
    }
  };

  const showNewFileOptions = () => {
    setShowNewFileMenu(!showNewFileMenu);
  };

  const selectFileType = (type: FileType) => {
    setNewFileType(type);
    setShowNewFileMenu(false);
    setShowNewFileInput(true);
  };

  return (
    <div style={{ marginLeft: `${level * 12}px` }}>
      {/* Folder Header */}
      <div className="flex items-center justify-between mb-2 group">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-2 hover:text-blue-400 transition-colors flex-1"
        >
          {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          {isExpanded ? <FolderOpen size={16} /> : <Folder size={16} />}
          <span className="text-sm font-medium">{folder.name || 'Root'}</span>
          <span className="text-xs text-gray-500">({folder.files.length + folder.subfolders.length})</span>
        </button>
        <button
          onClick={showNewFileOptions}
          className="p-1 hover:bg-gray-800 rounded transition-colors opacity-0 group-hover:opacity-100"
          title="New File"
        >
          <Plus size={16} />
        </button>
      </div>

      {/* New File Type Menu */}
      {showNewFileMenu && (
        <div className="mb-2 ml-6 bg-gray-800 border border-gray-700 rounded p-2 space-y-1">
          <button
            onClick={() => selectFileType('contract')}
            className="w-full text-left px-2 py-1 hover:bg-gray-700 rounded text-sm"
          >
            📄 Contract (.py)
          </button>
          <button
            onClick={() => selectFileType('test')}
            className="w-full text-left px-2 py-1 hover:bg-gray-700 rounded text-sm"
          >
            🧪 Test (.py)
          </button>
          <button
            onClick={() => selectFileType('component')}
            className="w-full text-left px-2 py-1 hover:bg-gray-700 rounded text-sm"
          >
            ⚛️ Component (.tsx)
          </button>
          <button
            onClick={() => selectFileType('hook')}
            className="w-full text-left px-2 py-1 hover:bg-gray-700 rounded text-sm"
          >
            🪝 Hook (.ts)
          </button>
          <button
            onClick={() => selectFileType('style')}
            className="w-full text-left px-2 py-1 hover:bg-gray-700 rounded text-sm"
          >
            🎨 Style (.css)
          </button>
          <button
            onClick={() => selectFileType('config')}
            className="w-full text-left px-2 py-1 hover:bg-gray-700 rounded text-sm"
          >
            ⚙️ Config (.json)
          </button>
        </div>
      )}

      {/* New File Input */}
      {showNewFileInput && (
        <div className="mb-2 ml-6">
          <input
            type="text"
            value={newFileName}
            onChange={(e) => setNewFileName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleNewFile();
              if (e.key === 'Escape') {
                setShowNewFileInput(false);
                setNewFileName('');
              }
            }}
            onBlur={handleNewFile}
            placeholder={`filename (${newFileType})`}
            className="w-full px-2 py-1 text-sm bg-gray-800 border border-gray-700 rounded focus:outline-none focus:border-blue-500"
            autoFocus
          />
        </div>
      )}

      {/* Folder Contents */}
      {isExpanded && (
        <div className="space-y-1">
          {/* Subfolders */}
          {folder.subfolders.map((subfolder) => (
            <FolderComponent key={subfolder.path} folder={subfolder} level={level + 1} />
          ))}

          {/* Files */}
          {folder.files.map((file) => (
            <div
              key={file.id}
              onClick={() => openFile(file.id)}
              className={clsx(
                'flex items-center justify-between px-2 py-1 rounded cursor-pointer transition-colors group',
                activeFileId === file.id
                  ? 'bg-blue-600 text-white'
                  : 'hover:bg-gray-800'
              )}
              style={{ marginLeft: `${(level + 1) * 12}px` }}
            >
              <div className="flex items-center gap-2">
                {getFileIcon(file)}
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

          {folder.files.length === 0 && folder.subfolders.length === 0 && (
            <div className="text-gray-500 text-sm px-2 py-1 italic" style={{ marginLeft: `${(level + 1) * 12}px` }}>
              Empty folder
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const FileExplorer: React.FC = () => {
  const { files } = useIDEStore();

  // Build folder tree from files
  const folderTree = useMemo(() => buildFolderTree(files), [files]);

  return (
    <div className="h-full bg-gray-900 text-gray-100 p-4 overflow-auto flex flex-col">
      <h3 className="text-lg font-semibold text-white mb-4">File Explorer</h3>

      {/* Project Selector */}
      <div className="mb-4">
        <ProjectSelector />
      </div>

      {/* File Tree */}
      <div className="flex-1 overflow-auto">
        {/* Render root folders */}
        {folderTree.subfolders.map((folder) => (
          <FolderComponent key={folder.path} folder={folder} level={0} />
        ))}

        {/* Root files (if any) */}
        {folderTree.files.length > 0 && (
          <div className="mt-4">
            <FolderComponent folder={folderTree} level={0} />
          </div>
        )}
      </div>
    </div>
  );
};
