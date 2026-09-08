import React, { useState } from 'react';
import { Loader2, Square, AlertCircle, CheckCircle2, Cpu } from 'lucide-react';
import { GenerationTask } from '../types';

interface LiveProgressProps {
  task: GenerationTask | null;
  onReRunTask?: () => void;
  onCancelTask?: () => void;
}

export const LiveProgress: React.FC<LiveProgressProps> = ({
  task,
  onCancelTask
}) => {
  const [isCancelling, setIsCancelling] = useState(false);

  if (!task) return null;

  const isGenerating = task.status === 'generating';
  const isFailed = task.status === 'failed';
  const isCompleted = task.status === 'completed';

  const handleCancel = async () => {
    if (!onCancelTask || isCancelling) return;
    setIsCancelling(true);
    try {
      await onCancelTask();
    } finally {
      setIsCancelling(false);
    }
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 shadow-xl space-y-3">
      {/* 標題列與終止按鈕 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isGenerating && <Loader2 className="w-4 h-4 text-purple-400 animate-spin" />}
          {isCompleted && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
          {isFailed && <AlertCircle className="w-4 h-4 text-rose-400" />}
          <span className="text-xs font-semibold text-zinc-200">
            {isGenerating && 'ComfyUI 正在執行排程...'}
            {isCompleted && '排程執行完成'}
            {isFailed && '排程執行中斷 / 失敗'}
          </span>
        </div>

        {/* 終止/取消排程按鈕 (僅在生成中顯示) */}
        {isGenerating && (
          <button
            onClick={handleCancel}
            disabled={isCancelling}
            className="flex items-center gap-1.5 px-3 py-1 bg-rose-600/20 hover:bg-rose-600 border border-rose-500/40 hover:border-rose-500 text-rose-300 hover:text-white rounded-lg text-xs font-medium transition-all cursor-pointer disabled:opacity-50"
          >
            <Square className="w-3 h-3 fill-current" />
            <span>{isCancelling ? '正在中斷...' : '終止排程'}</span>
          </button>
        )}
      </div>

      {/* 進度條 */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400">
          <span>進度 ({task.progress}%)</span>
          <span>{task.currentStep || 0} / {task.totalSteps || 20} Steps</span>
        </div>
        <div className="w-full h-2 bg-zinc-950 rounded-full overflow-hidden border border-zinc-800">
          <div
            className={`h-full transition-all duration-300 rounded-full ${
              isFailed ? 'bg-rose-500' : isCompleted ? 'bg-emerald-500' : 'bg-purple-500 animate-pulse'
            }`}
            style={{ width: `${task.progress}%` }}
          />
        </div>
      </div>

      {/* 當前執行節點資訊 */}
      <div className="flex items-center gap-2 text-[11px] font-mono text-zinc-400 bg-zinc-950 px-3 py-1.5 rounded-lg border border-zinc-800/80">
        <Cpu className="w-3.5 h-3.5 text-zinc-500" />
        <span className="text-zinc-500">當前節點:</span>
        <span className="text-zinc-200 truncate">{task.currentExecutingNode || '排程佇列中...'}</span>
      </div>
    </div>
  );
};