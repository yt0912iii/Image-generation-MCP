import React, { useState, useRef, useMemo } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Download,
  Film,
  // LoaderCircle,
  Maximize2,
  PanelLeftClose,
  PanelLeftOpen,
  X,
} from 'lucide-react';
import { useComfyVideoTasks, VideoTask } from './useComfyVideoTasks';
import { Loader2 } from 'lucide-react';

const BACKEND_URL = window.location.origin;
const COMFY_HOST = '127.0.0.1:8188';

type ImageWorkflowType = 'flux_t2i' | 'ghibli_style' | 'image_edit' | 'upscale';
type SizeMode = '768x1024' | '1024x768' | 'original' | 'custom';

interface WorkflowConfig {
  id: ImageWorkflowType;
  name: string;
  icon: string;
  description: string;
  requiresImage: boolean;
  allowsImage: boolean;
  supportsNegative: boolean;
  supportsPrompt: boolean;
  supportsSizePicker: boolean;
}

const WORKFLOW_CONFIGS: Record<ImageWorkflowType, WorkflowConfig> = {
  flux_t2i: {
    id: 'flux_t2i',
    name: 'FLUX 高品質文生圖',
    icon: '🎨',
    description: 'FLUX 頂級圖像大模型，透過詳細文字描述直接繪製高細節藝術作品。',
    requiresImage: false,
    allowsImage: false,
    supportsNegative: false,
    supportsPrompt: true,
    supportsSizePicker: true,
  },
  ghibli_style: {
    id: 'ghibli_style',
    name: '吉普力動漫風',
    icon: '🍃',
    description: '宮崎駿吉普力手繪動畫風格，上傳照片一鍵進行風格化轉換。',
    requiresImage: true,
    allowsImage: true,
    supportsNegative: false,
    supportsPrompt: false,
    supportsSizePicker: true,
  },
  image_edit: {
    id: 'image_edit',
    name: 'Qwen 圖像編輯修圖',
    icon: '🖼️',
    description: '針對上傳照片進行局部修改、更換背景、調整髮型服裝或風格轉換。',
    requiresImage: true,
    allowsImage: true,
    supportsNegative: true,
    supportsPrompt: true,
    supportsSizePicker: true,
  },
  upscale: {
    id: 'upscale',
    name: 'AI 高清畫質放大',
    icon: '🔍',
    description: 'Tile 分塊重繪技術，為低解析照片補充細節並進行 2x 高清超解析度放大。',
    requiresImage: true,
    allowsImage: true,
    supportsNegative: false,
    supportsPrompt: false,
    supportsSizePicker: false,
  },
};

function statusLabel(status: VideoTask['status']) {
  if (status === 'queued') return '正在排隊';
  if (status === 'running') return '正在處理';
  if (status === 'completed') return '已完成';
  if (status === 'cancelled') return '已取消';
  return '失敗';
}

function formatSubmittedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleString('zh-TW', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function isVideoFile(url?: string): boolean {
  if (!url) return false;
  return url.endsWith('.mp4') || url.endsWith('.webm') || url.endsWith('.mov');
}

export default function ImageGenerationView({ onAvatarResponse }: { onAvatarResponse?: (resp: { text: string }) => void }) {
  // 解構出 addTrackedTask 與 updateTrackedTask
  const { tasks: videoTasks, comfyActiveJobs, comfyConnected, addTrackedTask, updateTrackedTask } = useComfyVideoTasks(COMFY_HOST);

  const [selectedWorkflow, setSelectedWorkflow] = useState<ImageWorkflowType>('flux_t2i');
  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [selectedImageFilename, setSelectedImageFilename] = useState<string | null>(null);
  const [imageDimensions, setImageDimensions] = useState<{ width: number; height: number } | null>(null);

  const [selectedSizeMode, setSelectedSizeMode] = useState<SizeMode>('768x1024');
  const [isCustomExpanded, setIsCustomExpanded] = useState(false);
  const [customWidth, setCustomWidth] = useState<number>(1024);
  const [customHeight, setCustomHeight] = useState<number>(1024);

  const [isListening, setIsListening] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultDimensions, setResultDimensions] = useState<{ width: number; height: number } | null>(null);
  const [executionTime, setExecutionTime] = useState<number | null>(null);

  const [isTaskDrawerOpen, setIsTaskDrawerOpen] = useState(false);
  const [previewTask, setPreviewTask] = useState<VideoTask | null>(null);

  const activeVideoTasks = useMemo(
    () => videoTasks.filter((task) => task.status === 'queued' || task.status === 'running'),
    [videoTasks]
  );
  const activeCount = Math.max(activeVideoTasks.length, comfyActiveJobs);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const currentConfig = WORKFLOW_CONFIGS[selectedWorkflow];

  const handleWorkflowChange = (wfKey: ImageWorkflowType) => {
    setSelectedWorkflow(wfKey);
    setPrompt('');
    setNegativePrompt('');
    setSelectedImage(null);
    setSelectedImageFilename(null);
    setImageDimensions(null);
    setSelectedSizeMode('768x1024');
    setIsCustomExpanded(false);
    setResultUrl(null);
    setResultDimensions(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleVoiceInput = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('很抱歉，您的瀏覽器不支援語音辨識功能，建議使用 Chrome。');
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = 'zh-TW';
    recognition.interimResults = false;
    if (isListening) {
      recognition.stop();
      setIsListening(false);
      return;
    }
    setIsListening(true);
    recognition.start();
    recognition.onresult = (event: any) => {
      const speechResult = event.results[0][0].transcript;
      setPrompt((prev) => (prev ? `${prev}，${speechResult}` : speechResult));
    };
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);
  };

  const getImageDimensions = (base64Str: string): Promise<{ width: number; height: number }> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => resolve({ width: 768, height: 1024 });
      img.src = base64Str;
    });
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64 = reader.result as string;
        setSelectedImage(base64);
        setSelectedImageFilename(file.name);
        const dims = await getImageDimensions(base64);
        setImageDimensions(dims);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleStartWorkflow = async () => {
    if (currentConfig.requiresImage && !selectedImage) {
      alert(`「${currentConfig.name}」工作流必須上傳一張參考圖片！`);
      return;
    }
    if (currentConfig.supportsPrompt && !prompt.trim() && !selectedImage) {
      alert('請輸入提示詞或上傳圖片！');
      return;
    }

    let finalWidth = 768;
    let finalHeight = 1024;

    if (selectedWorkflow === 'upscale' || selectedSizeMode === 'original') {
      if (selectedImage) {
        const dims = imageDimensions || (await getImageDimensions(selectedImage));
        finalWidth = dims.width;
        finalHeight = dims.height;
      }
    } else if (selectedSizeMode === '768x1024') {
      finalWidth = 768;
      finalHeight = 1024;
    } else if (selectedSizeMode === '1024x768') {
      finalWidth = 1024;
      finalHeight = 768;
    } else if (selectedSizeMode === 'custom') {
      if (!customWidth || !customHeight || customWidth <= 0 || customHeight <= 0) {
        alert('請輸入正確的自訂義寬度與高度！');
        return;
      }
      finalWidth = customWidth;
      finalHeight = customHeight;
    }

    setIsLoading(true);
    setResultUrl(null);
    setResultDimensions(null);

    // 建立本地追蹤任務 ID 並註冊至任務中心
    const localTaskId = `task_${Date.now()}`;
    if (typeof addTrackedTask === 'function') {
      addTrackedTask({
        id: localTaskId,
        workflowName: currentConfig.name,
        status: 'running',
      });
    }

    try {
      let finalPromptToUse = 'high quality detailed art';
      if (currentConfig.supportsPrompt) {
        finalPromptToUse = prompt.trim() || 'high quality detailed art';
      } else if (selectedWorkflow === 'ghibli_style') {
        finalPromptToUse = 'ghibli studio style, detailed illustration';
      } else if (selectedWorkflow === 'upscale') {
        finalPromptToUse = 'high resolution, sharp details, master quality';
      }

      const res = await fetch(`${BACKEND_URL}/api/generate/dispatch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userPrompt: finalPromptToUse,
          workflowId: selectedWorkflow,
          params: {
            seed: Math.floor(Math.random() * 1000000000),
            width: finalWidth,
            height: finalHeight,
            negativePrompt: currentConfig.supportsNegative ? negativePrompt : undefined,
            uploadedImage: selectedImage || undefined,
          },
        }),
      });

      if (!res.ok) {
        if (typeof updateTrackedTask === 'function') {
          updateTrackedTask(localTaskId, { status: 'failed', errorMessage: `HTTP ${res.status}` });
        }
        throw new Error(`伺服器錯誤 (${res.status})`);
      }

      const data = await res.json();
      const promptId = data.promptId || data.prompt_id;

      if (data.success && data.outputUrl) {
        const fullUrl = data.outputUrl.startsWith('http') ? data.outputUrl : `${BACKEND_URL}${data.outputUrl}`;
        setResultUrl(fullUrl);
        setExecutionTime(data.executionTimeMs);

        const resDims = await getImageDimensions(fullUrl);
        setResultDimensions(resDims);

        // 成功產圖後直接同步任務狀態為已完成
        if (typeof updateTrackedTask === 'function') {
          updateTrackedTask(localTaskId, {
            promptId: promptId,
            status: 'completed',
            outputUrl: fullUrl,
            executionTimeMs: data.executionTimeMs,
          });
        }

        if (onAvatarResponse && data.avatarResponse?.text) {
          onAvatarResponse({ text: data.avatarResponse.text });
        }
      } else {
        if (typeof updateTrackedTask === 'function') {
          updateTrackedTask(localTaskId, { status: 'failed', errorMessage: data.message || '生成失敗' });
        }
        throw new Error(data.message || '生成失敗');
      }
    } catch (err: any) {
      if (typeof updateTrackedTask === 'function') {
        updateTrackedTask(localTaskId, { status: 'failed', errorMessage: err.message });
      }
      alert(`生成失敗: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-5 min-h-[680px] flex flex-col gap-5">
        {/* 工作流選擇列表 */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold text-purple-400 flex items-center gap-1.5">
            <span>🎨</span> 選擇圖像生成工作流：
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {(Object.keys(WORKFLOW_CONFIGS) as ImageWorkflowType[]).map((key) => {
              const wf = WORKFLOW_CONFIGS[key];
              const isSelected = selectedWorkflow === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => handleWorkflowChange(key)}
                  className={`p-3 rounded-xl border text-left flex flex-col gap-1 transition-all ${
                    isSelected
                      ? 'bg-purple-600/20 border-purple-500 ring-1 ring-purple-500/50 text-white'
                      : 'bg-zinc-950/60 border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
                  }`}
                >
                  <div className="flex items-center gap-2 font-medium text-sm">
                    <span>{wf.icon}</span>
                    <span>{wf.name}</span>
                  </div>
                  <span className="text-[10px] text-zinc-500 line-clamp-2">{wf.description}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 主工作區 */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 flex-1">
          {/* 左側：設定面板 */}
          <div className="lg:col-span-5 bg-zinc-950 border border-zinc-800 rounded-xl p-4 flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
              <span className="text-xs font-semibold text-zinc-300 flex items-center gap-1">
                {currentConfig.icon} {currentConfig.name}
              </span>
            </div>

            {/* 圖片上傳 */}
            {currentConfig.allowsImage && (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-zinc-400 font-medium flex items-center justify-between">
                  <span>🖼️ 參考圖片</span>
                  {selectedImage && (
                    <button
                      onClick={() => {
                        setSelectedImage(null);
                        setSelectedImageFilename(null);
                        setImageDimensions(null);
                        if (fileInputRef.current) fileInputRef.current.value = '';
                      }}
                      className="text-[10px] text-red-400 hover:underline"
                    >
                      清除圖片
                    </button>
                  )}
                </label>
                <input type="file" ref={fileInputRef} onChange={handleImageChange} accept="image/*" className="hidden" />
                {selectedImage ? (
                  <div className="border border-purple-500/50 rounded-lg p-2 bg-zinc-900/60 flex items-center gap-3">
                    <img src={selectedImage} alt="Uploaded" className="w-14 h-14 object-cover rounded border border-zinc-700" />
                    <div className="flex flex-col overflow-hidden">
                      <span className="text-xs text-zinc-200 truncate">{selectedImageFilename}</span>
                      {imageDimensions && (
                        <span className="text-[10px] text-purple-400 font-mono">
                          原圖尺寸: {imageDimensions.width} × {imageDimensions.height} px
                        </span>
                      )}
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-zinc-800 hover:border-zinc-700 rounded-lg p-3 flex flex-col items-center gap-1"
                  >
                    <span className="text-sm text-zinc-300">📤 選擇圖片</span>
                  </button>
                )}
              </div>
            )}

            {/* 正向提示詞 */}
            {currentConfig.supportsPrompt && (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-zinc-400 font-medium">✨ 正向提示詞 (Prompt) 請輸入英文</label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="輸入提示詞描述..."
                  className="w-full min-h-[95px] bg-zinc-900 border border-zinc-800 rounded-lg p-2.5 text-xs text-zinc-100 font-mono resize-none focus:outline-none focus:border-purple-500"
                />
              </div>
            )}

            {/* 尺寸選擇區塊 */}
            {currentConfig.supportsSizePicker && (
              <div className="flex flex-col gap-2 p-3 bg-zinc-900/60 border border-zinc-800/80 rounded-xl">
                <label className="text-xs text-zinc-300 font-semibold flex items-center gap-1.5">
                  <span>📐</span> 輸出畫面尺寸
                </label>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedSizeMode('768x1024')}
                    className={`p-2.5 rounded-lg border text-left flex flex-col transition-all ${
                      selectedSizeMode === '768x1024'
                        ? 'bg-purple-950/50 border-purple-500 text-purple-200 ring-1 ring-purple-500/40'
                        : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                    }`}
                  >
                    <span className="text-xs font-semibold">📱 768 × 1024</span>
                    <span className="text-[10px] text-zinc-500">直向畫幅 (3:4)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedSizeMode('1024x768')}
                    className={`p-2.5 rounded-lg border text-left flex flex-col transition-all ${
                      selectedSizeMode === '1024x768'
                        ? 'bg-purple-950/50 border-purple-500 text-purple-200 ring-1 ring-purple-500/40'
                        : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                    }`}
                  >
                    <span className="text-xs font-semibold">🖥️ 1024 × 768</span>
                    <span className="text-[10px] text-zinc-500">橫向畫幅 (4:3)</span>
                  </button>
                </div>

                {selectedImage && (
                  <button
                    type="button"
                    onClick={() => setSelectedSizeMode('original')}
                    className={`w-full p-2 rounded-lg border text-xs font-medium flex items-center justify-center gap-1.5 transition-all ${
                      selectedSizeMode === 'original'
                        ? 'bg-purple-900/40 border-purple-500 text-purple-200'
                        : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                    }`}
                  >
                    <span>🖼️ 套用原圖解析度</span>
                    {imageDimensions && (
                      <span className="font-mono text-[11px] text-purple-400">
                        ({imageDimensions.width}×{imageDimensions.height})
                      </span>
                    )}
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setSelectedSizeMode('custom');
                    setIsCustomExpanded(!isCustomExpanded);
                  }}
                  className={`w-full p-2 border rounded-lg text-xs font-medium flex items-center justify-between transition-all ${
                    selectedSizeMode === 'custom'
                      ? 'bg-purple-950/60 border-purple-500 text-purple-200'
                      : 'bg-zinc-950 hover:bg-zinc-900 border-zinc-800 text-zinc-400'
                  }`}
                >
                  <span className="flex items-center gap-1.5">⚙️ 自訂義寬高</span>
                  <span className="text-[10px] text-zinc-500">
                    {selectedSizeMode === 'custom' && isCustomExpanded ? '收起設定' : '展開數值'}
                  </span>
                </button>

                {selectedSizeMode === 'custom' && isCustomExpanded && (
                  <div className="p-2.5 bg-zinc-950 border border-purple-500/30 rounded-lg flex items-center gap-2 mt-1">
                    <div className="flex-1 flex flex-col gap-0.5">
                      <span className="text-[10px] text-zinc-400">寬 (px)</span>
                      <input
                        type="number"
                        value={customWidth}
                        onChange={(e) => setCustomWidth(Number(e.target.value))}
                        className="w-full bg-zinc-900 border border-zinc-800 rounded p-1.5 text-xs text-center text-white focus:outline-none focus:border-purple-500 font-mono"
                      />
                    </div>
                    <span className="text-zinc-500 text-xs mt-3">×</span>
                    <div className="flex-1 flex flex-col gap-0.5">
                      <span className="text-[10px] text-zinc-400">高 (px)</span>
                      <input
                        type="number"
                        value={customHeight}
                        onChange={(e) => setCustomHeight(Number(e.target.value))}
                        className="w-full bg-zinc-900 border border-zinc-800 rounded p-1.5 text-xs text-center text-white focus:outline-none focus:border-purple-500 font-mono"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 負向提示詞 */}
            {currentConfig.supportsNegative && (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-zinc-400 font-medium">🚫 負向提示詞</label>
                <input
                  type="text"
                  value={negativePrompt}
                  onChange={(e) => setNegativePrompt(e.target.value)}
                  placeholder="排除元素..."
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2.5 text-xs text-zinc-100 focus:outline-none"
                />
              </div>
            )}

            {/* 吉普力動漫風提示 */}
            {selectedWorkflow === 'ghibli_style' && (
              <div className="p-3 bg-zinc-900/50 border border-zinc-800/80 rounded-lg text-xs text-zinc-400 flex items-center gap-2">
                <span>🍃</span>
                <span>上傳照片並選好尺寸後點擊執行，系統將自動套用經典吉普力手繪色彩風格。</span>
              </div>
            )}

            {/* 高清放大專用 */}
            {selectedWorkflow === 'upscale' && (
              <div className="flex flex-col gap-2 p-3.5 bg-purple-950/20 border border-purple-500/30 rounded-xl">
                <div className="text-xs font-semibold text-purple-300 flex items-center gap-1.5">
                  <span>🔍</span> 高清放大規格預覽
                </div>
                {imageDimensions ? (
                  <div className="grid grid-cols-2 gap-2 mt-1">
                    <div className="p-2.5 bg-zinc-900/80 border border-zinc-800 rounded-lg flex flex-col">
                      <span className="text-[10px] text-zinc-400">原圖解析度</span>
                      <span className="text-xs font-mono font-semibold text-zinc-200 mt-0.5">
                        {imageDimensions.width} × {imageDimensions.height} px
                      </span>
                    </div>
                    <div className="p-2.5 bg-purple-900/40 border border-purple-500/40 rounded-lg flex flex-col">
                      <span className="text-[10px] text-purple-300 font-medium">✨ 放大後預估 (2x)</span>
                      <span className="text-xs font-mono font-bold text-purple-200 mt-0.5">
                        {imageDimensions.width * 2} × {imageDimensions.height * 2} px
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="text-[11px] text-zinc-400 leading-relaxed">
                    請先在上方上傳欲放大的圖片，系統將自動讀取原圖解析度並進行 2 倍無損超解析度放大修復。
                  </p>
                )}
              </div>
            )}

            {/* 底部按鈕區 */}
            <div className="flex gap-2 mt-auto">
              {currentConfig.supportsPrompt && (
                <button
                  type="button"
                  onClick={handleVoiceInput}
                  className={`px-4 py-2.5 rounded-lg border text-sm font-medium flex items-center justify-center gap-1.5 transition-all ${
                    isListening
                      ? 'bg-red-600/20 border-red-500 text-red-400 animate-pulse'
                      : 'bg-zinc-900 border-zinc-800 text-zinc-300'
                  }`}
                >
                  <span>{isListening ? '🛑' : '🎙️'}</span>
                  <span className="hidden sm:inline">{isListening ? '錄音中...' : '語音輸入'}</span>
                </button>
              )}
              <button
                type="button"
                onClick={handleStartWorkflow}
                disabled={isLoading}
                className="flex-1 py-2.5 bg-purple-600 hover:bg-purple-500 text-white text-sm font-semibold rounded-lg transition-all disabled:opacity-50"
              >
                {isLoading ? '繪製中...' : '🚀 開始執行'}
              </button>
            </div>
          </div>

          {/* 右側：成果展示區 */}
          <div className="lg:col-span-7 bg-zinc-950 border border-zinc-800 rounded-xl p-4 flex flex-col items-center justify-center relative min-h-[400px]">
            {isLoading ? (
              <div className="flex flex-col items-center gap-3 text-purple-400 animate-pulse">
                <div className="w-8 h-8 border-4 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
                <span className="text-sm">正在執行 ComfyUI 創作流程...</span>
              </div>
            ) : resultUrl ? (
              <div className="w-full h-full flex flex-col items-center justify-center gap-3">
                <img
                  src={resultUrl}
                  alt="Result"
                  className="max-h-[480px] object-contain rounded-lg border border-zinc-800"
                />
                <div className="flex items-center gap-4 text-xs text-zinc-400">
                  {resultDimensions && (
                    <span className="font-mono bg-zinc-900 px-2 py-0.5 rounded border border-zinc-800 text-purple-300">
                      尺寸: {resultDimensions.width} × {resultDimensions.height} px
                    </span>
                  )}
                  {executionTime && (
                    <span className="text-zinc-500">耗時: {(executionTime / 1000).toFixed(1)} 秒</span>
                  )}
                  <a href={resultUrl} download className="text-purple-400 hover:underline">
                    下載圖片
                  </a>
                </div>
              </div>
            ) : (
              <div className="text-zinc-500 text-xs">🖼️ 成果預覽區</div>
            )}
          </div>
        </div>
      </div>

      {/* 🎯 影片任務中心：右側懸浮觸發按鈕 */}
      <button
        type="button"
        onClick={() => setIsTaskDrawerOpen((open) => !open)}
        title="影片任務中心"
        className="fixed right-0 top-1/2 -translate-y-1/2 z-50 flex items-center gap-2 rounded-l-xl border border-r-0 border-blue-500/50 bg-zinc-900/95 px-2.5 py-3 text-zinc-200 shadow-xl backdrop-blur transition hover:bg-zinc-800"
      >
        {isTaskDrawerOpen ? <PanelLeftClose className="h-4 w-4 text-blue-300" /> : <PanelLeftOpen className="h-4 w-4 text-blue-300" />}
        <span className="text-xs font-medium [writing-mode:vertical-rl]">影片任務</span>
        {activeCount > 0 && (
          <span className="absolute -left-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-500 px-1 text-[10px] font-bold text-white ring-2 ring-zinc-950 animate-pulse">
            {activeCount > 99 ? '99+' : activeCount}
          </span>
        )}
      </button>

      {/* 🎯 影片任務中心：側邊抽屜面板 */}
      {isTaskDrawerOpen && (
        <aside className="fixed inset-y-0 right-0 z-40 flex w-[min(92vw,380px)] flex-col border-l border-zinc-800 bg-zinc-950/98 pt-20 shadow-2xl backdrop-blur">
          <div className="flex items-start justify-between border-b border-zinc-800 px-4 pb-4">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
                <Film className="h-4 w-4 text-blue-400" />
                影片任務中心
              </div>
              <p className="mt-1 text-[11px] text-zinc-500">與 ComfyUI 伺服器即時同步隊列與產出</p>
            </div>
            <button
              type="button"
              onClick={() => setIsTaskDrawerOpen(false)}
              className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 border-b border-zinc-800 p-4 text-[11px]">
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-2">
              <span className="block text-zinc-500">目前任務</span>
              <span className="mt-1 block text-lg font-semibold text-blue-300">{activeVideoTasks.length}</span>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-2">
              <span className="block text-zinc-500">ComfyUI 連線</span>
              <span className={`mt-1 block text-lg font-semibold ${comfyConnected ? 'text-emerald-300' : 'text-rose-400'}`}>
                {comfyConnected ? `${comfyActiveJobs} 排隊中` : '未連線'}
              </span>
            </div>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {videoTasks.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-zinc-600">
                <Film className="h-8 w-8" />
                <p className="text-xs">目前沒有執行中的影片任務</p>
              </div>
            ) : (
              videoTasks.map((task) => (
                <div key={task.id} className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-3">
                  <div className="flex items-start gap-3">
                    <div className="flex h-14 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-zinc-950 border border-zinc-800">
                      {task.outputUrl ? (
                        isVideoFile(task.outputUrl) ? (
                          <video src={task.outputUrl} muted autoPlay loop className="h-full w-full object-cover" />
                        ) : (
                          <img src={task.outputUrl} alt={task.workflowName} className="h-full w-full object-cover" />
                        )
                      ) : task.status === 'failed' ? (
                        <AlertCircle className="h-5 w-5 text-rose-400" />
                      ) : (
                        <Loader2 className="h-5 w-5 animate-spin text-blue-400" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium text-zinc-200">{task.workflowName}</div>
                      <div className="mt-1 flex items-center gap-1.5 text-[10px] text-zinc-500">
                        {task.status === 'completed' ? (
                          <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                        ) : task.status === 'queued' ? (
                          <Clock3 className="h-3 w-3 text-amber-400" />
                        ) : task.status === 'failed' ? (
                          <AlertCircle className="h-3 w-3 text-rose-400" />
                        ) : (
                          <Loader2 className="h-3 w-3 animate-spin text-blue-400" />
                        )}
                        <span className={task.status === 'completed' ? 'text-emerald-400' : task.status === 'failed' ? 'text-rose-400' : ''}>
                          {statusLabel(task.status)}
                        </span>
                      </div>
                      {task.status === 'queued' && task.queuePosition !== undefined && task.queuePosition > 0 && (
                        <div className="mt-0.5 text-[10px] text-amber-300/80">前方排隊：{task.queuePosition} 個任務</div>
                      )}
                      <div className="mt-1 text-[10px] text-zinc-500">送出時間：{formatSubmittedAt(task.createdAt)}</div>
                      {task.status === 'completed' && task.executionTimeMs !== undefined && (
                        <div className="mt-0.5 text-[10px] text-emerald-400/80">
                          處理耗時：{(task.executionTimeMs / 1000).toFixed(1)} 秒
                        </div>
                      )}
                      {task.errorMessage && <p className="mt-1 line-clamp-2 text-[10px] text-rose-300">{task.errorMessage}</p>}
                    </div>
                  </div>
                  {task.outputUrl && (
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={() => setPreviewTask(task)}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-blue-600/20 px-2 py-1.5 text-[11px] font-medium text-blue-300 hover:bg-blue-600/30"
                      >
                        <Maximize2 className="h-3.5 w-3.5" /> 預覽{isVideoFile(task.outputUrl) ? '影片' : '圖片'}
                      </button>
                      <a
                        href={task.outputUrl}
                        download
                        className="flex items-center justify-center rounded-lg border border-zinc-700 px-2.5 text-zinc-300 hover:bg-zinc-800"
                        title="下載成果"
                      >
                        <Download className="h-3.5 w-3.5" />
                      </a>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </aside>
      )}

      {/* 🎯 成果全螢幕預覽彈窗（支援影片與圖片） */}
      {previewTask?.outputUrl && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          onClick={() => setPreviewTask(null)}
        >
          <div
            className="w-full max-w-5xl rounded-2xl border border-zinc-700 bg-zinc-950 p-3 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between px-1">
              <span className="truncate text-sm font-medium text-zinc-200">{previewTask.workflowName}</span>
              <div className="flex items-center gap-2">
                <a
                  href={previewTask.outputUrl}
                  download
                  className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800"
                >
                  <Download className="h-3.5 w-3.5" />
                  下載
                </a>
                <button
                  type="button"
                  onClick={() => setPreviewTask(null)}
                  className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            {isVideoFile(previewTask.outputUrl) ? (
              <video src={previewTask.outputUrl} controls autoPlay loop className="max-h-[75vh] w-full rounded-xl bg-black" />
            ) : (
              <img src={previewTask.outputUrl} alt={previewTask.workflowName} className="max-h-[75vh] w-full object-contain rounded-xl bg-black" />
            )}
          </div>
        </div>
      )}
    </>
  );
}