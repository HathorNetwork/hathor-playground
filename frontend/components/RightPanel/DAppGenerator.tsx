'use client';

import React, { useState } from 'react';
import { Sparkles, Loader2, FileCode, Send } from 'lucide-react';
import { useIDEStore } from '@/store/ide-store';
import { aiApi } from '@/lib/api';
import type { File } from '@/store/ide-store';

export const DAppGenerator: React.FC = () => {
  const { activeProjectId, files, addFile, addConsoleMessage } = useIDEStore();
  const [description, setDescription] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Get contract files from current project
  const contractFiles = files.filter((f) => f.type === 'contract');

  const handleGenerate = async () => {
    if (!description.trim() || !activeProjectId) return;

    setIsGenerating(true);
    setError(null);

    try {
      addConsoleMessage('info', '🤖 Generating dApp with AI...');

      // Prepare contract context for the AI
      const contractContext = contractFiles
        .map((f) => `\nContract: ${f.name}\n${f.content}`)
        .join('\n\n');

      const fullDescription = contractContext
        ? `${description}\n\nExisting Contracts:\n${contractContext}`
        : description;

      const result = await aiApi.generateDApp({
        description: fullDescription,
        project_id: activeProjectId,
      });

      if (result.success && result.files.length > 0) {
        addConsoleMessage('success', `✅ Generated ${result.files.length} files`);

        // Add all generated files to the project (this will show them in IDE)
        const newFiles: File[] = result.files.map((generatedFile) => ({
          id: `file-${Date.now()}-${Math.random()}`,
          name: generatedFile.path.split('/').pop() || 'file',
          content: generatedFile.content,
          language: (generatedFile.language as any) || 'typescript',
          path: generatedFile.path,
          type: 'component',
        }));

        newFiles.forEach((file) => {
          addFile(file);
          addConsoleMessage('info', `📄 Created ${file.path}`);
        });

        // Batch upload all files to Beam at once
        addConsoleMessage('info', '📤 Uploading all files to sandbox...');

        try {
          const { beamClient } = await import('@/lib/beam-client');
          const filesToUpload: Record<string, string> = {};

          result.files.forEach((f) => {
            filesToUpload[f.path] = f.content;
          });

          // Upload all files without auto-starting
          await beamClient.uploadFiles(activeProjectId, filesToUpload, false);
          addConsoleMessage('success', '✅ All files uploaded successfully');

          // Now explicitly start the dev server
          addConsoleMessage('info', '🚀 Starting dev server...');
          const serverResult = await beamClient.startDevServer(activeProjectId);
          addConsoleMessage('success', `✅ Dev server started: ${serverResult.url}`);
        } catch (uploadError) {
          console.error('Failed to upload/start:', uploadError);
          addConsoleMessage('error', `❌ Upload failed: ${uploadError instanceof Error ? uploadError.message : 'Unknown error'}`);
        }

        setDescription('');
      } else {
        const errorMsg = result.error || 'Failed to generate dApp';
        setError(errorMsg);
        addConsoleMessage('error', `❌ ${errorMsg}`);
      }
    } catch (error) {
      console.error('Failed to generate dApp:', error);
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      setError(errorMsg);
      addConsoleMessage('error', `❌ Generation failed: ${errorMsg}`);
    } finally {
      setIsGenerating(false);
    }
  };

  if (!activeProjectId) {
    return (
      <div className="h-full bg-gray-900 flex items-center justify-center p-8">
        <div className="text-center">
          <Sparkles size={48} className="text-purple-400 mx-auto mb-4" />
          <p className="text-gray-400">No project selected</p>
          <p className="text-gray-500 text-sm mt-2">
            Create or select a project to generate a dApp
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full bg-gray-900 flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-gray-800">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles size={20} className="text-purple-400" />
          <h3 className="text-lg font-semibold text-white">AI dApp Generator</h3>
        </div>
        <p className="text-sm text-gray-400">
          Describe your dApp and AI will generate a complete Next.js frontend
        </p>
      </div>

      {/* Contract Context */}
      {contractFiles.length > 0 && (
        <div className="p-4 bg-gray-800/50 border-b border-gray-800">
          <div className="flex items-center gap-2 mb-2">
            <FileCode size={16} className="text-blue-400" />
            <span className="text-sm font-medium text-white">
              Contracts in this project:
            </span>
          </div>
          <div className="space-y-1">
            {contractFiles.map((contract) => (
              <div
                key={contract.id}
                className="text-xs text-gray-400 pl-4"
              >
                • {contract.name}
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-500 mt-2">
            The AI will generate a dApp that can interact with these contracts
          </p>
        </div>
      )}

      {/* Input Area */}
      <div className="flex-1 flex flex-col p-4 overflow-hidden">
        <label className="text-sm font-medium text-gray-300 mb-2">
          Describe your dApp:
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Example: Create a dashboard that displays the contract state and allows users to call the increment method with a nice UI. Include wallet connection and transaction history."
          className="flex-1 w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded focus:outline-none focus:border-purple-500 text-white text-sm resize-none"
          disabled={isGenerating}
        />

        {error && (
          <div className="mt-3 p-3 bg-red-900/20 border border-red-700 rounded text-red-400 text-sm">
            {error}
          </div>
        )}

        <button
          onClick={handleGenerate}
          disabled={!description.trim() || isGenerating}
          className="mt-4 w-full px-4 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 font-medium"
        >
          {isGenerating ? (
            <>
              <Loader2 size={20} className="animate-spin" />
              <span>Generating dApp...</span>
            </>
          ) : (
            <>
              <Send size={20} />
              <span>Generate dApp</span>
            </>
          )}
        </button>

        {/* Tips */}
        {!isGenerating && (
          <div className="mt-4 p-3 bg-gray-800/50 rounded border border-gray-700">
            <p className="text-xs font-medium text-gray-400 mb-2">
              💡 Tips for better results:
            </p>
            <ul className="text-xs text-gray-500 space-y-1">
              <li>• Be specific about the UI/UX you want</li>
              <li>• Mention which contract methods to expose</li>
              <li>• Describe the user flow and interactions</li>
              <li>• Specify any special styling or features</li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};
