import React from 'react';
import clsx from 'clsx';

export type PlanProgressStep = {
  id: string;
  label: string;
  status: 'pending' | 'in-progress' | 'complete';
  detail?: string;
};

interface PlanProgressProps {
  steps: PlanProgressStep[];
}

export const PlanProgress: React.FC<PlanProgressProps> = ({ steps }) => {
  if (!steps || steps.length === 0) {
    return null;
  }

  return (
    <div className="border-b border-gray-800 bg-gray-900/60 px-4 py-3">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-gray-500">
          <span>Agent Status</span>
          <span>Plan → Tools → Reflection</span>
        </div>
        <div className="flex flex-wrap gap-4">
          {steps.map((step, index) => (
            <div key={step.id} className="flex items-start gap-2 min-w-[140px]">
              <span
                className={clsx(
                  'mt-0.5 inline-flex h-3 w-3 rounded-full border',
                  step.status === 'complete' && 'bg-green-500/80 border-green-400 shadow-[0_0_10px_rgba(34,197,94,0.4)]',
                  step.status === 'in-progress' && 'bg-yellow-500/80 border-yellow-400 shadow-[0_0_10px_rgba(250,204,21,0.4)] animate-pulse',
                  step.status === 'pending' && 'bg-gray-700 border-gray-600',
                )}
                aria-label={`${step.label} is ${step.status}`}
              />
              <div>
                <p className="text-xs font-medium text-gray-200">{step.label}</p>
                {step.detail && <p className="text-[11px] text-gray-500">{step.detail}</p>}
              </div>
              {index < steps.length - 1 && <div className="mx-1 hidden h-px flex-1 self-center bg-gradient-to-r from-gray-700 to-transparent md:block" />}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

