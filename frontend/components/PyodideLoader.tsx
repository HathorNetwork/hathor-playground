'use client';

import React, { useState, useEffect } from 'react';
import { Loader2, Check, AlertCircle } from 'lucide-react';
import { pyodideRunner } from '@/lib/pyodide-runner';

// When running Playwright tests we don't need the heavy Pyodide
// initialization. The NEXT_PUBLIC_PYODIDE_MOCK flag skips all network
// requests and immediately reports that the environment is ready.
const MOCK_PYODIDE = process.env.NEXT_PUBLIC_PYODIDE_MOCK === 'true';

interface PyodideLoaderProps {
  onReady?: () => void;
}

export const PyodideLoader: React.FC<PyodideLoaderProps> = ({ onReady }) => {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('Initializing Python environment...');

  useEffect(() => {
    const initializePyodide = async () => {
      try {
        setStatus('🐍 Loading Pyodide...');
        await pyodideRunner.initialize();

        setStatus('✅ Python environment ready!');
        setIsLoading(false);

        if (onReady) {
          onReady();
        }
      } catch (err) {
        console.error('Failed to initialize Pyodide:', err);
        setError(String(err));
        setIsLoading(false);
      }
    };

    if (MOCK_PYODIDE) {
      // Skip initialization entirely in mock mode
      setIsLoading(false);
      setStatus('✅ Python environment ready!');
      onReady?.();
      return;
    }

    // Check if already initialized
    if (pyodideRunner.isReady()) {
      setIsLoading(false);
      setStatus('✅ Python environment ready!');
      if (onReady) {
        onReady();
      }
    } else {
      initializePyodide();
    }
  }, [onReady]);

  if (MOCK_PYODIDE) {
    return null;
  }

  if (!isLoading && !error) {
    return null; // Hide when ready
  }

  return (
    <div className="fixed inset-0 z-50 bg-black bg-opacity-70 flex items-center justify-center">
      <div className="bg-gray-800 border border-gray-600 rounded-lg p-6 max-w-md w-full mx-4">
        <div className="flex items-center gap-3 mb-4">
          {error ? (
            <AlertCircle className="text-red-400" size={24} />
          ) : isLoading ? (
            <Loader2 className="text-blue-400 animate-spin" size={24} />
          ) : (
            <Check className="text-green-400" size={24} />
          )}
          <h3 className="text-lg font-semibold text-white">
            {error ? 'Initialization Failed' : 'Setting up Python Environment'}
          </h3>
        </div>
        
        {error ? (
          <div>
            <p className="text-red-300 text-sm mb-3">
              Failed to initialize the Python execution environment.
            </p>
            <details className="text-xs text-gray-400">
              <summary className="cursor-pointer mb-2">Show error details</summary>
              <pre className="bg-gray-900 p-2 rounded text-red-300 overflow-auto">
                {error}
              </pre>
            </details>
            <button
              onClick={() => window.location.reload()}
              className="w-full mt-3 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
            >
              Retry
            </button>
          </div>
        ) : (
          <div>
            <p className="text-gray-300 text-sm mb-4">
              {status}
            </p>
            <div className="w-full bg-gray-700 rounded-full h-2">
              <div 
                className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                style={{ width: isLoading ? '70%' : '100%' }}
              />
            </div>
            <p className="text-xs text-gray-400 mt-2">
              {isLoading ? 'This may take a few seconds on first load...' : 'Ready!'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};