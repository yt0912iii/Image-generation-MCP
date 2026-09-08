import React, { useState } from 'react';
import { X, Settings, Server, Cpu, Brain } from 'lucide-react';

interface SettingsModalProps {
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ onClose }) => {
  const [comfyHost, setComfyHost] = useState('http://127.0.0.1:8188');
  const [geminiModel, setGeminiModel] = useState('gemini-3.6-flash');
  const [gpuMemoryMode, setGpuMemoryMode] = useState('gpu_high');
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      onClose();
    }, 1000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-zinc-950/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-lg w-full p-5 shadow-2xl flex flex-col gap-4">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-zinc-300" />
            <h3 className="text-sm font-bold text-zinc-100 font-mono">
              系統與 ComfyUI 連線設定 (System Settings)
            </h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-full text-zinc-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Options Form */}
        <div className="space-y-4 text-xs font-mono">
          {/* ComfyUI Host */}
          <div>
            <label className="block text-zinc-300 font-bold mb-1 flex items-center gap-1.5">
              <Server className="w-3.5 h-3.5 text-zinc-400" />
              ComfyUI Server API Endpoint
            </label>
            <input
              type="text"
              value={comfyHost}
              onChange={(e) => setComfyHost(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-zinc-100 focus:border-zinc-700 focus:outline-none"
            />
            <p className="text-[10px] text-zinc-500 mt-1">
              可連線至本地 127.0.0.1:8188 或遠端 GPU 實例。
            </p>
          </div>

          {/* Gemini LLM Agent Model */}
          <div>
            <label className="block text-zinc-300 font-bold mb-1 flex items-center gap-1.5">
              <Brain className="w-3.5 h-3.5 text-zinc-400" />
              Agent LLM 大腦模型
            </label>
            <select
              value={geminiModel}
              onChange={(e) => setGeminiModel(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-zinc-100 focus:border-zinc-700 focus:outline-none"
            >
              <option value="gemini-3.6-flash">Gemini 3.6 Flash (極速意圖解析)</option>
              <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro (深度推理與 complex json)</option>
            </select>
          </div>

          {/* GPU VRAM Allocation */}
          <div>
            <label className="block text-zinc-300 font-bold mb-1 flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-zinc-400" />
              GPU 顯存優化模式 (VRAM Allocation)
            </label>
            <select
              value={gpuMemoryMode}
              onChange={(e) => setGpuMemoryMode(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-zinc-100 focus:border-zinc-700 focus:outline-none"
            >
              <option value="gpu_high">High VRAM Mode (預先載入 Flux & SDXL 快取)</option>
              <option value="gpu_normal">Normal VRAM Mode (動態釋放 KSampler 模型)</option>
              <option value="gpu_low">Low VRAM Mode (--lowvram CPU 卸載)</option>
            </select>
          </div>
        </div>

        {/* Footer */}
        <div className="pt-3 border-t border-zinc-800 flex items-center justify-between">
          <span className="text-[10px] text-emerald-400 font-mono">
            {saved ? '✓ 設定已儲存！' : ''}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 text-xs hover:bg-zinc-700"
            >
              取消
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-2 rounded-xl bg-zinc-100 hover:bg-white text-zinc-950 font-bold text-xs shadow-sm"
            >
              儲存設定
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

