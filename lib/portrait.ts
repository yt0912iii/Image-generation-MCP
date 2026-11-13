// 數位員工頭像（文生圖）共用流程：敏感詞檢查 → 中文提示詞轉譯 → FLUX 工作流 → 取回圖片。
// 頭像 HTTP API（lib/portrait-http.ts）只走這條路徑；不提供圖生圖、修圖或放大。

import fs from 'fs';
import path from 'path';
import * as OpenCC from 'opencc-js';

export type PortraitErrorCode =
  | 'INVALID_ARGUMENT'
  | 'BLOCKED_PROMPT'
  | 'WORKFLOW_INVALID'
  | 'COMFYUI_UNAVAILABLE'
  | 'COMFYUI_REJECTED'
  | 'COMFYUI_FAILED'
  | 'GENERATION_TIMEOUT'
  | 'CANCELLED'
  | 'OUTPUT_MISSING'
  | 'IMAGE_FETCH_FAILED';

export class PortraitError extends Error {
  constructor(public code: PortraitErrorCode, message: string) {
    super(message);
    this.name = 'PortraitError';
  }
}

export interface PortraitConfig {
  comfyuiUrl: string;
  workflowFile: string;
  /** 敏感詞庫檔案清單，見 createKeywordFilter */
  lexiconFiles: string[];
  whitelistFile?: string;
  vllmUrl: string;
  vllmModel: string;
  ollamaUrl: string;
  ollamaModel: string;
  timeoutMs: number;
  pollIntervalMs: number;
  translateTimeoutMs: number;
  maxImageBytes: number;
}

export interface PortraitRequest {
  prompt: string;
  width?: number;
  height?: number;
  seed?: number;
  /** 客戶端取消時中止等待，並從 ComfyUI 佇列移除工作 */
  signal?: AbortSignal;
  onProgress?: (elapsedMs: number, totalMs: number, message: string) => void | Promise<void>;
}

export interface PortraitResult {
  image: Buffer;
  mimeType: string;
  englishPrompt: string;
  translated: boolean;
  translationProvider?: 'vLLM' | 'Ollama';
  seed: number;
  width: number;
  height: number;
  elapsedMs: number;
}

export const PORTRAIT_LIMITS = {
  maxPromptLength: 1000,
  minSize: 256,
  maxSize: 2048,
  defaultSize: 1024,
  maxSeed: Number.MAX_SAFE_INTEGER,
};

// FLUX_t2i.json 中需要替換的節點
const NODE_LATENT = '5';
const NODE_SAVE = '9';
const NODE_NOISE = '17';
const NODE_PROMPT = '27';

// 翻譯只負責「忠實轉成英文」；構圖與畫質詞由程式固定補上（見 finalizePrompt），
// 避免模型自行加入原文沒有的髮型、眼鏡、服裝等特徵。
const TRANSLATE_SYSTEM = `You translate Chinese image descriptions (usually a character or avatar) into an English image prompt for FLUX.1.

Rules:
1. Translate faithfully. Keep every attribute the user wrote: subject, species, gender, age, hair, eyes, glasses, clothing, accessories, colors, expression, pose, art style, background, lighting.
2. NEVER add an attribute the user did not write. Do not invent hair, glasses, clothing, accessories, colors, gender, age or expression. If the subject is an animal, do not give it human hair.
3. Output ONE line of comma-separated English phrases, subject first. No Chinese characters, no quotes, no explanation, no markdown, no line breaks.
4. Do not add quality tags such as "8k", "masterpiece" or "highly detailed"; they are added later.`;

const TRANSLATE_EXAMPLES: [string, string][] = [
  [
    '一隻戴著發光霓虹藍耳機的摺耳貓工程師，極簡 3D 黏土風格，純白背景',
    'a Scottish fold cat engineer wearing glowing neon blue headphones, minimalist 3D clay style, pure white background',
  ],
  [
    '二次元英倫執事風格的青年智囊，深藍色合身西裝與單片眼鏡，溫文儒雅微笑',
    'a young British-butler-style strategist, anime style, well-fitted dark blue suit, monocle, gentle and refined smile',
  ],
  [
    '戴金框眼鏡的資深財務分析師，深灰色西裝，溫和微笑，柔和棚拍光',
    'a senior financial analyst wearing gold-rimmed glasses, dark gray suit, warm gentle smile, soft studio lighting',
  ],
  ['可愛的柴犬客服專員，戴耳機', 'a cute Shiba Inu customer service agent wearing a headset'],
];

const PORTRAIT_SUFFIX = 'avatar portrait, centered head and shoulders composition, highly detailed';
const DEFAULT_BACKGROUND = 'clean soft studio background';

// ==========================================
// 敏感詞檢查
// 詞庫為簡體：輸入先由繁轉簡再比對。中日文詞以子字串比對；
// 英數詞以單字邊界比對，避免 gore 誤擋 gorgeous。
// ==========================================

const toSimplified = OpenCC.Converter({ from: 'tw', to: 'cn' });
const toSimplifiedHk = OpenCC.Converter({ from: 'hk', to: 'cn' });

interface KeywordSet {
  cjk: string[];
  ascii: { word: string; pattern: RegExp }[];
  size: number;
}

function fileSignature(files: string[]): string {
  return files
    .map((file) => {
      try {
        return `${file}:${fs.statSync(file).mtimeMs}`;
      } catch {
        return `${file}:missing`;
      }
    })
    .join('|');
}

function readWordFile(file: string): string[] {
  const raw = fs.readFileSync(file, 'utf-8').replace(/^\uFEFF/, '');
  if (file.toLowerCase().endsWith('.json')) {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error(`${path.basename(file)} 必須是字串陣列`);
    return parsed.filter((w): w is string => typeof w === 'string');
  }
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

function normalizeWord(word: string): string {
  return toSimplifiedHk(toSimplified(word)).toLowerCase().replace(/\s+/g, ' ').trim();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface KeywordFilterOptions {
  /** 詞庫檔（.txt 一行一詞、# 為註解；或 .json 字串陣列）。缺檔視為錯誤。 */
  lexiconFiles: string[];
  /** 白名單（可選，缺檔略過） */
  whitelistFile?: string;
}

export function createKeywordFilter(options: KeywordFilterOptions) {
  const watched = options.whitelistFile ? [...options.lexiconFiles, options.whitelistFile] : options.lexiconFiles;
  let cache: { signature: string; set: KeywordSet } | null = null;

  function load(): KeywordSet {
    const signature = fileSignature(watched);
    if (cache && cache.signature === signature) return cache.set;
    try {
      const whitelist = new Set<string>();
      if (options.whitelistFile && fs.existsSync(options.whitelistFile)) {
        for (const word of readWordFile(options.whitelistFile)) whitelist.add(normalizeWord(word));
      }
      const words = new Set<string>();
      for (const file of options.lexiconFiles) {
        if (!fs.existsSync(file)) throw new Error(`找不到詞庫 ${file}`);
        for (const word of readWordFile(file)) {
          const normalized = normalizeWord(word);
          if (normalized && !whitelist.has(normalized)) words.add(normalized);
        }
      }
      const set: KeywordSet = { cjk: [], ascii: [], size: 0 };
      for (const word of words) {
        if (/^[\x00-\x7F]+$/.test(word)) {
          if (word.length < 3) continue; // 過短的英數詞誤擋率太高
          set.ascii.push({ word, pattern: new RegExp(`(^|[^a-z0-9])${escapeRegExp(word)}($|[^a-z0-9])`) });
        } else {
          const compact = word.replace(/\s+/g, '');
          if (compact.length >= 2) set.cjk.push(compact);
        }
      }
      set.size = set.cjk.length + set.ascii.length;
      cache = { signature, set };
      console.error(`[Portrait] 已載入敏感詞 ${set.size} 筆（${options.lexiconFiles.length} 個詞庫）`);
      return set;
    } catch (err) {
      if (cache) {
        console.error(`[Portrait] 詞庫重新載入失敗，沿用上一份：${(err as Error).message}`);
        return cache.set;
      }
      throw err;
    }
  }

  return {
    /** 回傳第一個命中的詞；沒有命中回傳 null */
    findBlocked(text: string): string | null {
      const normalized = normalizeWord(text);
      if (!normalized) return null;
      const compact = normalized.replace(/\s+/g, '');
      const set = load();
      for (const word of set.cjk) {
        if (compact.includes(word)) return word;
      }
      for (const { word, pattern } of set.ascii) {
        if (pattern.test(normalized)) return word;
      }
      return null;
    },
    preload(): void {
      load();
    },
  };
}

// ==========================================
// 提示詞轉譯（vLLM → Ollama；皆失敗則沿用原文）
// ==========================================

function cleanTranslation(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```(?:json|markdown|text)?/gi, '')
    .replace(/```/g, '')
    .replace(/^(Output|Prompt|Here is the prompt)\s*:\s*/i, '')
    .replace(/^["'\s]+|["'\s]+$/g, '')
    .trim();
}

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

function buildMessages(prompt: string): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: 'system', content: TRANSLATE_SYSTEM }];
  for (const [zh, en] of TRANSLATE_EXAMPLES) {
    messages.push({ role: 'user', content: zh }, { role: 'assistant', content: en });
  }
  messages.push({ role: 'user', content: prompt });
  return messages;
}

async function chatWithVllm(config: TranslatorConfig, messages: ChatMessage[]): Promise<string> {
  const response = await fetch(`${config.vllmUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.vllmModel,
      messages,
      temperature: 0.1,
      max_tokens: 300,
      // Qwen3 系列：關閉思考模式；不支援的模板會忽略此參數
      chat_template_kwargs: { enable_thinking: false },
    }),
    signal: AbortSignal.timeout(config.translateTimeoutMs),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  return String(data?.choices?.[0]?.message?.content ?? '');
}

async function chatWithOllama(config: TranslatorConfig, messages: ChatMessage[]): Promise<string> {
  const body: Record<string, unknown> = {
    model: config.ollamaModel,
    messages,
    stream: false,
    options: { temperature: 0.1, num_predict: 300 },
  };
  const send = () =>
    fetch(`${config.ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.translateTimeoutMs),
    });
  // 支援思考模式的模型（qwen3 等）先關閉思考；不支援的模型會回 400，改用不帶 think 的請求
  body.think = false;
  let response = await send();
  if (response.status === 400) {
    delete body.think;
    response = await send();
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  return String(data?.message?.content ?? '');
}

const CJK_PATTERN = /[぀-ヿ㐀-鿿가-힯豈-﫿＀-￯]/;

/** 回傳問題描述；可接受時回傳 null */
function translationProblem(text: string): string | null {
  if (!text) return 'empty output';
  if (CJK_PATTERN.test(text)) return 'output still contains Chinese characters';
  if (text.length > 600) return 'output is too long';
  if (!/[a-z]{3,}/i.test(text)) return 'output is not an English prompt';
  return null;
}

/** 補上固定的構圖、背景與畫質詞，並去除重複 */
export function finalizePrompt(text: string): string {
  const phrases = text
    .replace(/\s+/g, ' ')
    .replace(/[.。]+$/, '')
    .split(/\s*,\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  const lower = phrases.join(', ').toLowerCase();
  if (!/\bbackground\b|\bbackdrop\b/.test(lower)) phrases.push(DEFAULT_BACKGROUND);
  for (const extra of PORTRAIT_SUFFIX.split(', ')) {
    if (!lower.includes(extra.toLowerCase())) phrases.push(extra);
  }
  return phrases.join(', ');
}

export interface TranslationResult {
  text: string;
  translated: boolean;
  provider?: 'vLLM' | 'Ollama';
}

export type TranslatorConfig = Pick<
  PortraitConfig,
  'vllmUrl' | 'vllmModel' | 'ollamaUrl' | 'ollamaModel' | 'translateTimeoutMs'
>;

export interface TranslateOptions {
  /** true（預設）：補上頭像構圖與畫質詞；false：只回傳忠實翻譯（Web UI 一般生圖用） */
  portrait?: boolean;
}

export function containsCjk(text: string): boolean {
  return CJK_PATTERN.test(text);
}

export async function translatePrompt(
  config: TranslatorConfig,
  prompt: string,
  options: TranslateOptions = {}
): Promise<TranslationResult> {
  const finish = options.portrait === false ? (text: string) => text : finalizePrompt;
  if (!/[^\x00-\x7F]/.test(prompt)) return { text: finish(prompt), translated: false };

  const providers = [
    ['vLLM', chatWithVllm, Boolean(config.vllmUrl)],
    ['Ollama', chatWithOllama, Boolean(config.ollamaUrl)],
  ] as const;
  for (const [name, chat, enabled] of providers) {
    if (!enabled) continue;
    let messages = buildMessages(prompt);
    // 每個供應者最多兩次：第一次不合格時附上錯誤原因要求重寫
    for (let attempt = 1; attempt <= 2; attempt++) {
      let raw: string;
      try {
        raw = await chat(config, messages);
      } catch (err) {
        console.error(`[Portrait] ${name} 轉譯失敗：${(err as Error).message}`);
        break; // 連線或 HTTP 錯誤：直接換下一個供應者
      }
      const text = cleanTranslation(raw);
      const problem = translationProblem(text);
      if (!problem) return { text: finish(text), translated: true, provider: name };
      console.error(`[Portrait] ${name} 第 ${attempt} 次轉譯不合格：${problem}`);
      messages = [
        ...messages,
        { role: 'assistant', content: text },
        {
          role: 'user',
          content: `That is not acceptable (${problem}). Translate the same description again into English only, following the rules.`,
        },
      ];
    }
  }
  console.error('[Portrait] 轉譯皆失敗，改用原始提示詞');
  return { text: finish(prompt), translated: false };
}

// ==========================================
// ComfyUI 文生圖
// ==========================================

function detectMime(buffer: Buffer): string | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

function normalizeSize(value: unknown, name: string): number {
  if (value === undefined || value === null) return PORTRAIT_LIMITS.defaultSize;
  const n = Number(value);
  if (!Number.isFinite(n) || n < PORTRAIT_LIMITS.minSize || n > PORTRAIT_LIMITS.maxSize) {
    throw new PortraitError(
      'INVALID_ARGUMENT',
      `${name} 必須介於 ${PORTRAIT_LIMITS.minSize} 與 ${PORTRAIT_LIMITS.maxSize} 之間`
    );
  }
  return Math.round(n / 16) * 16;
}

function buildWorkflow(config: PortraitConfig, prompt: string, seed: number, width: number, height: number) {
  let workflow: Record<string, any>;
  try {
    workflow = JSON.parse(fs.readFileSync(config.workflowFile, 'utf-8'));
  } catch (err) {
    throw new PortraitError('WORKFLOW_INVALID', `無法讀取工作流 ${path.basename(config.workflowFile)}`);
  }
  for (const id of [NODE_LATENT, NODE_NOISE, NODE_PROMPT, NODE_SAVE]) {
    if (!workflow[id]?.inputs) {
      throw new PortraitError('WORKFLOW_INVALID', `工作流缺少節點 ${id}`);
    }
  }
  workflow[NODE_PROMPT].inputs.text = prompt;
  workflow[NODE_NOISE].inputs.noise_seed = seed;
  workflow[NODE_LATENT].inputs.width = width;
  workflow[NODE_LATENT].inputs.height = height;
  workflow[NODE_LATENT].inputs.batch_size = 1;
  return workflow;
}

async function comfyFetch(config: PortraitConfig, pathname: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(`${config.comfyuiUrl}${pathname}`, { ...init, signal: init?.signal ?? AbortSignal.timeout(30_000) });
  } catch (err) {
    throw new PortraitError('COMFYUI_UNAVAILABLE', `無法連線 ComfyUI：${(err as Error).message}`);
  }
}

async function cancelPrompt(config: PortraitConfig, promptId: string) {
  try {
    await comfyFetch(config, '/queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delete: [promptId] }),
    });
  } catch {
    // 盡力而為
  }
}

function firstImage(history: any): { filename: string; subfolder: string; type: string } | null {
  const outputs = history?.outputs;
  if (!outputs) return null;
  const ordered = [NODE_SAVE, ...Object.keys(outputs).filter((id) => id !== NODE_SAVE)];
  for (const id of ordered) {
    const image = outputs[id]?.images?.[0];
    if (image?.filename) return image;
  }
  return null;
}

async function fetchImage(config: PortraitConfig, ref: { filename: string; subfolder: string; type: string }) {
  const query = new URLSearchParams({
    filename: ref.filename,
    subfolder: ref.subfolder || '',
    type: ref.type || 'output',
  });
  const response = await comfyFetch(config, `/view?${query}`);
  if (!response.ok) {
    throw new PortraitError('IMAGE_FETCH_FAILED', `取回圖片失敗 (HTTP ${response.status})`);
  }
  const length = Number(response.headers.get('content-length') || 0);
  if (length > config.maxImageBytes) {
    throw new PortraitError('IMAGE_FETCH_FAILED', '圖片超過大小上限');
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0 || buffer.length > config.maxImageBytes) {
    throw new PortraitError('IMAGE_FETCH_FAILED', '圖片為空或超過大小上限');
  }
  const mimeType = detectMime(buffer);
  if (!mimeType) throw new PortraitError('IMAGE_FETCH_FAILED', 'ComfyUI 回傳的不是 PNG/JPEG/WebP 圖片');
  return { buffer, mimeType };
}

export function createPortraitGenerator(config: PortraitConfig) {
  const filter = createKeywordFilter({ lexiconFiles: config.lexiconFiles, whitelistFile: config.whitelistFile });

  function assertAllowed(text: string) {
    let hit: string | null;
    try {
      hit = filter.findBlocked(text);
    } catch (err) {
      // 詞庫無法使用時拒絕生成，不默默放行
      throw new PortraitError('BLOCKED_PROMPT', `敏感詞庫無法使用，暫停生成：${(err as Error).message}`);
    }
    if (hit) {
      throw new PortraitError('BLOCKED_PROMPT', '提示詞包含不允許的內容，請修改後再試');
    }
  }

  async function generate(request: PortraitRequest): Promise<PortraitResult> {
    const started = Date.now();
    const prompt = typeof request.prompt === 'string' ? request.prompt.trim() : '';
    if (!prompt) throw new PortraitError('INVALID_ARGUMENT', '缺少提示詞');
    if (prompt.length > PORTRAIT_LIMITS.maxPromptLength) {
      throw new PortraitError('INVALID_ARGUMENT', `提示詞不可超過 ${PORTRAIT_LIMITS.maxPromptLength} 字`);
    }
    const width = normalizeSize(request.width, 'width');
    const height = normalizeSize(request.height, 'height');
    let seed: number;
    if (request.seed === undefined || request.seed === null) {
      seed = Math.floor(Math.random() * 1_000_000_000_000);
    } else if (Number.isSafeInteger(request.seed) && request.seed >= 0) {
      seed = request.seed;
    } else {
      throw new PortraitError('INVALID_ARGUMENT', 'seed 必須是非負整數');
    }

    assertAllowed(prompt);
    const progress = async (message: string) => {
      try {
        await request.onProgress?.(Date.now() - started, config.timeoutMs, message);
      } catch {
        // 進度通知失敗不影響生成
      }
    };

    await progress('轉譯提示詞');
    const { text: englishPrompt, translated, provider: translationProvider } = await translatePrompt(config, prompt);
    if (translated) assertAllowed(englishPrompt);

    const workflow = buildWorkflow(config, englishPrompt, seed, width, height);
    await progress('送出 ComfyUI 工作');
    const submit = await comfyFetch(config, '/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow }),
    });
    if (!submit.ok) {
      const detail = (await submit.text().catch(() => '')).slice(0, 300);
      throw new PortraitError('COMFYUI_REJECTED', `ComfyUI 拒絕工作 (HTTP ${submit.status}) ${detail}`.trim());
    }
    const promptId = String((await submit.json().catch(() => null))?.prompt_id || '');
    if (!promptId) throw new PortraitError('COMFYUI_REJECTED', 'ComfyUI 未回傳 prompt_id');

    const deadline = started + config.timeoutMs;
    let history: any = null;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs));
      if (request.signal?.aborted) {
        await cancelPrompt(config, promptId);
        throw new PortraitError('CANCELLED', '客戶端已取消生成');
      }
      let response: Response;
      try {
        response = await comfyFetch(config, `/history/${encodeURIComponent(promptId)}`);
      } catch {
        continue; // 暫時性斷線，持續等待直到逾時
      }
      if (!response.ok) continue;
      const data = await response.json().catch(() => null);
      const entry = data?.[promptId];
      if (entry) {
        const status = entry.status?.status_str;
        if (status === 'error') {
          throw new PortraitError('COMFYUI_FAILED', 'ComfyUI 執行工作流失敗');
        }
        if (entry.status?.completed === false && status !== 'success') continue;
        history = entry;
        break;
      }
      await progress('ComfyUI 生成中');
    }
    if (!history) {
      await cancelPrompt(config, promptId);
      throw new PortraitError('GENERATION_TIMEOUT', `生成超過 ${Math.round(config.timeoutMs / 1000)} 秒`);
    }

    const ref = firstImage(history);
    if (!ref) throw new PortraitError('OUTPUT_MISSING', 'ComfyUI 已完成但沒有輸出圖片');
    await progress('取回圖片');
    const { buffer, mimeType } = await fetchImage(config, ref);

    return {
      image: buffer,
      mimeType,
      englishPrompt,
      translated,
      translationProvider,
      seed,
      width,
      height,
      elapsedMs: Date.now() - started,
    };
  }

  return { generate, preloadKeywords: () => filter.preload() };
}
