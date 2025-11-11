'use client';

import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  FileCode, Terminal, Search, FileText, CheckCircle2,
  ChevronDown, ChevronRight, User, Bot
} from 'lucide-react';
import type { ToolCall } from '@/lib/api';

interface ChatMessageProps {
  role: 'user' | 'assistant';
  content: string;
  tool_calls?: ToolCall[];
  environment?: string;
  confidence?: number;
}

const getToolIcon = (toolName: string) => {
  switch (toolName) {
    case 'validate_blueprint':
    case 'compile_blueprint':
      return <CheckCircle2 size={14} className="text-green-400" />;
    case 'run_blueprint_tests':
    case 'list_blueprint_methods':
      return <Terminal size={14} className="text-purple-400" />;
    case 'read_file':
      return <FileText size={14} className="text-blue-400" />;
    case 'write_file':
      return <FileCode size={14} className="text-orange-400" />;
    case 'list_files':
    case 'grep':
    case 'get_project_structure':
      return <Search size={14} className="text-cyan-400" />;
    default:
      return <Terminal size={14} className="text-gray-400" />;
  }
};

const ToolCallItem: React.FC<{ toolCall: ToolCall }> = ({ toolCall }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="border border-gray-700 rounded-lg overflow-hidden bg-gray-800/50">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-3 py-2 flex items-center gap-2 hover:bg-gray-700/50 transition-colors text-left"
      >
        {isExpanded ? (
          <ChevronDown size={14} className="text-gray-400" />
        ) : (
          <ChevronRight size={14} className="text-gray-400" />
        )}
        {getToolIcon(toolCall.tool)}
        <span className="text-sm font-mono text-gray-300">{toolCall.tool}</span>
        {Object.keys(toolCall.args).length > 0 && (
          <span className="text-xs text-gray-500">
            ({Object.keys(toolCall.args).length} args)
          </span>
        )}
      </button>

      {isExpanded && (
        <div className="border-t border-gray-700 bg-gray-900/50">
          {Object.keys(toolCall.args).length > 0 && (
            <div className="px-3 py-2">
              <div className="text-xs text-gray-500 mb-1">Arguments:</div>
              <pre className="text-xs text-gray-300 font-mono bg-black/30 p-2 rounded overflow-x-auto">
                {JSON.stringify(toolCall.args, null, 2)}
              </pre>
            </div>
          )}

          {toolCall.result && (
            <div className="px-3 py-2 border-t border-gray-700">
              <div className="text-xs text-gray-500 mb-1">Result:</div>
              <pre className="text-xs text-gray-300 font-mono bg-black/30 p-2 rounded overflow-x-auto max-h-40 overflow-y-auto">
                {toolCall.result}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const ChatMessage: React.FC<ChatMessageProps> = ({
  role,
  content,
  tool_calls,
  environment,
  confidence,
}) => {
  // Debug: log the raw content to see formatting
  if (role === 'assistant' && content.includes('`')) {
    console.log('Raw markdown content:', content);
  }

  return (
    <div className={`flex gap-3 ${role === 'user' ? 'justify-end' : 'justify-start'}`}>
      {role === 'assistant' && (
        <div className="flex-shrink-0 w-9 h-9 rounded-full bg-gradient-to-br from-purple-600/20 to-purple-500/10 border border-purple-500/20 flex items-center justify-center backdrop-blur-sm">
          <Bot size={18} className="text-purple-400" />
        </div>
      )}

      <div className={`max-w-[75%] ${role === 'user' ? 'order-first' : ''}`}>
        {/* Environment badge for assistant */}
        {role === 'assistant' && environment && (
          <div className="mb-2 flex items-center gap-2 text-xs text-gray-400">
            <span className="px-2 py-1 rounded-md bg-gray-800/50 border border-gray-700/50 backdrop-blur-sm">
              {environment}
            </span>
            {confidence && (
              <span className="text-gray-500">
                {Math.round(confidence * 100)}% confident
              </span>
            )}
          </div>
        )}

        {/* Main message content */}
        <div
          className={`rounded-2xl px-4 py-3 shadow-lg ${
            role === 'user'
              ? 'bg-gradient-to-br from-blue-600 to-blue-700 text-white shadow-blue-500/20'
              : 'bg-gray-800/50 text-gray-100 border border-gray-700/50 backdrop-blur-sm shadow-gray-900/50'
          }`}
        >
          <div className="prose-sm max-w-none text-sm leading-relaxed">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              skipHtml={false}
              components={{
                code: ({ node, inline, className, children, ...props }: any) => {
                  // Treat as inline unless explicitly in a pre/block context
                  const isInline = inline !== false;

                  if (isInline) {
                    return (
                      <code className="inline-code bg-yellow-500/10 text-yellow-300 px-1 py-0.5 rounded text-xs font-mono" {...props}>
                        {children}
                      </code>
                    );
                  }
                  return (
                    <pre className="bg-black/30 p-3 rounded overflow-x-auto my-2 block">
                      <code className={`${className} block`} {...props}>
                        {children}
                      </code>
                    </pre>
                  );
                },
                p: ({ children }) => <p className="mb-1 last:mb-0 leading-relaxed">{children}</p>,
                ul: ({ children }) => <ul className="list-disc list-inside my-2 space-y-1">{children}</ul>,
                ol: ({ children }) => <ol className="list-decimal list-inside my-2 space-y-1">{children}</ol>,
                li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                a: ({ href, children }) => (
                  <a href={href} className="text-blue-400 hover:underline" target="_blank" rel="noopener noreferrer">
                    {children}
                  </a>
                ),
                strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
                em: ({ children }) => <em className="italic">{children}</em>,
              }}
            >
              {content}
            </ReactMarkdown>
          </div>
        </div>

        {/* Tool calls */}
        {tool_calls && tool_calls.length > 0 && (
          <div className="mt-3 space-y-2">
            <div className="text-xs text-gray-500 mb-1">
              Tool Calls ({tool_calls.length}):
            </div>
            {tool_calls.map((toolCall, index) => (
              <ToolCallItem key={index} toolCall={toolCall} />
            ))}
          </div>
        )}
      </div>

      {role === 'user' && (
        <div className="flex-shrink-0 w-9 h-9 rounded-full bg-gradient-to-br from-blue-600/20 to-blue-500/10 border border-blue-500/20 flex items-center justify-center backdrop-blur-sm">
          <User size={18} className="text-blue-400" />
        </div>
      )}
    </div>
  );
};
