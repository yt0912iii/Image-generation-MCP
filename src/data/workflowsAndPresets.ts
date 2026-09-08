export interface AvatarPreset {
  id: string;
  name: string;
  description: string;
  avatarUrl: string;
  greeting: string;
  style: string;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  icon: 'image' | 'video' | 'music' | 'voice';
  category: 'image' | 'video' | 'audio' | 'voice';
  nodeCount?: number;
  tags?: string[];
}

export interface WorkflowParamMap {
  nodeIds: Record<string, Record<string, any>>;
  outputPrefix: string;
}

export interface GalleryItem {
  id: string;
  type: 'image' | 'video' | 'audio';
  url: string;
  title: string;
  workflow: string;
  prompt: string;
  timestamp: string;
}

export interface GenerationTask {
  id: string;
  workflowId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  progress: number;
  currentStep: number;
  totalSteps: number;
  currentExecutingNode: string;
  promptUsed: string;
  negativePromptUsed?: string;
  params: Record<string, any>;
  outputType: 'image' | 'video' | 'audio' | 'text';
  outputUrl?: string;
  avatarResponse: { text: string; images?: string[]; videos?: string[]; audio?: string[] };
  timestamp: string;
  executionTimeMs?: number;
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'avatar';
  text: string;
  timestamp: string;
  images?: string[];
  videos?: string[];
  audio?: string[];
}

export interface GenerationResult {
  success: boolean;
  outputType: 'image' | 'video' | 'audio' | 'text';
  outputUrl?: string;
  avatarResponse: { text: string; images?: string[]; videos?: string[]; audio?: string[] };
  executionTimeMs?: number;
}

export type AvatarState = 'idle' | 'thinking' | 'speaking' | 'error';

export interface GpuStatus {
  name: string;
  memoryTotal: number;
  memoryUsed: number;
  memoryPercentage: number;
  temperature?: number;
  utilization?: number;
}

export interface ComfyWorkflow {
  id: string;
  name: string;
  description: string;
  nodes: number;
  parameters: string[];
}

export const AVATAR_PRESETS: AvatarPreset[] = [
  {
    id: 'maya',
    name: '瑪雅',
    description: '專業藝術創作助手',
    avatarUrl: 'https://api.dicebear.com/9.x/bottts-neutral/svg?seed=Maya',
    greeting: '你好！我是瑪雅，你的藝術創作助手。',
    style: 'professional',
  },
  {
    id: 'hikari',
    name: '光',
    description: '活潑可愛的創作夥伴',
    avatarUrl: 'https://api.dicebear.com/9.x/bottts-neutral/svg?seed=Hikari',
    greeting: '嗨嗨！我是光，讓我們一起創作吧！',
    style: 'cute',
  },
  {
    id: 'victoria',
    name: '維多利亞',
    description: '優雅成熟的藝術顧問',
    avatarUrl: 'https://api.dicebear.com/9.x/bottts-neutral/svg?seed=Victoria',
    greeting: '您好，我是維多利亞，很高興為您服務。',
    style: 'elegant',
  },
  {
    id: 'ethan',
    name: '伊森',
    description: '技術導向的創作專家',
    avatarUrl: 'https://api.dicebear.com/9.x/bottts-neutral/svg?seed=Ethan',
    greeting: '你好，我是伊森，準備好為你創作。',
    style: 'tech',
  },
];

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  { id: 'flux_t2i', name: 'FLUX 文字轉圖', description: '使用 FLUX 模型從文字生成高品質圖片', icon: 'image', category: 'image', nodeCount: 3, tags: ['image', 'flux'] },
  { id: 'qwen_image_2512_4step', name: 'Qwen Image 2512 4步', description: 'Qwen Image 2512 快速生成（4步）', icon: 'image', category: 'image', nodeCount: 3, tags: ['image', 'qwen'] },
  { id: 'qwen_image_edit_2511', name: 'Qwen Image 編輯', description: '使用 Qwen Image Edit 2511 編輯圖片', icon: 'image', category: 'image', nodeCount: 1, tags: ['image', 'edit', 'qwen'] },
  { id: 'ltx23_i2v', name: 'LTX2.3 圖轉影片', description: '使用 LTX2.3 模型將圖片轉為影片', icon: 'video', category: 'video', nodeCount: 2, tags: ['video', 'ltx'] },
  { id: 'video_ltx2_3_i2v', name: 'LTX2.3 影片生成', description: 'LTX2.3 文字/圖片轉影片（原生 ComfyUI）', icon: 'video', category: 'video', nodeCount: 2, tags: ['video', 'ltx'] },
  { id: 'next_scene_v2', name: 'Next Scene V2', description: '下一場景生成（角色一致性）', icon: 'video', category: 'video', nodeCount: 1, tags: ['video', 'character'] },
  { id: 'image_z_image_turbo', name: 'Z Image Turbo', description: 'Z Image Turbo 快速圖片生成', icon: 'image', category: 'image', nodeCount: 1, tags: ['image', 'turbo'] },
  { id: 'mmaudio', name: 'MM-Audio', description: '多媒體音訊生成', icon: 'music', category: 'audio', nodeCount: 1, tags: ['audio', 'music'] },
  { id: 'qwen3tts', name: 'Qwen3 TTS', description: 'Qwen3 文字轉語音', icon: 'voice', category: 'voice', nodeCount: 1, tags: ['voice', 'tts'] },
  { id: 'generate_music', name: 'Generate Music', description: 'Generate Music 音樂生成', icon: 'music', category: 'audio', nodeCount: 1, tags: ['audio', 'music'] },
];

export const WORKFLOW_PARAM_MAPS: Record<string, WorkflowParamMap> = {
  'flux_t2i': {
    nodeIds: {
      '17': { noise_seed: '{{seed}}' },
      '27': { text: '{{prompt}}' },
      '5': { width: '{{width}}', height: '{{height}}' },
    },
    outputPrefix: 'model',
  },
  'qwen_image_2512_4step': {
    nodeIds: {
      '17': { noise_seed: '{{seed}}' },
      '40': { text: '{{prompt}}' },
      '53': { text: '{{negativePrompt}}' },
      '58': { width: '{{width}}', height: '{{height}}' },
    },
    outputPrefix: 'QwenImage',
  },
  'qwen_image_edit_2511': {
    nodeIds: {
      '89:69': { text: '{{prompt}}' },
      '89:68': { text: '{{negativePrompt}}' },
    },
    outputPrefix: 'ComfyUI',
  },
  'ltx23_i2v': {
    nodeIds: {
      '671': { text: '{{prompt}}' },
    },
    outputPrefix: 'LTX2.3',
  },
  'video_ltx2_3_i2v': {
    nodeIds: {
      '470': { text: '{{prompt}}' },
      '645': { text: '{{negativePrompt}}' },
      '304': { width: '{{width}}' },
      '315': { height: '{{height}}' },
    },
    outputPrefix: 'video',
  },
  'next_scene_v2': {
    nodeIds: {
      '129': { text: '{{prompt}}' },
    },
    outputPrefix: 'flux',
  },
  'image_z_image_turbo': {
    nodeIds: {
      '115': { text: '{{prompt}}' },
    },
    outputPrefix: 'AvaClaw',
  },
  'image_z_image_turbo_fixed': {
    nodeIds: {
      '51': { text: '{{prompt}}' },
    },
    outputPrefix: 'ComfyUI',
  },
  'mmaudio': {
    nodeIds: {
      '10': { prompt: '{{prompt}}' },
      '11': { prompt: '{{negativePrompt}}' },
    },
    outputPrefix: 'AnimateDiff',
  },
  'qwen3tts': {
    nodeIds: {
      '17': { text: '{{prompt}}' },
    },
    outputPrefix: 'qwen3tts',
  },
  'generate_music': {
    nodeIds: {
      '15': { tags: '{{prompt}}' },
    },
    outputPrefix: 'ComfyUI',
  },
};

export const INITIAL_GALLERY_ITEMS: GalleryItem[] = [
  {
    id: 'gallery_1',
    type: 'image',
    url: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1200&q=80',
    title: 'FLUX 生成 - 賽博朋克風格',
    workflow: 'flux_t2i',
    prompt: 'A breathtaking photorealistic cyberpunk portrait, soft lighting, sharp focus, 8k resolution',
    timestamp: new Date().toLocaleTimeString('zh-TW', { hour12: false, hour: '2-digit', minute: '2-digit' }),
  },
  {
    id: 'gallery_2',
    type: 'image',
    url: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?auto=format&fit=crop&w=1200&q=80',
    title: 'Qwen Image 生成 - 動漫風格',
    workflow: 'qwen_image_2512_4step',
    prompt: 'An anime-style character with vibrant colors, detailed background, studio quality',
    timestamp: new Date().toLocaleTimeString('zh-TW', { hour12: false, hour: '2-digit', minute: '2-digit' }),
  },
];
