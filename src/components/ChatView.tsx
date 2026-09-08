import React, { useState } from 'react';

export interface SizeOption {
  label: string;
  width: number;
  height: number;
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  workflowId?: string;
  workflowName?: string;
  optimizedPrompt?: string;
  params?: {
    width: number;
    height: number;
    seed: number;
    inputImage?: string;
  };
  sizeOptions?: SizeOption[];
  isChatOnly?: boolean;
  outputUrl?: string;
  outputType?: 'image' | 'video';
  isGenerating?: boolean;
}

export const ChatView: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  // 1. 發送分析意圖請求 (/api/generate/analyze-intent)
  const handleSend = async () => {
    if (!input.trim()) return;

    const userMsg: ChatMessage = { id: Date.now().toString(), sender: 'user', text: input };
    setMessages((prev) => [...prev, userMsg]);
    const currentInput = input;
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/generate/analyze-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userPrompt: currentInput }),
      });
      const data = await res.json();

      if (data.success) {
        const assistantMsg: ChatMessage = {
          id: (Date.now() + 1).toString(),
          sender: 'assistant',
          text: data.avatarResponseText,
          workflowId: data.workflowId,
          workflowName: data.workflowName,
          optimizedPrompt: data.optimizedPrompt,
          params: data.params,
          sizeOptions: data.sizeOptions,
          isChatOnly: data.isChatOnly,
        };
        setMessages((prev) => [...prev, assistantMsg]);
      }
    } catch (err) {
      console.error('Analyze intent error:', err);
    } finally {
      setLoading(false);
    }
  };

  // 2. 切換特定訊息的尺寸
  const handleSelectSize = (msgId: string, size: SizeOption) => {
    setMessages((prev) =>
      prev.map((msg) => {
        if (msg.id === msgId && msg.params) {
          return {
            ...msg,
            params: {
              ...msg.params,
              width: size.width,
              height: size.height,
            },
          };
        }
        return msg;
      })
    );
  };

  // 3. 調度工作流生成內容 (/api/generate/dispatch)
  const handleDispatch = async (msg: ChatMessage) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === msg.id ? { ...m, isGenerating: true } : m))
    );

    try {
      const res = await fetch('/api/generate/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userPrompt: msg.optimizedPrompt || msg.text,
          workflowId: msg.workflowId,
          params: msg.params,
        }),
      });
      const data = await res.json();

      setMessages((prev) =>
        prev.map((m) => {
          if (m.id === msg.id) {
            return {
              ...m,
              isGenerating: false,
              outputUrl: data.outputUrl,
              outputType: data.outputType,
            };
          }
          return m;
        })
      );
    } catch (err) {
      console.error('Dispatch error:', err);
      setMessages((prev) =>
        prev.map((m) => (m.id === msg.id ? { ...m, isGenerating: false } : m))
      );
    }
  };

  return (
    <div className="flex flex-col h-screen max-w-4xl mx-auto p-4 bg-gray-50">
      {/* 訊息顯示區 */}
      <div className="flex-1 overflow-y-auto space-y-4 mb-4 pr-2">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}
          >
            {/* 主對話氣泡 */}
            <div
              className={`max-w-lg p-3 rounded-2xl text-sm shadow-sm ${
                msg.sender === 'user'
                  ? 'bg-blue-600 text-white rounded-br-none'
                  : 'bg-white text-gray-800 border border-gray-200 rounded-bl-none'
              }`}
            >
              <p className="whitespace-pre-wrap">{msg.text}</p>

              {/* 生成結果預覽 */}
              {msg.outputUrl && (
                <div className="mt-3 rounded-lg overflow-hidden border border-gray-200">
                  {msg.outputType === 'video' ? (
                    <video src={msg.outputUrl} controls className="w-full h-auto" />
                  ) : (
                    <img src={msg.outputUrl} alt="ComfyUI Output" className="w-full h-auto" />
                  )}
                </div>
              )}
            </div>

            {/* 🎯 尺寸選項列（位在 AI 回覆氣泡下方，佔用空間小） */}
            {msg.sender === 'assistant' && !msg.isChatOnly && !msg.outputUrl && (
              <div className="mt-2 flex flex-col items-start space-y-2">
                {/* 膠囊按鈕區 */}
                {msg.sizeOptions && msg.sizeOptions.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 items-center">
                    <span className="text-xs text-gray-400 mr-1">選擇尺寸:</span>
                    {msg.sizeOptions.map((opt, idx) => {
                      const isSelected =
                        msg.params?.width === opt.width && msg.params?.height === opt.height;
                      return (
                        <button
                          key={idx}
                          onClick={() => handleSelectSize(msg.id, opt)}
                          className={`px-2.5 py-1 text-xs rounded-full border transition-all ${
                            isSelected
                              ? 'bg-blue-50 border-blue-500 text-blue-600 font-medium shadow-xs'
                              : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-100'
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* 提交執行按鈕 */}
                <button
                  disabled={msg.isGenerating}
                  onClick={() => handleDispatch(msg)}
                  className="mt-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white text-xs font-medium rounded-md shadow-xs flex items-center transition-all"
                >
                  {msg.isGenerating ? (
                    <span> ComfyUI 繪製中...</span>
                  ) : (
                    <span>開始生成 ({msg.params?.width} x {msg.params?.height})</span>
                  )}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* 輸入框 */}
      <div className="flex gap-2 bg-white p-2 border border-gray-200 rounded-xl shadow-xs">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder="請輸入描述（例如：畫一張吉普力風格的森林少女）"
          className="flex-1 px-3 py-2 text-sm focus:outline-none"
        />
        <button
          disabled={loading}
          onClick={handleSend}
          className="px-4 py-2 bg-gray-900 hover:bg-black text-white text-sm rounded-lg transition-all"
        >
          {loading ? '分析中...' : '傳送'}
        </button>
      </div>
    </div>
  );
};