import React from 'react';
import { GenerationTask } from '../types';

interface AgentDecisionCardProps {
  currentTask: GenerationTask | null;
  onOpenNodeGraphModal: () => void;
}

export const AgentDecisionCard: React.FC<AgentDecisionCardProps> = ({
  currentTask,
  onOpenNodeGraphModal,
}) => {
  if (!currentTask) {
    return (
      <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-4 text-zinc-500 text-xs">
        🤖 Agent 待命模式中，請在左側輸入需求發起任務...
      </div>
    );
  }

  const { params } = currentTask;

  return (
    <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
        <div className="flex items-center gap-2">
          <span className="text-purple-400">🧠</span>
          <h3 className="text-sm font-semibold text-zinc-200">ComfyUI 調度參數</h3>
        </div>
        <span className="text-xs px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30 font-mono">
          {currentTask.workflowId}
        </span>
      </div>

      {/* 🎯 參數顯示網格區域 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-zinc-950 p-2.5 rounded-lg border border-zinc-800/80 text-xs font-mono">
        <div>
          <span className="text-zinc-500 block text-[10px]">畫面解析度 (Size)</span>
          <span className="text-zinc-200 font-medium">
            {params?.width && params?.height ? `${params.width} × ${params.height}` : '自適應預設'}
          </span>
        </div>
        <div>
          <span className="text-zinc-500 block text-[10px]">隨機種子 (Seed)</span>
          <span className="text-zinc-200 font-medium truncate block" title={String(params?.seed)}>
            {params?.seed ?? -1}
          </span>
        </div>
        <div>
          <span className="text-zinc-500 block text-[10px]">輸出媒體類型</span>
          <span className="text-purple-300 font-medium">
            {currentTask.outputType === 'video' ? '🎬 動態影片' : '🖼️ 靜態圖像'}
          </span>
        </div>
        <div>
          <span className="text-zinc-500 block text-[10px]">參考圖片狀態</span>
          <span className="text-zinc-200 font-medium">
            {params?.inputImage ? '✅ 已掛載圖片' : '❌ 無參考圖'}
          </span>
        </div>
      </div>

      {/* 正向提示詞 */}
      <div className="text-xs bg-zinc-950 p-2.5 rounded-lg border border-zinc-800">
        <span className="text-purple-400 font-medium block mb-1">✨ 核心正向提示詞 (Positive Prompt):</span>
        <p className="text-zinc-300 font-mono break-all leading-relaxed">
          {currentTask.promptUsed}
        </p>
      </div>

      {/* 負向提示詞 (如有) */}
      {currentTask.negativePromptUsed && (
        <div className="text-xs bg-zinc-950 p-2.5 rounded-lg border border-zinc-800">
          <span className="text-red-400 font-medium block mb-1">🚫 負向提示詞 (Negative Prompt):</span>
          <p className="text-zinc-400 font-mono break-all leading-relaxed">
            {currentTask.negativePromptUsed}
          </p>
        </div>
      )}
    </div>
  );
};