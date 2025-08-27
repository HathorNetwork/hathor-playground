'use client';

import React from 'react';
import { X } from 'lucide-react';

interface PromptEditorModalProps {
  isOpen: boolean;
  prompt: string;
  isLoading: boolean;
  onChange: (value: string) => void;
  onClose: () => void;
  onCopy: () => void;
  onExport: () => void;
}

export const PromptEditorModal: React.FC<PromptEditorModalProps> = ({
  isOpen,
  prompt,
  isLoading,
  onChange,
  onClose,
  onCopy,
  onExport,
}) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded shadow-lg w-full max-w-2xl p-4">
        <div className="flex justify-between items-center mb-2">
          <h2 className="text-white text-lg font-semibold">Prompt Editor</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={20} />
          </button>
        </div>
        {isLoading ? (
          <div className="text-center text-gray-300 p-8">Generating prompt...</div>
        ) : (
          <textarea
            className="w-full h-64 p-2 bg-gray-700 text-white rounded mb-4"
            value={prompt}
            onChange={(e) => onChange(e.target.value)}
          />
        )}
        <div className="flex justify-end gap-2">
          <button
            onClick={onExport}
            className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded"
            disabled={isLoading}
          >
            Export to Lovable
          </button>
          <button
            onClick={onCopy}
            className="px-3 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded"
            disabled={isLoading}
          >
            Copy to Clipboard
          </button>
        </div>
      </div>
    </div>
  );
};

export default PromptEditorModal;
