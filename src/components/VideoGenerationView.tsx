import React, { useState, useRef } from 'react';

const BACKEND_URL = window.location.origin;

type VideoWorkflowType = 'ltx23_t2v' | 'ltx23_i2v';

interface VideoWorkflowConfig {
  id: VideoWorkflowType;
  name: string;
  icon: string;
  description: string;
  requiresImage: boolean;
  allowsImage: boolean;
  supportsNegative: boolean;
}

const VIDEO_WORKFLOW_CONFIGS: Record<VideoWorkflowType, VideoWorkflowConfig> = {
  ltx23_t2v: {
    id: 'ltx23_t2v',
    name: 'LTX2.3 文生影片',
    icon: '🎥',
    description: '從純文字描述直接生成高動態、具備電影質感的短影片。',
    requiresImage: false,
    allowsImage: false,
    supportsNegative: true,
  },
  ltx23_i2v: {
    id: 'ltx23_i2v',
    name: 'LTX2.3 高階圖生影',
    icon: '🌌',
    description: '結合高階物理與光影渲染，讓參考圖展現順暢自然的大幅度動作。',
    requiresImage: true,
    allowsImage: true,
    supportsNegative: true,
  },
};

const DEFAULT_NEGATIVE_PROMPT = 'blurry, jitter, distorted, low quality, static, frozen frame';

export default function VideoGenerationView({ onAvatarResponse }: { onAvatarResponse?: (resp: { text: string }) => void }) {
  const [selectedWorkflow, setSelectedWorkflow] = useState<VideoWorkflowType>('ltx23_t2v');

  // 提示詞狀態
  const [prompt, setPrompt] = useState('');
  const [optimizedPromptResult, setOptimizedPromptResult] = useState<string | null>(null);
  const [isOptimizing, setIsOptimizing] = useState(false);

  const [negativePrompt, setNegativePrompt] = useState(DEFAULT_NEGATIVE_PROMPT);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [selectedImageFilename, setSelectedImageFilename] = useState<string | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [resultVideoUrl, setResultVideoUrl] = useState<string | null>(null);
  const [executionTime, setExecutionTime] = useState<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const currentConfig = VIDEO_WORKFLOW_CONFIGS[selectedWorkflow];

  // 切換工作流並重設所有狀態
  const handleWorkflowChange = (workflowKey: VideoWorkflowType) => {
    setSelectedWorkflow(workflowKey);
    setPrompt('');
    setOptimizedPromptResult(null);
    setNegativePrompt(DEFAULT_NEGATIVE_PROMPT);
    setSelectedImage(null);
    setSelectedImageFilename(null);
    setResultVideoUrl(null);
    setExecutionTime(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // 🎬 影片專用提示詞優化 Handler
  const handleOptimizePrompt = async () => {
    if (!prompt.trim()) {
      alert('請先輸入影片動作或場景描述（如：宇航員在月球上走動），再進行優化！');
      return;
    }

    setIsOptimizing(true);
    setOptimizedPromptResult(null);

    try {
      const res = await fetch(`${BACKEND_URL}/api/generate/optimize-prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userPrompt: prompt,
          workflowId: selectedWorkflow,
          type: 'video',
        }),
      });

      if (!res.ok) throw new Error(`優化失敗 (${res.status})`);
      const data = await res.json();

      if (data.success && data.optimizedPrompt) {
        setOptimizedPromptResult(data.optimizedPrompt);
      } else {
        throw new Error(data.message || '無法取得優化結果');
      }
    } catch (err: any) {
      alert(`影片提示詞優化失敗: ${err.message}`);
    } finally {
      setIsOptimizing(false);
    }
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 10 * 1024 * 1024) {
        alert('檔案大小不能超過 10MB');
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setSelectedImage(reader.result as string);
        setSelectedImageFilename(file.name);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleGenerate = async () => {
    if (currentConfig.requiresImage && !selectedImage) {
      alert(`「${currentConfig.name}」必須上傳一張參考圖片！`);
      return;
    }

    if (!prompt.trim() && !selectedImage) {
      alert('請輸入影片動作描述或上傳圖片！');
      return;
    }

    setIsLoading(true);
    setResultVideoUrl(null);

    try {
      const finalPromptToUse = optimizedPromptResult || prompt || 'cinematic motion video, high quality, 24fps';

      const res = await fetch(`${BACKEND_URL}/api/generate/dispatch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userPrompt: finalPromptToUse,
          workflowId: selectedWorkflow,
          params: {
            seed: Math.floor(Math.random() * 999999999999),
            width: 768,
            height: 512,
            negativePrompt: negativePrompt,
            uploadedImage: selectedImage || undefined,
          },
        }),
      });

      if (!res.ok) throw new Error(`伺服器錯誤 (${res.status})`);
      const data = await res.json();

      if (data.success && data.outputUrl) {
        const fullUrl = data.outputUrl.startsWith('http') ? data.outputUrl : `${BACKEND_URL}${data.outputUrl}`;
        setResultVideoUrl(fullUrl);
        setExecutionTime(data.executionTimeMs);
        if (onAvatarResponse && data.avatarResponse?.text) {
          onAvatarResponse({ text: data.avatarResponse.text });
        }
      } else {
        throw new Error(data.message || '影片生成失敗');
      }
    } catch (err: any) {
      alert(`影片生成失敗: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-5 min-h-[680px] flex flex-col gap-5">
      {/* 工作流切換 */}
      <div className="flex flex-col gap-2">
        <label className="text-xs font-semibold text-blue-400 flex items-center gap-1.5">
          <span>🎬</span> ComfyUI 影片生成工作流：
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {(Object.keys(VIDEO_WORKFLOW_CONFIGS) as VideoWorkflowType[]).map((key) => {
            const wf = VIDEO_WORKFLOW_CONFIGS[key];
            const isSelected = selectedWorkflow === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => handleWorkflowChange(key)}
                className={`p-3 rounded-xl border text-left flex flex-col gap-1 transition-all ${
                  isSelected
                    ? 'bg-blue-600/20 border-blue-500 ring-1 ring-blue-500/50 text-white'
                    : 'bg-zinc-950/60 border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
                }`}
              >
                <div className="flex items-center gap-2 font-medium text-sm">
                  <span>{wf.icon}</span>
                  <span className={isSelected ? 'text-blue-300 font-semibold' : ''}>{wf.name}</span>
                </div>
                <span className="text-[10px] text-zinc-500 line-clamp-2 leading-relaxed">
                  {wf.description}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 主控制面板 */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 flex-1">
        {/* 左側輸入 */}
        <div className="lg:col-span-5 bg-zinc-950 border border-zinc-800 rounded-xl p-4 flex flex-col gap-4">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
            <span className="text-xs font-semibold text-zinc-300 flex items-center gap-1">
              {currentConfig.icon} {currentConfig.name} - 動態參數
            </span>
            {currentConfig.requiresImage && (
              <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                需要參考圖
              </span>
            )}
          </div>

          {/* 圖片上傳 (LTX2.3 高階圖生影) */}
          {currentConfig.allowsImage && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-zinc-400 font-medium flex items-center justify-between">
                <span>🖼️ 上傳起始首幀圖片 {currentConfig.requiresImage && <span className="text-amber-400">*</span>}</span>
                {selectedImage && (
                  <button
                    onClick={() => {
                      setSelectedImage(null);
                      setSelectedImageFilename(null);
                      if (fileInputRef.current) fileInputRef.current.value = '';
                    }}
                    className="text-[10px] text-red-400"
                  >
                    清除圖片
                  </button>
                )}
              </label>

              <input type="file" ref={fileInputRef} onChange={handleImageChange} accept="image/*" className="hidden" />

              {selectedImage ? (
                <div className="border border-blue-500/50 rounded-lg p-2 bg-zinc-900/60 flex items-center gap-3">
                  <img src={selectedImage} alt="Uploaded" className="w-14 h-14 object-cover rounded border border-zinc-700" />
                  <span className="text-xs text-zinc-200 truncate">{selectedImageFilename}</span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-zinc-800 hover:border-zinc-700 rounded-lg p-3 flex flex-col items-center gap-1"
                >
                  <span className="text-sm text-zinc-300">📤 點擊選擇參考圖片</span>
                </button>
              )}
            </div>
          )}

          {/* 🎬 正向提示詞與 AI 影片優化按鈕 */}
          <div className="flex flex-col gap-1.5 flex-1">
            <div className="flex items-center justify-between">
              <label className="text-xs text-zinc-400 font-medium">🎥 影片動作提示詞 (Prompt)</label>

              {/* 🎬 影片優化按鈕 */}
              <button
                type="button"
                onClick={handleOptimizePrompt}
                disabled={isOptimizing || !prompt.trim()}
                className="px-2.5 py-1 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded text-[11px] font-medium flex items-center gap-1 shadow transition-all disabled:opacity-50"
              >
                {isOptimizing ? '🎬 優化中...' : '🎬 影片提詞優化'}
              </button>
            </div>

            <textarea
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value);
                setOptimizedPromptResult(null);
              }}
              placeholder="例如：女孩在雨中奔跑。點擊右上角「🎬 影片提詞優化」，AI 將自動補全鏡頭運動 (Camera Pan)、動態流暢度與 24fps 電影感設定..."
              className="w-full flex-1 min-h-[90px] bg-zinc-900 border border-zinc-800 rounded-lg p-2.5 text-xs text-zinc-100 font-mono resize-none focus:outline-none focus:border-blue-500"
            />

            {/* 🎬 影片提示詞優化對比顯示 */}
            {optimizedPromptResult && (
              <div className="mt-2 p-3 bg-blue-950/40 border border-blue-500/40 rounded-lg flex flex-col gap-1.5 text-xs">
                <div className="flex items-center justify-between text-blue-300 font-semibold text-[11px]">
                  <span>🎬 AI 優化後的電影級影片 Prompt：</span>
                  <button
                    onClick={() => {
                      setPrompt(optimizedPromptResult);
                      setOptimizedPromptResult(null);
                    }}
                    className="text-blue-400 hover:text-blue-200 underline text-[10px]"
                  >
                    替換至輸入框
                  </button>
                </div>
                <p className="text-zinc-200 font-mono text-[11px] leading-relaxed break-words bg-zinc-950/80 p-2 rounded border border-zinc-800">
                  {optimizedPromptResult}
                </p>
                <span className="text-[10px] text-blue-400/80">
                  💡 系統將在生成時自動採用此注入鏡頭運動語言的英文 Prompt。
                </span>
              </div>
            )}
          </div>

          {/* 負向提示詞 */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-zinc-400 font-medium">🚫 避雷提示詞 (Negative)</label>
            <input
              type="text"
              value={negativePrompt}
              onChange={(e) => setNegativePrompt(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2.5 text-xs text-zinc-100 font-mono focus:outline-none focus:border-red-500/50"
            />
          </div>

          <button
            type="button"
            onClick={handleGenerate}
            disabled={isLoading || (currentConfig.requiresImage && !selectedImage)}
            className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-lg transition-all disabled:opacity-50"
          >
            {isLoading ? 'ComfyUI 影片渲染中 (約需 30~90 秒)...' : `🚀 開始渲染影片 (${currentConfig.name})`}
          </button>
        </div>

        {/* 右側影片播放器 */}
        <div className="lg:col-span-7 bg-zinc-950 border border-zinc-800 rounded-xl p-4 flex flex-col items-center justify-center relative min-h-[400px]">
          {isLoading ? (
            <div className="flex flex-col items-center gap-3 text-blue-400 animate-pulse">
              <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
              <span className="text-sm font-medium">正在進行 ComfyUI 多幀畫面推算與影片合成...</span>
              <span className="text-xs text-zinc-500">影片渲染較耗費 GPU 效能，請耐心等候</span>
            </div>
          ) : resultVideoUrl ? (
            <div className="w-full h-full flex flex-col items-center justify-center gap-3">
              <video
                src={resultVideoUrl}
                controls
                autoPlay
                loop
                className="max-h-[480px] w-full rounded-lg border border-zinc-800 shadow-2xl object-contain bg-black"
              />
              <span className="text-xs text-zinc-500">
                渲染耗時: {executionTime ? `${(executionTime / 1000).toFixed(1)} 秒` : ''}
              </span>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 text-zinc-600 text-xs">
              <span className="text-3xl">🎞️</span>
              <span>影片生成成果預覽區</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}