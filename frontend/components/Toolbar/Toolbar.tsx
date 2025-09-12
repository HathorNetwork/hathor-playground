'use client';

import React from 'react';
import { FileCode } from 'lucide-react';
import packageJson from '../../package.json';

const hathorCoreReference = packageJson['hathor-core-reference'];

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
          <span className="text-gray-400 text-xs font-mono">
            hathor-core:{" "}
            <a
              href={`https://github.com/HathorNetwork/hathor-core/tree/${hathorCoreReference}`}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white transition-colors"
            >
              {hathorCoreReference}
            </a>
          </span>
        </div>
      </div>
    </div>
  );
};
