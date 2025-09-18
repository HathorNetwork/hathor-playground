'use client';

import React from 'react';
import { FileExplorer } from '../FileExplorer/FileExplorer';
import { MethodExecutor } from '../Execution/MethodExecutor';

interface LeftSidebarContentProps {
  activeTab: 'files' | 'run';
}

export const LeftSidebarContent: React.FC<LeftSidebarContentProps> = ({ activeTab }) => {
  switch (activeTab) {
    case 'files':
      return <FileExplorer />;
    case 'run':
      return <MethodExecutor />;
    default:
      return null;
  }
};