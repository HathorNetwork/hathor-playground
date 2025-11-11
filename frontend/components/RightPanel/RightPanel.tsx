'use client';

import React, { useState } from 'react';
import { Monitor, Sparkles } from 'lucide-react';
import { PreviewPanel } from '../Preview/PreviewPanel';
import { AgenticChat } from './AgenticChat';
import { AgenticChatStreaming } from './AgenticChatStreaming';
import { AgenticChatUnified } from './AgenticChatUnified';

// Feature flags
const USE_STREAMING = true;
const USE_UNIFIED = true; // New: Use unified architecture (Blueprint + dApp)
import { clsx } from 'clsx';

type TabType = 'preview' | 'ai';

export const RightPanel: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabType>('preview');

  return (
    <div className="h-full bg-gray-900 flex flex-col">
      {/* Tabs */}
      <div className="flex items-center bg-gray-800 border-b border-gray-700">
        <button
          onClick={() => setActiveTab('preview')}
          className={clsx(
            'flex items-center gap-2 px-4 py-2 transition-colors border-b-2',
            activeTab === 'preview'
              ? 'border-blue-500 bg-gray-900 text-white'
              : 'border-transparent text-gray-400 hover:text-white hover:bg-gray-700'
          )}
        >
          <Monitor size={16} />
          <span className="text-sm font-medium">Preview</span>
        </button>
        <button
          onClick={() => setActiveTab('ai')}
          className={clsx(
            'flex items-center gap-2 px-4 py-2 transition-colors border-b-2',
            activeTab === 'ai'
              ? 'border-purple-500 bg-gray-900 text-white'
              : 'border-transparent text-gray-400 hover:text-white hover:bg-gray-700'
          )}
        >
          <Sparkles size={16} />
          <span className="text-sm font-medium">AI Agent</span>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {/* Keep both panels mounted to preserve state and enable hot reload */}
        <div className={clsx('h-full', activeTab === 'preview' ? 'block' : 'hidden')}>
          <PreviewPanel />
        </div>
        <div className={clsx('h-full', activeTab === 'ai' ? 'block' : 'hidden')}>
          {USE_UNIFIED ? <AgenticChatUnified /> : USE_STREAMING ? <AgenticChatStreaming /> : <AgenticChat />}
        </div>
      </div>
    </div>
  );
};
