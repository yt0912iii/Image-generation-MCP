import React from 'react';
import { ChevronRight, ChevronLeft, ListOrdered, Loader2, Clock, Trash2, CheckCircle2, AlertCircle, X } from 'lucide-react';
import { GenerationTask } from '../types';

export interface QueueTaskItem extends GenerationTask {
  queueIndex?: number;
  promptId?: string;
}

interface TaskQueueDrawerProps {
  isOpen: boolean;
  onToggle: () => void;
  taskList: QueueTaskItem[];
  onCancelSpecificTask: (taskId: string, promptId?: string) => void;
  onClearAllQueue: () => void;
}

export const TaskQueueDrawer: React.FC<TaskQueueDrawerProps> = ({
  isOpen,
  onToggle,
  taskList,
  onCancelSpecificTask,
  onClearAllQueue,
}) => {
  const runningTasks = taskList.filter((t) => t.status === 'generating');
  const pendingTasks = taskList.filter((t) => t.status === 'pending' || !t.status);

  return (
    <>
      {/* 展開/收合 懸浮把手按鈕 */}
      <button
        onClick={onToggle}
        className={`fixed top-24 z-50 flex items-center gap-1.5 px-3 py-2 bg-zinc-900 border border-zinc-700 text-zinc-200 rounded-l-xl shadow-2xl transition-all duration-300 hover:bg-purple-600 hover:text-white cursor-pointer ${
          isOpen ? 'right-[360px]' : 'right-0'
        }`}
        title={isOpen ? '收起排程側邊欄' : '展開排程順序'}
      >
        {isOpen ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        <ListOrdered className="w-4 h-4" />
        <span className="text-xs font-mono font-bold">{taskList.length}</span>
      </button>

      {/* 伸縮側邊欄主體 */}
      <aside
        className={`fixed top-0 right-0 h-full w-[360px] bg-zinc-950/95 backdrop-blur-xl border-l border-zinc-800 z-40 shadow-2xl transition-transform duration-300 flex flex-col ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* 標頭 */}
        <div className="p-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/60">
          <div className="flex items-center gap-2">
            <ListOrdered className="w-4 h-4 text-purple-400" />
            <h3 className="text-sm font-bold text-zinc-100">任務排程清單</h3>
            <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400">
              共 {taskList.length} 項
            </span>
          </div>

          <div className="flex items-center gap-1">
            {taskList.length > 0 && (
              <button
                onClick={onClearAllQueue}
                className="p-1.5 text-zinc-400 hover:text-rose-400 hover:bg-zinc-800/80 rounded-lg text-xs flex items-center gap-1 transition-colors"
                title="清空所有等待中的排程"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span className="text-[11px]">清空</span>
              </button>
            )}
            <button
              onClick={onToggle}
              className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 任務排程列表 */}
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {taskList.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-zinc-500 text-xs gap-2">
              <Clock className="w-8 h-8 stroke-1 text-zinc-600" />
              <span>目前沒有執行中或等待的排程</span>
            </div>
          ) : (
            taskList.map((task, index) => {
              const isCurrent = task.status === 'generating';
              const isDone = task.status === 'completed';
              const isFailed = task.status === 'failed';

              return (
                <div
                  key={task.id}
                  className={`p-3 rounded-xl border transition-all text-xs space-y-2 relative overflow-hidden ${
                    isCurrent
                      ? 'bg-purple-950/20 border-purple-500/50 shadow-md'
                      : isDone
                      ? 'bg-zinc-900/40 border-emerald-500/30 opacity-75'
                      : isFailed
                      ? 'bg-rose-950/20 border-rose-500/30 opacity-75'
                      : 'bg-zinc-900/70 border-zinc-800'
                  }`}
                >
                  {/* 序號與工作流名稱 */}
                  <div className="flex items-center justify-between font-mono">
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                          isCurrent
                            ? 'bg-purple-600 text-white'
                            : isDone
                            ? 'bg-emerald-600 text-white'
                            : 'bg-zinc-800 text-zinc-400'
                        }`}
                      >
                        {index + 1}
                      </span>
                      <span className="font-semibold text-zinc-200 truncate max-w-[170px]">
                        {task.workflowName || task.workflowId}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {isCurrent && (
                        <span className="flex items-center gap-1 text-[11px] text-purple-400 font-semibold">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          執行中
                        </span>
                      )}
                      {!isCurrent && !isDone && !isFailed && (
                        <span className="text-[11px] text-zinc-400">等待中...</span>
                      )}
                      {isDone && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
                      {isFailed && <AlertCircle className="w-3.5 h-3.5 text-rose-400" />}

                      {/* 刪除/取消單一任務按鈕 */}
                      {!isDone && (
                        <button
                          onClick={() => onCancelSpecificTask(task.id, task.promptId)}
                          className="p-1 text-zinc-500 hover:text-rose-400 rounded-md transition-colors"
                          title="取消此排程"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* 提示詞預覽 */}
                  <p className="text-[11px] text-zinc-400 line-clamp-2 leading-relaxed">
                    {task.promptUsed}
                  </p>

                  {/* 規格標籤 */}
                  <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[10px] font-mono text-zinc-400">
                    <span className="px-1.5 py-0.5 bg-zinc-950 rounded border border-zinc-800">
                      {task.outputType === 'video' ? '🎬 影片' : '🎨 圖片'}
                    </span>
                    {task.params?.width && task.params?.height && (
                      <span className="px-1.5 py-0.5 bg-zinc-950 rounded border border-zinc-800">
                        {task.params.width}×{task.params.height}
                      </span>
                    )}
                    {task.outputType === 'video' && task.params?.videoDuration && (
                      <span className="px-1.5 py-0.5 bg-zinc-950 rounded border border-zinc-800">
                        {task.params.videoDuration}s
                      </span>
                    )}
                    <span className="ml-auto text-zinc-500">{task.timestamp}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </aside>
    </>
  );
};