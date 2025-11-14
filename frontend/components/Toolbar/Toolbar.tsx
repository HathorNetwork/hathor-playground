'use client';

import React from 'react';
import { FileCode, Terminal } from 'lucide-react';
import packageJson from '../../package.json';

const hathorCoreReference = packageJson['hathor-core-reference'];

interface ToolbarProps {
  fileName?: string;
}

export const Toolbar: React.FC<ToolbarProps> = ({
  fileName,
}) => {
  return (
    <div
      className="px-6 py-3.5"
      style={{
        background: 'var(--elegant-dark)',
        borderBottom: '1px solid var(--border-subtle)',
      }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <img
              src="/logo.png"
              alt="Hathor Playground Logo"
              className="h-8 w-8 transition-opacity hover:opacity-80 duration-200"
            />
            <span
              className="text-white font-bold font-satisfy text-[28px] tracking-wide"
              style={{
                color: 'var(--text-primary)',
              }}
            >
              Hathor Playground
            </span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Core reference badge */}
          <div
            className="px-3 py-1.5 rounded-md font-mono text-xs transition-colors duration-200"
            style={{
              background: 'var(--elegant-medium)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <Terminal size={11} className="inline mr-2 -mt-0.5 opacity-60" />
            <span className="opacity-60">hathor-core:</span>{" "}
            <a
              href={`https://github.com/HathorNetwork/hathor-core/tree/${hathorCoreReference}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium transition-colors duration-200"
              style={{ color: 'var(--accent-blue)' }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'var(--accent-teal)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--accent-blue)';
              }}
            >
              {hathorCoreReference}
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};
