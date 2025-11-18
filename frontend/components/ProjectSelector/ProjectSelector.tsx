'use client';

import React, { useState } from 'react';
import { ChevronDown, Plus, FolderPlus } from 'lucide-react';
import { useIDEStore } from '@/store/ide-store';
import { clsx } from 'clsx';

export const ProjectSelector: React.FC = () => {
  const { projects, activeProjectId, setActiveProject, createProject } = useIDEStore();
  const [isOpen, setIsOpen] = useState(false);
  const [showNewProjectInput, setShowNewProjectInput] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');

  const activeProject = projects.find((p) => p.id === activeProjectId);

  const handleSelectProject = (id: string) => {
    setActiveProject(id);
    setIsOpen(false);
  };

  const handleCreateProject = () => {
    if (newProjectName.trim()) {
      createProject(newProjectName.trim());
      setNewProjectName('');
      setShowNewProjectInput(false);
      setIsOpen(false);
    }
  };

  return (
    <div className="relative">
      {/* Selector Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between w-full px-4 py-2 bg-gray-800 hover:bg-gray-700 transition-colors rounded-lg border border-gray-700"
      >
        <div className="flex items-center gap-2">
          <FolderPlus size={18} className="text-blue-400" />
          <div className="text-left">
            <div className="text-sm font-medium text-white">
              {activeProject?.name || 'No Project'}
            </div>
            {activeProject?.description && (
              <div className="text-xs text-gray-400">{activeProject.description}</div>
            )}
          </div>
        </div>
        <ChevronDown
          size={16}
          className={clsx('text-gray-400 transition-transform', isOpen && 'rotate-180')}
        />
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-gray-800 border border-gray-700 rounded-lg shadow-lg z-50 max-h-96 overflow-y-auto">
          {/* Project List */}
          <div className="py-1">
            {projects.map((project) => (
              <button
                key={project.id}
                onClick={() => handleSelectProject(project.id)}
                className={clsx(
                  'w-full px-4 py-2 text-left hover:bg-gray-700 transition-colors',
                  project.id === activeProjectId && 'bg-blue-600 hover:bg-blue-700'
                )}
              >
                <div className="text-sm font-medium text-white">{project.name}</div>
                {project.description && (
                  <div className="text-xs text-gray-400 mt-0.5">{project.description}</div>
                )}
                <div className="text-xs text-gray-500 mt-1">
                  {project.files.length} files
                </div>
              </button>
            ))}
          </div>

          {/* Divider */}
          <div className="border-t border-gray-700" />

          {/* New Project Section */}
          <div className="p-2">
            {showNewProjectInput ? (
              <div className="space-y-2">
                <input
                  type="text"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateProject();
                    if (e.key === 'Escape') {
                      setShowNewProjectInput(false);
                      setNewProjectName('');
                    }
                  }}
                  onBlur={handleCreateProject}
                  placeholder="Project name..."
                  className="w-full px-3 py-2 text-sm bg-gray-900 border border-gray-700 rounded focus:outline-none focus:border-blue-500 text-white"
                  autoFocus
                />
              </div>
            ) : (
              <button
                onClick={() => setShowNewProjectInput(true)}
                className="flex items-center gap-2 w-full px-3 py-2 text-sm text-blue-400 hover:bg-gray-700 rounded transition-colors"
              >
                <Plus size={16} />
                <span>New Project</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
