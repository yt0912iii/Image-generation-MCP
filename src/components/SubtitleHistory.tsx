import React, { useRef, useEffect, useState } from 'react';
import { Send, Volume2, Trash2, ImagePlus, Mic, MicOff, Loader2, X, Play, Check } from 'lucide-react';

export interface ChatMessage {
  id: string;
  sender: 'user' | 'avatar';
  text: string;
  timestamp: string;
  workflowId?: string;
  workflowName?: string;
  optimizedPrompt?: string;
  params?: Record<string, any>;
  sizeOptions?: Array<{ label: string; width?: number; height?: number; ratioKey: string }>;
  durationOptions?: Array<{ label: string; seconds?: number; key: string }>;
  status?: 'pending_size' | 'generating' | 'completed' | 'failed';
}

interface SubtitleHistoryProps {
  messages: ChatMessage[];
  onPlaySpeech: (text: string) => void;
  onClearHistory: () => void;
  onSendMessage: (text: string, uploadedImage?: string) => void;
  onConfirmDispatch: (msgId: string, selectedParams: { width?: number; height?: number; ratioKey?: string; videoDuration?: number }) => void;
  isLoading?: boolean;
  uploadedImage: string | null;
  onSelectImage: (imgUrl: string | null) => void;
}

export const SubtitleHistory: React.FC<SubtitleHistoryProps> = ({
  messages,
  onPlaySpeech,
  onClearHistory,
  onSendMessage,
  onConfirmDispatch,
  isLoading,
  uploadedImage,
  onSelectImage
}) => {
  const [inputText, setInputText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const recognitionRef = useRef<any>(null);

  // 🎯 保存每個待選訊息的選取狀態：{ [msgId]: { sizeOpt, durationOpt } }
  const [pendingSelections, setPendingSelections] = useState<Record<string, {
    size?: { width?: number; height?: number; ratioKey: string };
    duration?: number;
  }>>({});

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'zh-TW';

      recognition.onresult = (event: any) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          transcript += event.results[i][0].transcript;
        }
        if (transcript) {
          setInputText(prev => prev ? `${prev} ${transcript}` : transcript);
        }
      };

      recognition.onerror = (event: any) => {
        console.warn('[Speech Recognition Error]:', event.error);
        setIsRecording(false);
      };

      recognition.onend = () => {
        setIsRecording(false);
      };

      recognitionRef.current = recognition;
    }
  }, []);

  const toggleRecording = () => {
    if (!recognitionRef.current) {
      alert('您的瀏覽器暫不支援語音輸入，建議使用 Chrome 或 Edge！');
      return;
    }

    if (isRecording) {
      recognitionRef.current.stop();
      setIsRecording(false);
    } else {
      try {
        recognitionRef.current.start();
        setIsRecording(true);
      } catch (err) {
        console.error('[Speech Start Error]:', err);
      }
    }
  };

  const handleSend = () => {
    if ((!inputText.trim() && !uploadedImage) || isLoading) return;
    if (isRecording && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsRecording(false);
    }
    onSendMessage(inputText, uploadedImage || undefined);
    setInputText('');
    onSelectImage(null);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        onSelectImage(event.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  // 🎯 點選尺寸選項
  const handleSelectSize = (msgId: string, opt: { width?: number; height?: number; ratioKey: string }, msg: ChatMessage) => {
    setPendingSelections(prev => {
      const current = prev[msgId] || {};
      const updated = { ...current, size: opt };

      // 如果此訊息不需要選秒數（沒有 durationOptions），選了尺寸可直接送出
      if (!msg.durationOptions || msg.durationOptions.length === 0) {
        onConfirmDispatch(msgId, {
          width: opt.width,
          height: opt.height,
          ratioKey: opt.ratioKey,
          videoDuration: msg.params?.videoDuration
        });
      }
      return { ...prev, [msgId]: updated };
    });
  };

  // 🎯 點選長度選項
  const handleSelectDuration = (msgId: string, seconds: number, msg: ChatMessage) => {
    setPendingSelections(prev => {
      const current = prev[msgId] || {};
      const updated = { ...current, duration: seconds };

      // 如果此訊息不需要選尺寸（沒有 sizeOptions），選了秒數可直接送出
      if (!msg.sizeOptions || msg.sizeOptions.length === 0) {
        onConfirmDispatch(msgId, {
          width: msg.params?.width,
          height: msg.params?.height,
          videoDuration: seconds
        });
      }
      return { ...prev, [msgId]: updated };
    });
  };

  // 🎯 當兩個都需要選時，點擊最終確認按鈕觸發
  const handleFinalSubmit = (msgId: string, msg: ChatMessage) => {
    const current = pendingSelections[msgId];
    if (!current?.size && msg.sizeOptions && msg.sizeOptions.length > 0) {
      alert('請先選擇畫面尺寸！');
      return;
    }
    if (!current?.duration && msg.durationOptions && msg.durationOptions.length > 0) {
      alert('請先選擇影片長度！');
      return;
    }

    onConfirmDispatch(msgId, {
      width: current?.size?.width || msg.params?.width,
      height: current?.size?.height || msg.params?.height,
      ratioKey: current?.size?.ratioKey,
      videoDuration: current?.duration || msg.params?.videoDuration || 5
    });
  };

  return (
    <div className="flex flex-col h-[780px] bg-zinc-900 border border-zinc-800 rounded-2xl shadow-xl overflow-hidden">
      {/* 標題欄 */}
      <div className="p-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-950/60">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-purple-500 animate-pulse" />
          <h2 className="text-sm font-bold text-zinc-100">數位人互動對話</h2>
        </div>
        <button
          onClick={onClearHistory}
          className="text-zinc-500 hover:text-rose-400 text-xs flex items-center gap-1 transition-colors cursor-pointer"
        >
          <Trash2 className="w-3.5 h-3.5" /> 清空記錄
        </button>
      </div>

      {/* 訊息記錄區域 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg) => {
          const selection = pendingSelections[msg.id] || {};
          const needsBoth = !!(msg.sizeOptions?.length && msg.durationOptions?.length);
          const isReadyToSubmit = needsBoth && selection.size && selection.duration;

          return (
            <div
              key={msg.id}
              className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'} gap-1.5`}
            >
              <div
                className={`max-w-[85%] rounded-2xl p-3.5 text-sm leading-relaxed ${
                  msg.sender === 'user'
                    ? 'bg-purple-600 text-white rounded-br-none shadow-md'
                    : 'bg-zinc-800/90 text-zinc-200 rounded-bl-none border border-zinc-700/60 shadow-md'
                }`}
              >
                {msg.text}

                {msg.sender === 'avatar' && (
                  <button
                    onClick={() => onPlaySpeech(msg.text)}
                    className="mt-2 flex items-center gap-1 text-xs text-zinc-400 hover:text-purple-300 transition-colors cursor-pointer"
                  >
                    <Volume2 className="w-3.5 h-3.5" /> 朗讀語音
                  </button>
                )}

                {/* 尺寸 / 長度選單 */}
                {msg.status === 'pending_size' && (
                  <div className="mt-3 pt-3 border-t border-zinc-700/80 space-y-3">
                    {/* 1. 尺寸選擇 */}
                    {msg.sizeOptions && msg.sizeOptions.length > 0 && (
                      <div>
                        <div className="text-[11px] font-mono text-purple-300 mb-1.5 font-semibold flex items-center gap-1">
                          <span>📐 步驟 1：選擇畫面尺寸</span>
                          {selection.size && <Check className="w-3 h-3 text-emerald-400" />}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {msg.sizeOptions.map((opt, idx) => {
                            const isSelected = selection.size?.ratioKey === opt.ratioKey;
                            return (
                              <button
                                key={idx}
                                onClick={() => handleSelectSize(msg.id, opt, msg)}
                                className={`px-2.5 py-1 rounded-lg text-xs font-mono transition-all cursor-pointer border ${
                                  isSelected
                                    ? 'bg-purple-600 border-purple-400 text-white shadow-md font-bold ring-1 ring-purple-300'
                                    : 'bg-zinc-900 hover:bg-zinc-800 border-zinc-700 text-zinc-300'
                                }`}
                              >
                                {opt.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* 2. 影片長度選擇 */}
                    {msg.durationOptions && msg.durationOptions.length > 0 && (
                      <div>
                        <div className="text-[11px] font-mono text-purple-300 mb-1.5 font-semibold flex items-center gap-1">
                          <span>⏱️ {msg.sizeOptions?.length ? '步驟 2：' : ''}選擇影片長度</span>
                          {selection.duration && <Check className="w-3 h-3 text-emerald-400" />}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {msg.durationOptions.map((dOpt, dIdx) => {
                            const isSelected = selection.duration === dOpt.seconds;
                            return (
                              <button
                                key={dIdx}
                                onClick={() => handleSelectDuration(msg.id, dOpt.seconds || 5, msg)}
                                className={`px-2.5 py-1 rounded-lg text-xs font-mono transition-all cursor-pointer border ${
                                  isSelected
                                    ? 'bg-purple-600 border-purple-400 text-white shadow-md font-bold ring-1 ring-purple-300'
                                    : 'bg-zinc-900 hover:bg-zinc-800 border-zinc-700 text-zinc-300'
                                }`}
                              >
                                {dOpt.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* 3. 🎯 雙重選項確認送出按鈕 (兩者都需選時顯示) */}
                    {needsBoth && (
                      <button
                        onClick={() => handleFinalSubmit(msg.id, msg)}
                        disabled={!isReadyToSubmit}
                        className={`w-full mt-2 py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all shadow-md ${
                          isReadyToSubmit
                            ? 'bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer animate-pulse'
                            : 'bg-zinc-900 text-zinc-500 border border-zinc-800 cursor-not-allowed opacity-70'
                        }`}
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                        <span>{isReadyToSubmit ? '確認參數，開始生成影片 🚀' : '請完成上方尺寸與長度選擇'}</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
              <span className="text-[10px] text-zinc-500 font-mono px-1">{msg.timestamp}</span>
            </div>
          );
        })}

        {isLoading && (
          <div className="flex items-center gap-2 text-xs text-purple-400 font-mono p-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>數位人 Agent 正在思考並分析您的意圖...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* 附加參考圖預覽區 */}
      {uploadedImage && (
        <div className="px-4 py-2 bg-zinc-950/90 border-t border-zinc-800 flex items-center justify-between gap-3 animate-in fade-in duration-200">
          <div className="flex items-center gap-2.5 overflow-hidden">
            <div className="relative w-12 h-12 rounded-lg overflow-hidden border border-purple-500/60 shrink-0 shadow-md">
              <img src={uploadedImage} alt="Selected Reference" className="w-full h-full object-cover" />
            </div>
            <div className="text-xs">
              <div className="text-purple-300 font-medium font-mono">已附加參考圖片</div>
              <div className="text-[11px] text-zinc-500 truncate max-w-[200px]">將作為下一個任務的輸入素材</div>
            </div>
          </div>
          <button
            onClick={() => onSelectImage(null)}
            title="移除附加圖片"
            className="p-1.5 rounded-lg bg-zinc-900 hover:bg-rose-950/50 text-zinc-400 hover:text-rose-400 border border-zinc-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 底部輸入區域 */}
      <div className="p-3 bg-zinc-950 border-t border-zinc-800">
        <div className="flex items-center gap-2">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleImageUpload}
            accept="image/*"
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            title="本機上傳圖片"
            className="p-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-zinc-800 transition-colors cursor-pointer shrink-0"
          >
            <ImagePlus className="w-4 h-4" />
          </button>

          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={
              isRecording
                ? '正在聆聽您的語音...'
                : uploadedImage
                ? '輸入針對此參考圖的需求（例如：16比9、轉成5秒影片）...'
                : '輸入您的創作需求（例如：生成一隻貓咪游泳的影片）...'
            }
            disabled={isLoading}
            className={`flex-1 bg-zinc-900 border text-sm rounded-xl px-3.5 py-2.5 text-zinc-100 placeholder-zinc-500 focus:outline-none transition-colors ${
              isRecording
                ? 'border-rose-500/60 ring-1 ring-rose-500/30'
                : uploadedImage
                ? 'border-purple-500/60 focus:border-purple-400'
                : 'border-zinc-800 focus:border-purple-500'
            }`}
          />

          <button
            onClick={toggleRecording}
            title={isRecording ? '點擊停止語音輸入' : '點擊開始語音輸入'}
            className={`p-2.5 rounded-xl border transition-all cursor-pointer shrink-0 ${
              isRecording
                ? 'bg-rose-600 text-white border-rose-500 animate-pulse shadow-lg shadow-rose-600/30'
                : 'bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 border-zinc-800'
            }`}
          >
            {isRecording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>

          <button
            onClick={handleSend}
            disabled={isLoading || (!inputText.trim() && !uploadedImage)}
            className="p-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-40 disabled:hover:bg-purple-600 text-white font-medium transition-all shadow-md cursor-pointer shrink-0"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};