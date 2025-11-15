'use client';

import React from 'react';
import { useIDEStore } from '@/store/ide-store';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { X } from 'lucide-react';
import { clsx } from 'clsx';

const SortableTab = ({ id, children }: { id: string; children: React.ReactNode }) => {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      {children}
    </div>
  );
};

export const EditorTabs: React.FC = () => {
  const { openFileIds, activeFileId, files, closeFile, setActiveFile, reorderFiles } = useIDEStore();

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = openFileIds.indexOf(active.id as string);
      const newIndex = openFileIds.indexOf(over.id as string);
      reorderFiles(oldIndex, newIndex);
    }
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={openFileIds} strategy={() => null} >
        <div
          className="flex overflow-x-auto scrollbar-thin"
          style={{
            background: 'var(--elegant-darkest)',
            borderBottom: '1px solid var(--border-subtle)',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          {openFileIds.map((fileId) => {
            const file = files.find((f) => f.id === fileId);
            if (!file) return null;

            const isActive = activeFileId === file.id;

            return (
              <SortableTab key={file.id} id={file.id}>
                <div
                  onClick={() => setActiveFile(file.id)}
                  className={clsx(
                    'relative flex items-center gap-2.5 px-4 py-2.5 cursor-pointer transition-all duration-200 group',
                    'border-r',
                  )}
                  style={{
                    background: isActive
                      ? 'var(--elegant-medium)'
                      : 'transparent',
                    borderRightColor: 'var(--border-subtle)',
                    borderTop: isActive ? '2px solid var(--accent-blue)' : '2px solid transparent',
                    color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.background = 'var(--elegant-dark)';
                      e.currentTarget.style.color = 'var(--text-secondary)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.background = 'transparent';
                      e.currentTarget.style.color = 'var(--text-muted)';
                    }
                  }}
                >
                  <span
                    className={clsx('text-sm font-mono', {
                      'font-semibold': isActive,
                      'font-normal': !isActive,
                    })}
                  >
                    {file.name}
                  </span>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      closeFile(file.id);
                    }}
                    className="p-0.5 rounded transition-all duration-200 opacity-40 group-hover:opacity-100"
                    style={{
                      color: 'var(--text-muted)',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'var(--elegant-light)';
                      e.currentTarget.style.color = 'var(--accent-red)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
                      e.currentTarget.style.color = 'var(--text-muted)';
                    }}
                  >
                    <X size={14} />
                  </button>
                </div>
              </SortableTab>
            );
          })}
        </div>
      </SortableContext>
    </DndContext>
  );
};
