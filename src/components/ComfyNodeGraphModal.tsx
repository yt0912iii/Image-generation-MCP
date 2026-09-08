import React from 'react';
import { X, Code2, Copy, Check, Database } from 'lucide-react';
import { ComfyWorkflow } from '../types';

interface ComfyNodeGraphModalProps {
  workflow: ComfyWorkflow | null;
  onClose: () => void;
}

export const ComfyNodeGraphModal: React.FC<ComfyNodeGraphModalProps> = ({
  workflow,
  onClose
}) => {
  const [copied, setCopied] = React.useState(false);

  if (!workflow) return null;

  const jsonString = JSON.stringify(workflow.jsonNodes, null, 2);

  const handleCopy = () => {
    navigator.clipboard.writeText(jsonString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-zinc-950/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-3xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-4 bg-zinc-950 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Code2 className="w-5 h-5 text-zinc-300" />
            <div>
              <h3 className="text-sm font-bold text-zinc-100 font-mono">
                ComfyUI Node Graph Viewer ({workflow.name})
              </h3>
              <p className="text-[11px] text-zinc-400">
                底層 JSON 節點連線圖結構與參數注入
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-full bg-zinc-800 text-zinc-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-4 flex-1 overflow-y-auto space-y-4 text-xs font-mono">
          {/* Metadata Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="bg-zinc-950 p-2.5 rounded-xl border border-zinc-800">
              <span className="text-zinc-500 text-[10px]">WORKFLOW ID</span>
              <div className="text-zinc-200 font-bold truncate">{workflow.id}</div>
            </div>
            <div className="bg-zinc-950 p-2.5 rounded-xl border border-zinc-800">
              <span className="text-zinc-500 text-[10px]">TOTAL NODES</span>
              <div className="text-zinc-200 font-bold">{workflow.nodeCount} Nodes</div>
            </div>
            <div className="bg-zinc-950 p-2.5 rounded-xl border border-zinc-800">
              <span className="text-zinc-500 text-[10px]">CHECKPOINT</span>
              <div className="text-emerald-400 font-bold truncate">{workflow.baseModel}</div>
            </div>
            <div className="bg-zinc-950 p-2.5 rounded-xl border border-zinc-800">
              <span className="text-zinc-500 text-[10px]">CATEGORY</span>
              <div className="text-zinc-300 font-bold uppercase">{workflow.category}</div>
            </div>
          </div>

          {/* JSON Tree Editor Viewer */}
          <div className="relative">
            <div className="flex items-center justify-between pb-2 text-zinc-400">
              <span className="flex items-center gap-1 text-[11px] font-bold text-zinc-300">
                <Database className="w-3.5 h-3.5" /> API Prompt JSON Format
              </span>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-200"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? '已複製' : '複製 API JSON'}</span>
              </button>
            </div>

            <pre className="p-4 bg-zinc-950 rounded-xl border border-zinc-800 text-zinc-300 overflow-x-auto max-h-[350px] leading-relaxed text-[11px]">
              {jsonString}
            </pre>
          </div>
        </div>

        {/* Footer */}
        <div className="p-3 bg-zinc-950 border-t border-zinc-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-zinc-100 hover:bg-white text-zinc-950 font-bold text-xs"
          >
            關閉視窗
          </button>
        </div>
      </div>
    </div>
  );
};

