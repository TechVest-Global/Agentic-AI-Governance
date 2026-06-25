import { useState } from "react";
import {
  ChevronRight,
  Download,
  FileCode,
  FileJson,
  FileText,
  Package,
  X,
} from "lucide-react";
import clsx from "clsx";
import { executionArtifacts, type ExecutionArtifact } from "@/data/executionLayerData";
import { Card, CardHeader } from "@/components/ui/Card";

const typeIcons: Record<ExecutionArtifact["type"], typeof FileJson> = {
  json: FileJson,
  yaml: FileCode,
  markdown: FileText,
  bundle: Package,
};

const typeColors: Record<ExecutionArtifact["type"], string> = {
  json: "text-blue-600 bg-blue-50 border-blue-200",
  yaml: "text-purple-600 bg-purple-50 border-purple-200",
  markdown: "text-emerald-600 bg-emerald-50 border-emerald-200",
  bundle: "text-amber-600 bg-amber-50 border-amber-200",
};

export function ArtifactDrawer() {
  const [openArtifact, setOpenArtifact] = useState<ExecutionArtifact | null>(null);

  function handleDownload(artifact: ExecutionArtifact) {
    const blob = new Blob([artifact.content], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = artifact.name;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <Card>
        <CardHeader
          title="Execution Artifacts"
          eyebrow="Click to inspect — download available"
        />
        <div className="divide-y divide-slate-50">
          {executionArtifacts.map((artifact) => {
            const Icon = typeIcons[artifact.type];
            return (
              <button
                key={artifact.id}
                onClick={() => setOpenArtifact(artifact)}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50 transition-colors"
              >
                <div className={clsx("flex h-7 w-7 items-center justify-center rounded border", typeColors[artifact.type])}>
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-mono font-medium text-slate-900 truncate">{artifact.name}</p>
                  <p className="text-[10px] text-slate-500">{artifact.layer}</p>
                </div>
                <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
              </button>
            );
          })}
        </div>
      </Card>

      {/* Modal/Drawer */}
      {openArtifact && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="relative flex h-[80vh] w-full max-w-3xl flex-col rounded-lg border border-slate-200 bg-white shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <div className="flex items-center gap-3">
                <div className={clsx("flex h-8 w-8 items-center justify-center rounded border", typeColors[openArtifact.type])}>
                  {(() => { const Icon = typeIcons[openArtifact.type]; return <Icon className="h-4 w-4" />; })()}
                </div>
                <div>
                  <p className="text-[14px] font-semibold text-slate-950 font-mono">{openArtifact.name}</p>
                  <p className="text-[11px] text-slate-500">{openArtifact.layer}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleDownload(openArtifact)}
                  className="flex items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                >
                  <Download className="h-3 w-3" /> Download
                </button>
                <button
                  onClick={() => setOpenArtifact(null)}
                  className="flex h-7 w-7 items-center justify-center rounded hover:bg-slate-100"
                >
                  <X className="h-4 w-4 text-slate-500" />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto p-5">
              <pre className="whitespace-pre-wrap font-mono text-[12px] leading-5 text-slate-800">
                {openArtifact.content}
              </pre>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
