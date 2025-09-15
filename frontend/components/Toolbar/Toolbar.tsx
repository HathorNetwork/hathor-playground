'use client';

import React from 'react';
import { FileCode, Settings, HelpCircle } from 'lucide-react';

interface ToolbarProps {
  fileName?: string;
}

export const Toolbar: React.FC<ToolbarProps> = ({
  fileName,
}) => {
  return (
    <div className="bg-gray-800 border-b border-gray-700 px-4 py-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          {/* Logo */}
          <div className="flex items-center gap-2">
            <FileCode size={20} className="text-hathor-500" />
            <span className="text-white font-bold">Hathor Nano Contracts IDE</span>
          </div>

          
        </div>

        <div className="flex items-center gap-2">
          {/* Settings Button */}
          <button
            className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
            title="Settings"
          >
            <Settings size={18} />
          </button>

          {/* Help Button */}
          <button
            className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
            title="Help"
          >
            <HelpCircle size={18} />
          </button>
        </div>
      </div>
    </div>
  );
};