"use client";

import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { ToolUIPart } from "ai";
import {
  CheckCircleIcon,
  ChevronDownIcon,
  CircleIcon,
  ClockIcon,
  WrenchIcon,
  XCircleIcon,
} from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { isValidElement } from "react";
import { CodeBlock } from "./code-block";

export type ToolProps = ComponentProps<typeof Collapsible>;

export const Tool = ({ className, ...props }: ToolProps) => (
  <Collapsible
    className={cn("not-prose mb-4 w-full rounded-lg border border-gray-700 bg-gray-800/50", className)}
    {...props}
  />
);

export type ToolHeaderProps = {
  title?: string;
  type: ToolUIPart["type"];
  state: ToolUIPart["state"];
  className?: string;
};

const getStatusBadge = (status: ToolUIPart["state"]) => {
  const labels: Record<ToolUIPart["state"], string> = {
    "input-streaming": "Pending",
    "input-available": "Running",
    "approval-requested": "Awaiting Approval",
    "approval-responded": "Responded",
    "output-available": "Completed",
    "output-error": "Error",
    "output-denied": "Denied",
  };

  const icons: Record<ToolUIPart["state"], ReactNode> = {
    "input-streaming": <CircleIcon className="size-4" />,
    "input-available": <ClockIcon className="size-4 animate-pulse" />,
    "approval-requested": <ClockIcon className="size-4 text-yellow-600" />,
    "approval-responded": <CheckCircleIcon className="size-4 text-blue-600" />,
    "output-available": <CheckCircleIcon className="size-4 text-green-600" />,
    "output-error": <XCircleIcon className="size-4 text-red-600" />,
    "output-denied": <XCircleIcon className="size-4 text-orange-600" />,
  };

  return (
    <Badge className="gap-1.5 rounded-full text-xs" variant="secondary">
      {icons[status]}
      {labels[status]}
    </Badge>
  );
};

export const ToolHeader = ({
  className,
  title,
  type,
  state,
  ...props
}: ToolHeaderProps) => (
  <CollapsibleTrigger
    className={cn(
      "flex w-full items-center justify-between gap-4 p-3 hover:bg-gray-700/30 transition-colors",
      className
    )}
    {...props}
  >
    <div className="flex items-center gap-2">
      <WrenchIcon className="size-4 text-blue-400" />
      <span className="font-medium text-sm text-gray-200">
        {title ?? type.split("-").slice(1).join("-")}
      </span>
      {getStatusBadge(state)}
    </div>
    <ChevronDownIcon className="size-4 text-gray-400 transition-transform data-[state=open]:rotate-180" />
  </CollapsibleTrigger>
);

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <CollapsibleContent
    className={cn(
      "data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 text-popover-foreground outline-none data-[state=closed]:animate-out data-[state=open]:animate-in",
      className
    )}
    {...props}
  />
);

export type ToolInputProps = ComponentProps<"div"> & {
  input: ToolUIPart["input"];
};

export const ToolInput = ({ className, input, ...props }: ToolInputProps) => (
  <div className={cn("space-y-2 overflow-hidden p-4 border-t border-gray-700/50", className)} {...props}>
    <h4 className="font-medium text-gray-400 text-xs uppercase tracking-wide">
      Parameters
    </h4>
    <div className="rounded-md bg-gray-900/50 border border-gray-700/30">
      <CodeBlock code={JSON.stringify(input, null, 2)} language="json" />
    </div>
  </div>
);

export type ToolOutputProps = ComponentProps<"div"> & {
  output: ToolUIPart["output"];
  errorText: ToolUIPart["errorText"];
};

export const ToolOutput = ({
  className,
  output,
  errorText,
  ...props
}: ToolOutputProps) => {
  if (!(output || errorText)) {
    return null;
  }

  // Helper to render pre-formatted text (respects newlines, enables horizontal scroll)
  const renderPreformattedText = (text: string) => (
    <pre className="whitespace-pre font-mono text-xs p-3 overflow-x-auto">
      {text}
    </pre>
  );

  let Output: ReactNode = <div>{output as ReactNode}</div>;
  let showJsonStructure = false;

  if (typeof output === "object" && !isValidElement(output)) {
    const outputObj = output as any;

    // Strategy 1: Extract 'output' field if present (common pattern)
    if (outputObj.output && typeof outputObj.output === "string") {
      Output = renderPreformattedText(outputObj.output);

      // Show JSON structure indicator if there are other fields
      const otherFields = Object.keys(outputObj).filter(k => k !== 'output');
      showJsonStructure = otherFields.length > 0;
    }
    // Strategy 2: Handle success/error structure
    else if ('success' in outputObj) {
      if (outputObj.success === false && outputObj.message) {
        // Error case
        Output = (
          <div className="p-3 space-y-2">
            <div className="text-red-400 font-medium">❌ {outputObj.message}</div>
            {outputObj.error && (
              <pre className="text-red-300/80 text-xs whitespace-pre mt-2 overflow-x-auto">
                {typeof outputObj.error === 'string' ? outputObj.error : JSON.stringify(outputObj.error, null, 2)}
              </pre>
            )}
          </div>
        );
      } else if (outputObj.data) {
        // Success with data
        Output = (
          <div className="p-3 space-y-2">
            {outputObj.message && (
              <div className="text-green-400 font-medium mb-2">✅ {outputObj.message}</div>
            )}
            {typeof outputObj.data === 'string' ? (
              renderPreformattedText(outputObj.data)
            ) : (
              <CodeBlock code={JSON.stringify(outputObj.data, null, 2)} language="json" />
            )}
          </div>
        );
      } else if (outputObj.message) {
        // Success with just a message
        Output = (
          <div className="p-3">
            <div className="text-green-400 font-medium">✅ {outputObj.message}</div>
          </div>
        );
      } else {
        // Fallback to JSON
        Output = <CodeBlock code={JSON.stringify(outputObj, null, 2)} language="json" />;
      }
    }
    // Strategy 3: Plain object - show as JSON
    else {
      Output = <CodeBlock code={JSON.stringify(outputObj, null, 2)} language="json" />;
    }
  } else if (typeof output === "string") {
    // Plain string output - render as preformatted text
    Output = renderPreformattedText(output);
  }

  return (
    <div className={cn("space-y-2 p-4 border-t border-gray-700/50", className)} {...props}>
      <div className="flex items-center justify-between">
        <h4 className="font-medium text-gray-400 text-xs uppercase tracking-wide">
          {errorText ? "Error" : "Result"}
        </h4>
        {showJsonStructure && (
          <span className="text-gray-500 text-xs">
            + metadata
          </span>
        )}
      </div>
      <div
        className={cn(
          "overflow-x-auto rounded-md text-xs [&_table]:w-full border",
          errorText
            ? "bg-red-950/30 border-red-800/50 text-red-300"
            : "bg-gray-900/50 border-gray-700/30 text-gray-200"
        )}
      >
        {errorText && <div className="p-3">{errorText}</div>}
        {Output}
      </div>
    </div>
  );
};
