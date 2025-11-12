'use client';

import React, { useRef, useEffect } from 'react';
import Editor, { Monaco } from '@monaco-editor/react';
import { useIDEStore, File } from '@/store/ide-store';

interface CodeEditorProps {
  editorRef?: React.MutableRefObject<any>;
}

export const CodeEditor: React.FC<CodeEditorProps> = ({ editorRef: externalEditorRef }) => {
  const internalEditorRef = useRef<any>(null);
  const monacoRef = useRef<Monaco | null>(null);

  // Use external ref if provided, otherwise use internal ref
  const editorRef = externalEditorRef || internalEditorRef;

  const { files, activeFileId, updateFile } = useIDEStore();
  const activeFile = files.find((f: File) => f.id === activeFileId);

  useEffect(() => {
    if (monacoRef.current && editorRef.current) {
      // Set up Python language configuration for nano contracts
      monacoRef.current.languages.setMonarchTokensProvider('python', {
        keywords: [
          'Blueprint', 'public', 'view', 'fallback', 'Context',
          'def', 'class', 'return', 'if', 'else', 'elif', 'for', 'while',
          'import', 'from', 'as', 'try', 'except', 'raise', 'pass',
          'True', 'False', 'None', 'self', 'int', 'str', 'bool', 'float',
        ],

        tokenizer: {
          root: [
            [/@(public|view|fallback)/, 'decorator'],
            [/[a-z_$][\w$]*/, {
              cases: {
                '@keywords': 'keyword',
                '@default': 'identifier'
              }
            }],
            [/"([^"\\]|\\.)*$/, 'string.invalid'],
            [/"/, 'string', '@string'],
            [/'([^'\\]|\\.)*$/, 'string.invalid'],
            [/'/, 'string', '@stringSingle'],
            [/#.*$/, 'comment'],
          ],

          string: [
            [/[^\\"]+/, 'string'],
            [/\\./, 'string.escape'],
            [/"/, 'string', '@pop']
          ],

          stringSingle: [
            [/[^\\']+/, 'string'],
            [/\\./, 'string.escape'],
            [/'/, 'string', '@pop']
          ],
        }
      });
    }
  }, []);

  const handleEditorDidMount = (editor: any, monaco: Monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    // Configure Python language features
    monaco.languages.registerCompletionItemProvider('python', {
      provideCompletionItems: (model, position) => {
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn
        };

        const suggestions = [
          {
            label: 'Blueprint',
            kind: monaco.languages.CompletionItemKind.Class,
            insertText: 'Blueprint',
            documentation: 'Base class for nano contracts',
            range
          },
          {
            label: '@public',
            kind: monaco.languages.CompletionItemKind.Function,
            insertText: '@public\ndef ${1:method_name}(self, ctx: Context) -> None:\n    ${2:pass}',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: 'Decorator for public methods',
            range
          },
          {
            label: '@view',
            kind: monaco.languages.CompletionItemKind.Function,
            insertText: '@view\ndef ${1:method_name}(self) -> ${2:int}:\n    ${3:return 0}',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: 'Decorator for view methods',
            range
          },
          {
            label: 'Context',
            kind: monaco.languages.CompletionItemKind.Class,
            insertText: 'Context',
            documentation: 'Execution context for nano contracts',
            range
          },
        ];

        return { suggestions };
      },
    });

    // Configure TypeScript/React autocomplete for Hathor dApp development
    monaco.languages.registerCompletionItemProvider('typescript', {
      provideCompletionItems: (model, position) => {
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn
        };

        const suggestions = [
          {
            label: 'useInvokeSnap',
            kind: monaco.languages.CompletionItemKind.Function,
            insertText: 'const invokeSnap = useInvokeSnap();',
            documentation: 'Hook to invoke Hathor Snap RPC methods',
            range
          },
          {
            label: 'useRequestSnap',
            kind: monaco.languages.CompletionItemKind.Function,
            insertText: 'const requestSnap = useRequestSnap();',
            documentation: 'Hook to connect/install Hathor Snap',
            range
          },
          {
            label: 'htr_sendTransaction',
            kind: monaco.languages.CompletionItemKind.Method,
            insertText: `invokeSnap({
  method: 'htr_sendTransaction',
  params: {
    network: 'mainnet',
    outputs: [\${1}]
  }
})`,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: 'Send HTR transaction',
            range
          },
          {
            label: 'htr_getBalance',
            kind: monaco.languages.CompletionItemKind.Method,
            insertText: `invokeSnap({
  method: 'htr_getBalance',
  params: {
    network: 'mainnet',
    tokens: ['00']
  }
})`,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: 'Get wallet balance',
            range
          },
        ];

        return { suggestions };
      },
    });

    // Same autocomplete for typescriptreact (TSX)
    monaco.languages.registerCompletionItemProvider('typescriptreact', {
      provideCompletionItems: (model, position) => {
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn
        };

        const suggestions = [
          {
            label: 'useInvokeSnap',
            kind: monaco.languages.CompletionItemKind.Function,
            insertText: 'const invokeSnap = useInvokeSnap();',
            documentation: 'Hook to invoke Hathor Snap RPC methods',
            range
          },
          {
            label: 'useRequestSnap',
            kind: monaco.languages.CompletionItemKind.Function,
            insertText: 'const requestSnap = useRequestSnap();',
            documentation: 'Hook to connect/install Hathor Snap',
            range
          },
        ];

        return { suggestions };
      },
    });
  };

  const handleChange = (value: string | undefined) => {
    if (activeFileId && value !== undefined) {
      updateFile(activeFileId, value);
    }
  };

  if (!activeFile) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-900 text-gray-400">
        <p>No file selected</p>
      </div>
    );
  }

  return (
    <div className="h-full">
      <Editor
        height="100%"
        defaultLanguage="python"
        language={activeFile.language}
        value={activeFile.content}
        onChange={handleChange}
        onMount={handleEditorDidMount}
        theme="vs-dark"
        options={{
          minimap: { enabled: false },
          fontSize: 14,
          fontFamily: 'JetBrains Mono, Fira Code, Monaco, monospace',
          fontLigatures: true,
          automaticLayout: true,
          scrollBeyondLastLine: false,
          wordWrap: 'on',
          lineNumbers: 'on',
          renderWhitespace: 'selection',
          padding: {
            top: 8,
            bottom: 64,
          },
          bracketPairColorization: {
            enabled: true,
          },
          suggest: {
            showKeywords: true,
            showSnippets: true,
          },
        }}
      />
    </div>
  );
};
