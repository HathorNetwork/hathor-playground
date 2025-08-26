'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Check, X, Eye, Maximize2, Minimize2 } from 'lucide-react';
import { Editor } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import { createTwoFilesPatch } from 'diff';

interface DiffViewerProps {
  originalCode: string;
  modifiedCode: string;
  fileName: string;
  onApply: (modifiedCode: string) => void;
  onReject: () => void;
}

export const DiffViewer: React.FC<DiffViewerProps> = ({
  originalCode,
  modifiedCode,
  fileName,
  onApply,
  onReject
}) => {
  const [viewMode, setViewMode] = useState<'diff' | 'preview'>('diff');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const diffEditorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const diffContainerRef = useRef<HTMLDivElement>(null);

  // Generate diff for display purposes
  const diff = createTwoFilesPatch(
    fileName,
    fileName,
    originalCode,
    modifiedCode,
    'Original',
    'Modified',
    { context: 3 }
  );

  // Calculate diff statistics
  const originalLines = originalCode.split('\n');
  const modifiedLines = modifiedCode.split('\n');
  const linesAdded = modifiedLines.length - originalLines.length;
  const linesModified = diff.split('\n').filter(line => line.startsWith('+')).length - 1; // -1 for header

  // Handle ESC key to exit fullscreen
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false);
      }
    };

    if (isFullscreen) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden'; // Prevent background scrolling
    } else {
      document.body.style.overflow = 'unset';
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'unset';
    };
  }, [isFullscreen]);

  // Create/recreate diff editor when viewMode, isFullscreen changes, or container is ready
  useEffect(() => {
    if (viewMode === 'diff' && diffContainerRef.current) {
      // Clean up existing editor
      if (diffEditorRef.current) {
        diffEditorRef.current.dispose();
        diffEditorRef.current = null;
      }

      // Create new diff editor
      import('monaco-editor').then((monacoInstance) => {
        if (diffContainerRef.current) {
          const diffEditor = monacoInstance.editor.createDiffEditor(diffContainerRef.current, {
            theme: 'vs-dark',
            readOnly: true,
            minimap: { enabled: isFullscreen },
            fontSize: isFullscreen ? 14 : 12,
            scrollBeyondLastLine: false,
            renderSideBySide: true,
            enableSplitViewResizing: true,
            renderOverviewRuler: isFullscreen,
            diffCodeLens: true,
            ignoreTrimWhitespace: false,
            wordWrap: isFullscreen ? 'on' : 'off',
            lineNumbers: 'on',
            glyphMargin: true,
            folding: isFullscreen,
          });

          // Set the models
          const originalModel = monacoInstance.editor.createModel(originalCode, 'python');
          const modifiedModel = monacoInstance.editor.createModel(modifiedCode, 'python');

          diffEditor.setModel({
            original: originalModel,
            modified: modifiedModel
          });

          // Store reference
          diffEditorRef.current = diffEditor;
        }
      });
    }

    // Cleanup function
    return () => {
      if (diffEditorRef.current) {
        diffEditorRef.current.dispose();
        diffEditorRef.current = null;
      }
    };
  }, [viewMode, isFullscreen, originalCode, modifiedCode]);

  const renderDiffContent = () => (
    <div className={`border border-blue-500 rounded-lg bg-gray-900 overflow-hidden ${
      isFullscreen ? 'h-full flex flex-col' : ''
    }`}>
      {/* Header */}
      <div className="bg-blue-600 px-4 py-2 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-white font-medium text-sm">
            📝 Code Suggestion for {fileName}
          </span>
          {isFullscreen && (
            <span className="text-blue-200 text-xs">
              (Press ESC to exit fullscreen)
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setViewMode(viewMode === 'diff' ? 'preview' : 'diff')}
            className="px-2 py-1 text-xs bg-blue-700 text-white rounded hover:bg-blue-800 transition-colors flex items-center gap-1"
          >
            <Eye size={12} />
            {viewMode === 'diff' ? 'Preview' : 'Diff'}
          </button>
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="px-2 py-1 text-xs bg-blue-700 text-white rounded hover:bg-blue-800 transition-colors flex items-center gap-1"
            title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
          >
            {isFullscreen ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
            {isFullscreen ? 'Exit' : 'Full'}
          </button>
          <button
            onClick={() => onApply(modifiedCode)}
            className="px-3 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 transition-colors flex items-center gap-1"
          >
            <Check size={12} />
            Apply
          </button>
          <button
            onClick={onReject}
            className="px-3 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700 transition-colors flex items-center gap-1"
          >
            <X size={12} />
            Reject
          </button>
        </div>
      </div>

      {/* Content */}
      <div className={isFullscreen ? 'flex-1 min-h-0' : 'h-64'}>
        {viewMode === 'diff' ? (
          <div 
            ref={diffContainerRef}
            style={{ height: '100%', width: '100%' }}
          />
        ) : (
          <Editor
            height="100%"
            language="python"
            theme="vs-dark"
            value={modifiedCode}
            options={{
              readOnly: true,
              minimap: { enabled: isFullscreen },
              fontSize: isFullscreen ? 14 : 12,
              scrollBeyondLastLine: false,
              wordWrap: isFullscreen ? 'on' : 'off',
              lineNumbers: 'on',
              glyphMargin: true,
              folding: isFullscreen,
            }}
          />
        )}
      </div>

      {/* Diff Summary */}
      <div className="border-t border-gray-700 px-4 py-2 bg-gray-800 flex-shrink-0">
        <div className="text-xs text-gray-400">
          <span className="text-green-400">+{linesModified} lines changed</span>
          {linesAdded !== 0 && (
            <>
              {' • '}
              <span className={linesAdded > 0 ? 'text-green-400' : 'text-red-400'}>
                {linesAdded > 0 ? `+${linesAdded}` : linesAdded} lines total
              </span>
            </>
          )}
          {' • '}
          <span className="text-gray-400">Click "Apply" to accept these changes or "Reject" to dismiss</span>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {!isFullscreen && renderDiffContent()}
      
      {/* Fullscreen Modal */}
      {isFullscreen && (
        <div className="fixed inset-0 z-50 bg-black bg-opacity-90 flex items-center justify-center p-4">
          <div className="w-full h-full max-w-7xl">
            {renderDiffContent()}
          </div>
        </div>
      )}
    </>
  );
};