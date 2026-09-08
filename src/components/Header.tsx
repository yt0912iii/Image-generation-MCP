import React from 'react';
import { Cpu, Activity, Server, Settings, Sparkles, Layers, RefreshCw } from 'lucide-react';
import { GpuStatus } from '../types';

interface HeaderProps {
  gpuStatus: GpuStatus;
  onOpenSettings: () => void;
  onOpenWorkflowsModal: () => void;
  onRefreshStatus: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  gpuStatus,
  onOpenSettings,
  onOpenWorkflowsModal,
  onRefreshStatus
}) => {
  return (
    <header className="bg-zinc-950 border-b border-zinc-800/80 px-4 py-3 sticky top-0 z-40 text-zinc-100 flex flex-wrap items-center justify-between gap-3 shadow-sm">
      {/* Left: App Logo & Title */}
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-200">
          <Sparkles className="w-4 h-4 text-emerald-400" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-sm sm:text-base font-bold tracking-tight text-zinc-100">
              Digital Human Workflow Agent
            </h1>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-zinc-900 text-zinc-400 border border-zinc-800">
              v2.5
            </span>
          </div>
          <p className="text-[11px] text-zinc-400 hidden sm:block">
            ComfyUI 工作流調度系統
          </p>
        </div>
      </div>

      {/* Middle: System Hardware & Connection Badges */}
      <div className="flex items-center gap-2 sm:gap-3 text-xs font-mono">
        {/* ComfyUI Server Connection (🎯 根據 gpuStatus.comfyConnected 動態顯示) */}
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800">
          <Server className="w-3.5 h-3.5 text-zinc-400" />
          <span className="text-zinc-400 hidden md:inline">ComfyUI:</span>
          {gpuStatus.comfyConnected ? (
            <span className="flex items-center gap-1.5 font-semibold text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Connected
            </span>
          ) : (
            <span className="flex items-center gap-1.5 font-semibold text-rose-400">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
              Disconnected
            </span>
          )}
        </div>

        {/* GPU VRAM & Load */}
        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800">
          <Cpu className="w-3.5 h-3.5 text-zinc-400" />
          <div className="flex flex-col">
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <span className="text-zinc-200 font-medium">GPU {gpuStatus.loadPercent}%</span>
              <span className="text-[10px] text-zinc-400">
                {gpuStatus.vramUsedGb}/{gpuStatus.vramTotalGb}GB
              </span>
            </div>
            {/* VRAM Progress bar */}
            <div className="w-20 h-1 bg-zinc-800 rounded-full overflow-hidden mt-0.5">
              <div
                className={`h-full transition-all duration-500 ${gpuStatus.comfyConnected ? 'bg-emerald-400' : 'bg-zinc-600'}`}
                style={{ width: `${gpuStatus.vramTotalGb > 0 ? (gpuStatus.vramUsedGb / gpuStatus.vramTotalGb) * 100 : 0}%` }}
              />
            </div>
          </div>
        </div>

        {/* Active Jobs Badge */}
        <div className="hidden xl:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800">
          <Activity className="w-3.5 h-3.5 text-zinc-400" />
          <span className="text-zinc-400">Active:</span>
          <span className="text-zinc-200 font-bold">{gpuStatus.activeJobsCount}</span>
        </div>
      </div>

      {/* Right: Actions & Settings */}
      <div className="flex items-center gap-2">
        <button
          onClick={onRefreshStatus}
          title="刷新狀態"
          className="p-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-zinc-800 transition-colors cursor-pointer"
        >
          <RefreshCw className="w-4 h-4" />
        </button>

        {/* <button
          onClick={onOpenWorkflowsModal}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-800 text-xs font-medium transition-colors"
        >
          <Layers className="w-3.5 h-3.5 text-zinc-400" />
          <span className="hidden sm:inline">工作流庫</span>
        </button> */}

        <button
          onClick={onOpenSettings}
          className="p-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-zinc-800 transition-colors cursor-pointer"
          title="系統設定"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};