import React, { useState, useEffect } from 'react';
import { Header } from './components/Header';
import ImageGenerationView from './components/ImageGenerationView';
import { GpuStatus } from './types';

const BACKEND_URL = window.location.origin;

export default function App() {
  const [gpuStatus, setGpuStatus] = useState<GpuStatus>({
    name: 'ComfyUI 離線中',
    vramUsedGb: 0,
    vramTotalGb: 24.0,
    loadPercent: 0,
    temperatureC: 0,
    activeJobsCount: 0,
    comfyConnected: false,
    comfyHost: 'http://127.0.0.1:8188'
  });

  // 輪詢檢查 ComfyUI 連線狀態
  useEffect(() => {
    let isMounted = true;
    const fetchStatus = async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/api/comfyui/status`);
        if (res.ok && isMounted) {
          const data = await res.json();
          if (data.systemStats?.gpu) {
            setGpuStatus(data.systemStats.gpu);
          }
        } else if (isMounted) {
          setGpuStatus(prev => ({
            ...prev,
            comfyConnected: false,
            name: 'ComfyUI 離線中',
            vramUsedGb: 0,
            loadPercent: 0
          }));
        }
      } catch (e) {
        if (isMounted) {
          setGpuStatus(prev => ({
            ...prev,
            comfyConnected: false,
            name: 'ComfyUI 離線中',
            vramUsedGb: 0,
            loadPercent: 0
          }));
        }
      }
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 3000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans selection:bg-zinc-800 selection:text-zinc-100 relative">
      <Header
        gpuStatus={gpuStatus}
        onOpenSettings={() => {}}
        onOpenWorkflowsModal={() => {}}
        onRefreshStatus={() => {
          fetch(`${BACKEND_URL}/api/comfyui/status`)
            .then(res => res.json())
            .then(data => {
              if (data.systemStats?.gpu) setGpuStatus(data.systemStats.gpu);
            })
            .catch(() => {});
        }}
      />

      <main className="flex-1 max-w-[1600px] w-full mx-auto p-3 sm:p-5">
        <ImageGenerationView />
      </main>
    </div>
  );
}
