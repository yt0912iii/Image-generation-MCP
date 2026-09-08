import React from 'react';
import { X, Layers, Code2 } from 'lucide-react';
import { ComfyWorkflow } from '../types';
import { WORKFLOW_TEMPLATES } from '../data/workflowsAndPresets';

interface WorkflowsModalProps {
  onClose: () => void;
  onSelectWorkflow: (workflow: ComfyWorkflow) => void;
  onInspectNodes: (workflow: ComfyWorkflow) => void;
}

export const WorkflowsModal: React.FC<WorkflowsModalProps> = ({
  onClose,
  onInspectNodes
}) => {
  return (
    <div className="fixed inset-0 z-50 bg-zinc-950/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-4xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header (註解保留，如有需要可取消註解) */}
        {/* <div className="p-4 bg-zinc-950 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-zinc-400" />
            <div>
              <h3 className="text-sm font-bold text-zinc-100 font-mono">
                ComfyUI 自動化工作流庫 (Workflow Registry)
              </h3>
              <p className="text-[11px] text-zinc-400">
                預先掛載之模型範本與動態參數調度庫
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-full text-zinc-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div> */}

        {/* Workflow List */}
        <div className="p-4 flex-1 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-4">
          {WORKFLOW_TEMPLATES.map((wf) => (
            <div
              key={wf.id}
              className="bg-zinc-950 rounded-xl p-4 border border-zinc-800 hover:border-zinc-700 transition-all flex flex-col justify-between gap-3 shadow-sm group"
            >
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-900 text-zinc-300 border border-zinc-800">
                    {wf.category.toUpperCase()}
                  </span>
                  <span className="text-[10px] text-zinc-500 font-mono">{wf.nodeCount} Nodes</span>
                </div>

                <h4 className="text-sm font-bold text-zinc-100 group-hover:text-emerald-400 transition-colors">
                  {wf.name}
                </h4>

                <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                  {wf.description}
                </p>

                {/* Tags */}
                <div className="flex flex-wrap gap-1 mt-2">
                  {wf.tags.map((tag, i) => (
                    <span
                      key={i}
                      className="text-[10px] px-2 py-0.5 rounded bg-zinc-900 text-zinc-400 border border-zinc-800"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              </div>

              {/* 底部操作欄（已移除「調用工作流」按鈕） */}
              <div className="pt-3 border-t border-zinc-800 flex items-center justify-between text-xs font-mono">
                <button
                  onClick={() => onInspectNodes(wf)}
                  className="flex items-center gap-1 text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
                >
                  <Code2 className="w-3.5 h-3.5" /> 檢視 JSON
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="p-3 bg-zinc-950 border-t border-zinc-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 text-xs hover:bg-zinc-700 cursor-pointer"
          >
            關閉
          </button>
        </div>
      </div>
    </div>
  );
};