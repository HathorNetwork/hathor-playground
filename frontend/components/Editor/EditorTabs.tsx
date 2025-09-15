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
        <div className="flex bg-gray-800">
          {openFileIds.map((fileId) => {
            const file = files.find((f) => f.id === fileId);
            if (!file) return null;

            return (
              <SortableTab key={file.id} id={file.id}>
                <div
                  onClick={() => setActiveFile(file.id)}
                  className={clsx(
                    'flex items-center gap-2 px-3 py-1 border-r border-gray-700 cursor-pointer',
                    {
                      'bg-gray-900 text-white': activeFileId === file.id,
                      'bg-gray-800 text-gray-400 hover:bg-gray-700': activeFileId !== file.id,
                    }
                  )}
                >
                  <span className="text-sm">{file.name}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      closeFile(file.id);
                    }}
                    className="p-1 rounded-full hover:bg-gray-600"
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
