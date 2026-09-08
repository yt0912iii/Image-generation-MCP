import React from 'react';
import { Download, PlusCircle, Image as ImageIcon } from 'lucide-react';
import { GenerationTask } from '../types';

export interface GalleryItem {
  id: string;
  title: string;
  type: 'image' | 'video';
  url: string;
  prompt: string;
  workflowName: string;
  timestamp: string;
}

interface MediaCanvasProps {
  currentTask: GenerationTask | null;
  galleryItems: GalleryItem[];
  onReRunTask?: () => void;
  onSelectImageAsReference?: (imageUrl: string) => void;
}

export const MediaCanvas: React.FC<MediaCanvasProps> = ({
  currentTask,
  galleryItems,
  onSelectImageAsReference,
}) => {
  const isVideo = currentTask?.outputType === 'video';
  const hasOutput = !!currentTask?.outputUrl;

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 shadow-xl space-y-4">
      {/* 主成果預覽區 */}
      <div className="relative aspect-video bg-zinc-950 rounded-xl overflow-hidden border border-zinc-800 flex items-center justify-center group">
        {hasOutput ? (
          isVideo ? (
            <video
              src={currentTask.outputUrl}
              controls
              autoPlay
              loop
              className="w-full h-full object-contain"
            />
          ) : (
            <img
              src={currentTask.outputUrl}
              alt="Generated Media"
              className="w-full h-full object-contain"
            />
          )
        ) : (
          <div className="flex flex-col items-center justify-center text-zinc-600 gap-2 text-xs font-mono">
            <ImageIcon className="w-8 h-8 stroke-1" />
            <span>尚未有產出媒體</span>
          </div>
        )}

        {/* 🎯 主畫布懸浮「帶入對話框」按鈕 */}
        {hasOutput && !isVideo && onSelectImageAsReference && (
          <div className="absolute bottom-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity bg-zinc-950/80 backdrop-blur-md p-1.5 rounded-xl border border-zinc-700/60 shadow-lg">
            <button
              onClick={() => onSelectImageAsReference(currentTask.outputUrl!)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-medium transition-all shadow cursor-pointer"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              <span>以此圖繼續對話 / 編輯</span>
            </button>
          </div>
        )}
      </div>

      {/* 歷史藝廊清單 */}
      <div>
        <div className="flex items-center justify-between mb-2.5">
          <h4 className="text-xs font-bold text-zinc-400 font-mono">歷史藝廊 (點擊圖片可直接帶入對話框)</h4>
          <span className="text-[10px] text-zinc-500 font-mono">共 {galleryItems.length} 項</span>
        </div>

        <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
          {galleryItems.map((item) => (
            <div
              key={item.id}
              onClick={() => {
                // 🎯 點擊靜態圖片即帶入左側對話框附加欄
                if (item.type === 'image' && onSelectImageAsReference) {
                  onSelectImageAsReference(item.url);
                }
              }}
              title={item.type === 'image' ? '點擊將此圖帶入對話框作為參考圖' : item.title}
              className="group relative aspect-square bg-zinc-950 rounded-lg overflow-hidden border border-zinc-800 hover:border-purple-500 transition-all cursor-pointer"
            >
              {item.type === 'video' ? (
                <video src={item.url} className="w-full h-full object-cover" />
              ) : (
                <img src={item.url} alt={item.title} className="w-full h-full object-cover" />
              )}

              {/* 圖片 hover 提示 */}
              {item.type === 'image' && (
                <div className="absolute inset-0 bg-purple-950/70 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center p-1 text-center">
                  <PlusCircle className="w-4 h-4 text-purple-300 mb-0.5" />
                  <span className="text-[10px] text-purple-100 font-medium leading-tight">帶入對話框</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};