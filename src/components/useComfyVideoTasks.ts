import { useEffect, useRef, useState, useCallback } from 'react';

export interface VideoTask {
  id: string;
  promptId?: string;
  workflowName: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  outputUrl?: string;
  queuePosition?: number;
  createdAt: string;
  executionTimeMs?: number;
  errorMessage?: string;
}

interface ComfyQueueResponse {
  queue_running: Array<[number, string, any, any, any]>;
  queue_pending: Array<[number, string, any, any, any]>;
}

export function useComfyVideoTasks(comfyHost: string = '127.0.0.1:8188') {
  const [tasks, setTasks] = useState<VideoTask[]>([]);
  const [comfyActiveJobs, setComfyActiveJobs] = useState<number>(0);
  const [comfyConnected, setComfyConnected] = useState<boolean>(false);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const clientId = useRef<string>(`client_${Math.random().toString(36).substring(2, 9)}`);

  // 1. 同步 ComfyUI /queue 隊列狀態
  const fetchQueueStatus = useCallback(async () => {
    try {
      const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
      const httpProtocol = isHttps ? 'https:' : 'http:';
      const cleanHost = comfyHost.replace(/^https?:\/\//, '').replace(/\/+$/, '');
      const url = `${httpProtocol}//${cleanHost}/queue`;

      const res = await fetch(url);
      if (res.ok) {
        const queueData: ComfyQueueResponse = await res.json();
        const running = queueData.queue_running || [];
        const pending = queueData.queue_pending || [];

        setComfyActiveJobs(running.length + pending.length);
        setComfyConnected(true);

        setTasks((prevTasks) =>
          prevTasks.map((task) => {
            if (!task.promptId || task.status === 'completed' || task.status === 'failed') {
              return task;
            }

            const isRunning = running.some((item) => item[1] === task.promptId);
            const pendingIndex = pending.findIndex((item) => item[1] === task.promptId);

            if (isRunning) {
              return { ...task, status: 'running', queuePosition: 0 };
            }
            if (pendingIndex !== -1) {
              return { ...task, status: 'queued', queuePosition: pendingIndex + 1 };
            }
            return task;
          })
        );
      }
    } catch {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        setComfyConnected(false);
      }
    }
  }, [comfyHost]);

  // 2. 建立 WebSocket 連線與訊息處理
  const connectWebSocket = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }

    const cleanHost = comfyHost.replace(/^https?:\/\//, '').replace(/^wss?:\/\//, '').replace(/\/+$/, '');
    const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
    const wsProtocol = isHttps ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${cleanHost}/ws?clientId=${clientId.current}`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setComfyConnected(true);
        fetchQueueStatus();
      };

      ws.onclose = () => {
        setComfyConnected(false);
        reconnectTimeoutRef.current = setTimeout(() => {
          connectWebSocket();
        }, 3000);
      };

      ws.onerror = () => {
        setComfyConnected(false);
        ws.close();
      };

      ws.onmessage = (event) => {
        if (typeof event.data !== 'string') return;
        try {
          const message = JSON.parse(event.data);
          const { type, data: payload } = message;

          const httpProtocol = isHttps ? 'https:' : 'http:';
          const baseUrl = `${httpProtocol}//${cleanHost}`;

          switch (type) {
            case 'status': {
              const remaining = payload?.status?.exec_info?.queue_remaining ?? 0;
              setComfyActiveJobs(remaining);
              break;
            }

            case 'execution_start': {
              const promptId = payload?.prompt_id;
              if (promptId) {
                setTasks((prev) =>
                  prev.map((t) => (t.promptId === promptId ? { ...t, status: 'running', queuePosition: 0 } : t))
                );
              }
              break;
            }

            case 'executed': {
              const promptId = payload?.prompt_id;
              const output = payload?.output;
              let mediaUrl: string | undefined;

              if (output?.images && output.images.length > 0) {
                const img = output.images[0];
                mediaUrl = `${baseUrl}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder || '')}&type=${img.type || 'output'}`;
              } else if (output?.gifs && output.gifs.length > 0) {
                const gif = output.gifs[0];
                mediaUrl = `${baseUrl}/view?filename=${encodeURIComponent(gif.filename)}&subfolder=${encodeURIComponent(gif.subfolder || '')}&type=${gif.type || 'output'}`;
              } else if (output?.videos && output.videos.length > 0) {
                const vid = output.videos[0];
                mediaUrl = `${baseUrl}/view?filename=${encodeURIComponent(vid.filename)}&subfolder=${encodeURIComponent(vid.subfolder || '')}&type=${vid.type || 'output'}`;
              }

              if (promptId && mediaUrl) {
                setTasks((prev) =>
                  prev.map((t) => {
                    if (t.promptId === promptId) {
                      const startTime = new Date(t.createdAt).getTime();
                      const execTime = !Number.isNaN(startTime) ? Date.now() - startTime : undefined;
                      return {
                        ...t,
                        status: 'completed',
                        outputUrl: mediaUrl,
                        executionTimeMs: execTime,
                      };
                    }
                    return t;
                  })
                );
              }
              break;
            }

            case 'execution_error': {
              const promptId = payload?.prompt_id;
              if (promptId) {
                setTasks((prev) =>
                  prev.map((t) =>
                    t.promptId === promptId
                      ? {
                          ...t,
                          status: 'failed',
                          errorMessage: payload?.exception_message || 'ComfyUI 節點執行失敗',
                        }
                      : t
                  )
                );
              }
              break;
            }

            default:
              break;
          }
        } catch (err) {
          console.error('[ComfyUI WS] 解析訊息失敗:', err);
        }
      };
    } catch (err) {
      console.error('[ComfyUI WS] 建立連線失敗:', err);
      setComfyConnected(false);
      reconnectTimeoutRef.current = setTimeout(() => {
        connectWebSocket();
      }, 3000);
    }
  }, [comfyHost, fetchQueueStatus]);

  useEffect(() => {
    connectWebSocket();
    const interval = setInterval(fetchQueueStatus, 5000);

    return () => {
      clearInterval(interval);
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [connectWebSocket, fetchQueueStatus]);

  // 新增任務至列表
  const addTrackedTask = useCallback((task: Omit<VideoTask, 'createdAt' | 'id'> & { id?: string }) => {
    const newTask: VideoTask = {
      id: task.id || `task_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      ...task,
      createdAt: new Date().toISOString(),
    };
    setTasks((prev) => [newTask, ...prev]);
    return newTask.id;
  }, []);

  // 更新指定任務（當 fetch 回應成功時直接覆蓋）
  const updateTrackedTask = useCallback((promptIdOrTaskId: string, updates: Partial<VideoTask>) => {
    setTasks((prev) =>
      prev.map((t) =>
        t.id === promptIdOrTaskId || t.promptId === promptIdOrTaskId
          ? { ...t, ...updates }
          : t
      )
    );
  }, []);

  const removeTask = useCallback((taskId: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
  }, []);

  const clearCompletedTasks = useCallback(() => {
    setTasks((prev) => prev.filter((t) => t.status === 'queued' || t.status === 'running'));
  }, []);

  return {
    tasks,
    comfyActiveJobs,
    comfyConnected,
    addTrackedTask,
    updateTrackedTask,
    removeTask,
    clearCompletedTasks,
    refreshQueue: fetchQueueStatus,
  };
}