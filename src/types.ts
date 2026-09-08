export interface GpuStatus {
  name: string;
  vramUsedGb: number;
  vramTotalGb: number;
  loadPercent: number;
  temperatureC: number;
  activeJobsCount: number;
  comfyConnected: boolean;
  comfyHost: string;
}

export interface GenerationResult {
  success: boolean;
  outputUrl?: string;
  outputType?: 'image' | 'video';
  message?: string;
  executionTimeMs?: number;
}

export interface ComfyUINodeInfo {
  id: string;
  class_type: string;
  title: string;
  inputs: Record<string, any>;
}

export interface GenerationTask {
  id: string;
  status: 'pending' | 'generating' | 'completed' | 'failed';
  workflowId?: string;
  workflowName?: string;
  promptUsed?: string;
  negativePromptUsed?: string;
  promptId?: string;
  outputType?: 'image' | 'video';
  timestamp?: string;
  outputUrl?: string;
  progress?: number;
  currentStep?: number;
  totalSteps?: number;
  currentExecutingNode?: string;
  params?: {
    width?: number;
    height?: number;
    videoDuration?: number;
    [key: string]: any;
  };
}

export interface QueueTaskItem extends GenerationTask {}

export type AvatarState = 'idle' | 'thinking' | 'speaking' | 'generating' | 'completed' | 'failed';

export interface AvatarPreset {
  id: string;
  name?: string;
  title?: string;
  gender?: 'male' | 'female' | string;
  avatarUrl?: string;
  voiceName?: string;
  filename?: string;
  url?: string;
  prompt?: string;
  [key: string]: any;
}

export interface ComfyWorkflow {
  id: string;
  name: string;
  description?: string;
  nodes?: any;
  [key: string]: any;
}