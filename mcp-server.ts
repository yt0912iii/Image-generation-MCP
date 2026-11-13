import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import { randomUUID, timingSafeEqual } from 'crypto';
import cors from 'cors';
import os from 'os';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { registerPortraitMcp } from './lib/portrait-mcp.ts';
import { containsCjk, translatePrompt, type TranslatorConfig } from './lib/portrait.ts';

// 載入專案根目錄的 .env（不存在時略過；已設定的環境變數優先）
try {
  process.loadEnvFile?.(path.join(process.cwd(), '.env'));
} catch {}

// 取得當前檔案目錄（同時相容 ESM 與 CJS 環境）
const __filenameResolved = typeof __filename !== 'undefined' ? __filename : fileURLToPath(import.meta.url);
const __dirnameResolved = typeof __dirname !== 'undefined' ? __dirname : path.dirname(__filenameResolved);

// 將所有 console.log 重導向到 stderr，避免破壞 MCP 的 JSON-RPC 通訊協議
console.log = (...args: unknown[]) => console.error(...args);

// 常數路徑與 URL 配置
const COMFYUI_URL = process.env.COMFYUI_URL || 'http://0.0.0.1:8188';
const COMFYUI_INPUT_DIR = process.env.COMFYUI_INPUT_DIR || path.join(process.cwd(), 'comfyui_input');
const COMFYUI_OUTPUT_DIR = process.env.COMFYUI_OUTPUT_DIR || path.join(process.cwd(), 'comfyui_output');

// vLLM configuration
const VLLM_URL = process.env.VLLM_URL || 'http://192.168.50.200:8787';
const VLLM_MODEL = process.env.VLLM_MODEL || 'cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit';

// Ollama（vLLM 離線時的後備）
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://0.0.0.1:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:7b';
// 頭像提示詞翻譯專用模型：qwen3.5:4b 在實測中最忠實且只佔約 3 GB VRAM，不易與 FLUX 搶顯存
const PORTRAIT_OLLAMA_MODEL = process.env.PORTRAIT_OLLAMA_MODEL || 'qwen3.5:4b';

// 伺服器綁定與存取控制
const HOST = process.env.HOST || '127.0.0.1';
const MCP_AUTH_TOKEN = (process.env.MCP_AUTH_TOKEN || '').trim();
const CORS_ORIGINS = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
// 其他電腦開啟 Web UI 時要輸入的密碼（帳號任意）；未設定時 Web UI 只限本機
const WEBUI_PASSWORD = process.env.WEBUI_PASSWORD || '';
// 這些路徑屬於 MCP，由 MCP_AUTH_TOKEN 保護，不套用 Web UI 密碼
const MCP_PATHS = new Set(['/mcp', '/sse', '/messages']);

function isLoopbackAddress(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function safeEqual(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// 頭像敏感詞使用的分類（data/Sensitive-lexicon/Vocabulary/<名稱>.txt），另加 data/portrait_blocklist.txt。
// 不用合併後的 blocked_keywords.json：其中的網易／騰訊通用詞庫會擋下「未來」「客服」「代表」等一般詞。
const PORTRAIT_LEXICON_CATEGORIES = (
  process.env.PORTRAIT_LEXICON_CATEGORIES || '色情类型,色情词库,暴恐词库,涉枪涉爆,反动词库,政治类型'
)
  .split(',')
  .map((name) => name.trim())
  .filter((name) => /^[^\\/.]+$/.test(name));

function positiveIntEnv(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function stripSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

// 常用比例對應的標準生成尺寸（適配 FLUX / SDXL）
const ASPECT_RATIO_MAP: Record<string, { width: number; height: number }> = {
  '16:9': { width: 1280, height: 720 },
  '9:16': { width: 720, height: 1280 },
  '4:3': { width: 1024, height: 768 },
  '3:4': { width: 768, height: 1024 },
  '1:1': { width: 1024, height: 1024 },
  '21:9': { width: 1344, height: 576 },
  '3:2': { width: 1152, height: 768 },
  '2:3': { width: 768, height: 1152 },
};

// 中文數字轉換輔助
const CN_NUM_MAP: Record<string, number> = {
  '一': 1, '二': 2, '兩': 2, '三': 3, '四': 4, '五': 5,
  '六': 6, '七': 7, '八': 8, '九': 9, '十': 10, '十六': 16, '二十一': 21,
};

// ==========================================
// 🚀 啟動時自動在背景執行 Python 敏感詞庫更新 (強化版)
// ==========================================
function updateLexiconInBackground(): void {
  // 1. 優先使用腳本自身的目錄，若無則依序檢查當前工作目錄
  const candidatePaths = [
    path.join(__dirnameResolved, 'update_lexicon.py'),
    path.join(process.cwd(), 'update_lexicon.py'),
    path.join(process.cwd(), 'scripts', 'update_lexicon.py'),
  ];

  let targetScriptPath: string | null = null;
  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      targetScriptPath = p;
      break;
    }
  }

  if (!targetScriptPath) {
    console.error('[Lexicon Updater] ❌ 找不到更新腳本 update_lexicon.py');
    console.error(`[Lexicon Updater] 搜尋過的路徑: \n${candidatePaths.join('\n')}`);
    return;
  }

  console.error(`[Lexicon Updater] 🚀 伺服器啟動，正在背景執行詞庫更新: ${targetScriptPath}`);

  // 2. 判斷作業系統與 Python 指令 (Windows 下必須使用 shell: true 才能正確讀取 PATH 中的 python)
  const isWin = process.platform === 'win32';
  const pyCmd = process.env.PYTHON_PATH || (isWin ? 'python' : 'python3');

  const child = spawn(pyCmd, [targetScriptPath], {
    cwd: path.dirname(targetScriptPath),
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
    shell: isWin,
  });

  child.stdout?.on('data', (data) => {
    process.stderr.write(`[Python Lexicon] ${data}`);
  });

  child.stderr?.on('data', (data) => {
    process.stderr.write(`[Python Lexicon Error] ${data}`);
  });

  child.on('close', (code) => {
    if (code === 0) {
      console.error('[Lexicon Updater] ✓ 敏感詞庫更新與白名單過濾成功完成！');
    } else {
      console.error(`[Lexicon Updater] ✗ 詞庫更新程序退出，結束代碼: ${code}`);
    }
  });

  child.on('error', (err) => {
    console.error(`[Lexicon Updater] ❌ 啟動 Python 失敗: ${err.message}`);
    console.error(`[Lexicon Updater] 提示: 請確認系統是否有安裝 Python 且已將 '${pyCmd}' 加入環境變數 PATH 中`);
  });
}

// 智慧解析文字中的尺寸與比例
function parseDimensions(text: string, defaultW = 768, defaultH = 1024): { width: number; height: number; hasSpecified: boolean } {
  if (!text) return { width: defaultW, height: defaultH, hasSpecified: false };

  const pixelMatch = text.match(/(\d{3,4})\s*[x*×]\s*(\d{3,4})/i);
  if (pixelMatch) {
    let w = parseInt(pixelMatch[1], 10);
    let h = parseInt(pixelMatch[2], 10);
    w = Math.round(w / 16) * 16;
    h = Math.round(h / 16) * 16;
    return { width: Math.max(64, w), height: Math.max(64, h), hasSpecified: true };
  }

  const ratioMatch = text.match(/(\d{1,2})\s*[:：比對到]\s*(\d{1,2})/);
  if (ratioMatch) {
    const key = `${ratioMatch[1]}:${ratioMatch[2]}`;
    if (ASPECT_RATIO_MAP[key]) {
      return { ...ASPECT_RATIO_MAP[key], hasSpecified: true };
    }
  }

  const cnRatioMatch = text.match(/(十六|二十一|[一二兩三四五六七八九十]+)\s*比\s*([一二兩三四五六七八九十]+)/);
  if (cnRatioMatch) {
    const n1 = CN_NUM_MAP[cnRatioMatch[1]];
    const n2 = CN_NUM_MAP[cnRatioMatch[2]];
    if (n1 && n2) {
      const key = `${n1}:${n2}`;
      if (ASPECT_RATIO_MAP[key]) {
        return { ...ASPECT_RATIO_MAP[key], hasSpecified: true };
      }
    }
  }

  if (/橫向|橫式|landscape/i.test(text)) {
    return { width: 1024, height: 768, hasSpecified: true };
  }
  if (/直向|直式|portrait/i.test(text)) {
    return { width: 768, height: 1024, hasSpecified: true };
  }
  if (/正方形|方形|square/i.test(text)) {
    return { width: 1024, height: 1024, hasSpecified: true };
  }

  return { width: defaultW, height: defaultH, hasSpecified: false };
}

// 支援 Base64、內部 API URL 以及外部網址轉存至 ComfyUI Input 目錄
async function resolveOrSaveImage(imageDataOrUrl: string, filename: string): Promise<string> {
  const fullPath = path.join(COMFYUI_INPUT_DIR, filename);

  if (imageDataOrUrl.startsWith('data:image')) {
    const base64 = imageDataOrUrl.split(',')[1];
    fs.writeFileSync(fullPath, base64, 'base64');
    return filename;
  }

  if (imageDataOrUrl.startsWith('/api/view-comfy') || imageDataOrUrl.startsWith('/comfyui_output')) {
    const urlMatch = imageDataOrUrl.match(/filename=([^&]+)/);
    const rawName = urlMatch ? decodeURIComponent(urlMatch[1]) : path.basename(imageDataOrUrl);

    const sourcePath = path.join(COMFYUI_OUTPUT_DIR, rawName);
    if (fs.existsSync(sourcePath)) {
      fs.copyFileSync(sourcePath, fullPath);
      return filename;
    }

    // FLUX 文生圖改用 PreviewImage 後，結果在 ComfyUI 的 temp；沿用網址上的 type
    const typeMatch = imageDataOrUrl.match(/[?&]type=(output|temp)(?:&|$)/);
    const subfolderMatch = imageDataOrUrl.match(/[?&]subfolder=([^&]*)/);
    const fetchUrl =
      `${COMFYUI_URL}/view?filename=${encodeURIComponent(rawName)}` +
      `&subfolder=${subfolderMatch ? subfolderMatch[1] : ''}&type=${typeMatch ? typeMatch[1] : 'output'}`;
    const res = await fetch(fetchUrl);
    if (res.ok) {
      const buffer = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(fullPath, buffer);
      return filename;
    }
  }

  if (imageDataOrUrl.startsWith('http://') || imageDataOrUrl.startsWith('https://')) {
    const response = await fetch(imageDataOrUrl);
    if (response.ok) {
      const arrayBuffer = await response.arrayBuffer();
      fs.writeFileSync(fullPath, Buffer.from(arrayBuffer));
      return filename;
    }
  }

  return imageDataOrUrl;
}

async function startServer() {
  const PORT = Number(process.env.PORT) || 8833;
  const app = express();

  if (!MCP_AUTH_TOKEN && !LOOPBACK_HOSTS.has(HOST)) {
    throw new Error(`HOST=${HOST} 會對外開放 MCP，請先設定 MCP_AUTH_TOKEN`);
  }

  // 1. 立即在背景啟動敏感詞庫更新程序
  updateLexiconInBackground();

  // 中間件設定
  // 外部連線的存取控制：MCP 端點由 Bearer Token 保護（見 lib/portrait-mcp.ts）；
  // Web UI 與其 API 從本機開啟不需密碼，從其他電腦開啟需輸入 WEBUI_PASSWORD（HTTP Basic）。
  app.use((req: Request, res: Response, next) => {
    if (MCP_PATHS.has(req.path) || isLoopbackAddress(req.socket.remoteAddress)) return next();
    if (!WEBUI_PASSWORD) {
      res.status(403).send('Web UI 僅限本機使用；如需讓其他電腦測試，請在 .env 設定 WEBUI_PASSWORD');
      return;
    }
    const match = /^Basic\s+(.+)$/i.exec(req.headers.authorization || '');
    if (match) {
      const decoded = Buffer.from(match[1], 'base64').toString('utf8');
      const password = decoded.slice(decoded.indexOf(':') + 1);
      if (safeEqual(password, WEBUI_PASSWORD)) return next();
    }
    res.setHeader('WWW-Authenticate', 'Basic realm="imagegenerate", charset="UTF-8"');
    res.status(401).send('需要登入');
  });

  // Web UI 與 API 同源；跨來源只開放 CORS_ORIGINS 列出的網址
  if (CORS_ORIGINS.length > 0) {
    app.use(cors({ origin: CORS_ORIGINS }));
  }
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  if (!fs.existsSync(COMFYUI_INPUT_DIR)) fs.mkdirSync(COMFYUI_INPUT_DIR, { recursive: true });
  if (!fs.existsSync(COMFYUI_OUTPUT_DIR)) fs.mkdirSync(COMFYUI_OUTPUT_DIR, { recursive: true });

  const LLM_DISPATCH_PROMPT = `你是一位專業的 ComfyUI 生成式 AI 數位人專員。
請分析使用者的輸入意圖與提供的上下文，將其分類至最適當的圖像工作流，並將提詞優化為高品質的英文 Prompt。

**可用工作流清單與觸發條件：**
1. 純對話/問對話 (Chat Only) -> workflowId: "chat_only"
2. FLUX 高品質文生圖 -> workflowId: "flux_t2i"
3. 吉普力風格轉換/文生圖 -> workflowId: "ghibli_style"
4. 圖像編輯修圖 -> workflowId: "image_edit"
5. 高清畫質放大 -> workflowId: "upscale"

**提示詞與參數解析規則：**
1. 尺寸檢測：使用者是否已在文字中指定尺寸/比例（如：768x1024、1024x768、直式、橫式、16:9、4:3、4比3）？若有，請解析並填入 width 與 height，且 hasSpecifiedSize 設為 true；若無指定，width 與 height 填 -1，hasSpecifiedSize 設為 false。

**必須回傳純 JSON 格式：**
{
  "workflowId": "上述選擇的工作流 ID",
  "prompt": "若為創作需求，請優化為詳細英文 Prompt；純對話填空字串 \"\"",
  "negativePrompt": "品質避雷詞；純對話填空字串 \"\"",
  "width": 768,
  "height": 1024,
  "hasSpecifiedSize": false,
  "seed": -1,
  "chineseSummary": "數位人的繁體中文對話回答，說明即將為使用者調度哪個 ComfyUI 功能"
}`;

  function loadWorkflow(filename: string): Record<string, any> {
    let workflowPath = path.join(process.cwd(), 'workflow', filename);

    if (!fs.existsSync(workflowPath)) {
      const aliasMap: Record<string, string> = {
        'flux_t2i.json': 'FLUX_t2i.json',
        'ghibli_style.json': '吉普力.json',
        'image_edit.json': '圖像編輯.json',
        'upscale.json': '高清放大.json',
      };
      if (aliasMap[filename]) {
        workflowPath = path.join(process.cwd(), 'workflow', aliasMap[filename]);
      }
    }

    if (!fs.existsSync(workflowPath)) {
      throw new Error(`工作流檔案不存在: ${workflowPath}`);
    }
    const raw = fs.readFileSync(workflowPath, 'utf-8');
    return JSON.parse(raw);
  }

  function replaceWorkflowPlaceholders(
    workflow: Record<string, any>,
    replacements: Record<string, Record<string, any>>,
    userPrompt: string
  ): Record<string, any> {
    const cloned = JSON.parse(JSON.stringify(workflow));

    for (const [nodeId, replacementsObj] of Object.entries(replacements)) {
      if (cloned[nodeId]) {
        if (!cloned[nodeId].inputs) cloned[nodeId].inputs = {};
        for (const [key, value] of Object.entries(replacementsObj)) {
          cloned[nodeId].inputs[key] = value;
          console.log(`[ComfyUI Node ${nodeId}] 成功寫入 ${key} = "${String(value).substring(0, 50)}..."`);
        }
      }
    }

    if (userPrompt && userPrompt.trim() !== '') {
      for (const nodeId of Object.keys(cloned)) {
        const node = cloned[nodeId];
        if (!node || !node.inputs) continue;

        const classType = node.class_type || '';
        const title = (node._meta?.title || '').toLowerCase();

        const isNegative = title.includes('negative') || title.includes('負向') || title.includes('避雷');
        const isTextEncode = [
          'CLIPTextEncode',
          'CLIPTextEncodeFlux',
          'TextEncodeQwenImageEdit',
          'CR Text',
          'ShowText|pysssss',
          'PrimitiveNode'
        ].includes(classType);

        if (isTextEncode && !isNegative) {
          if ('text' in node.inputs) {
            node.inputs.text = userPrompt;
            console.log(`[ComfyUI Auto-Fix] 自動修正 Node ${nodeId} (${classType}) 的 text 為新提詞`);
          }
          if ('string' in node.inputs) {
            node.inputs.string = userPrompt;
          }
          if ('value' in node.inputs && typeof node.inputs.value === 'string') {
            node.inputs.value = userPrompt;
          }
        }
      }
    }

    return cloned;
  }

  async function submitWorkflow(workflow: Record<string, any>): Promise<string> {
    console.log('[ComfyUI] Submitting workflow, nodes count:', Object.keys(workflow).length);
    const response = await fetch(`${COMFYUI_URL}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow }),
    });
    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(`ComfyUI 拒絕接收請求 (${response.status}): ${errorText}`);
    }
    const data = await response.json();
    return data.prompt_id;
  }

  async function pollCompletion(promptId: string, maxAttempts = 60, pollIntervalMs = 2000): Promise<any> {
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
      const response = await fetch(`${COMFYUI_URL}/history/${promptId}`);
      if (!response.ok) continue;
      const data = await response.json();
      if (data[promptId]) {
        return data[promptId];
      }
    }
    throw new Error('ComfyUI 生成超時 (Timeout)');
  }

  async function callVLLM(prompt: string): Promise<string> {
    const response = await fetch(`${VLLM_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: VLLM_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 2048,
      }),
    });
    if (!response.ok) {
      throw new Error(`vLLM error: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    return data.choices[0].message.content;
  }

  async function callOllama(prompt: string): Promise<string> {
    const response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt: prompt,
        stream: false,
      }),
    });
    if (!response.ok) {
      throw new Error(`Ollama error: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    return data.response;
  }

  async function callLLM(prompt: string): Promise<string> {
    try {
      return await callVLLM(prompt);
    } catch (error: any) {
      console.warn(`[LLM Warning] vLLM 無法連線 (${error.message})，轉用 Ollama 後備方案`);
      try {
        return await callOllama(prompt);
      } catch {
        console.warn(`[LLM Warning] vLLM 與 Ollama 皆離線，觸發安全Fallback回應`);
        return JSON.stringify({
          workflowId: 'flux_t2i',
          prompt: 'A beautiful highly detailed digital artwork, 8k resolution',
          negativePrompt: 'blurry, low quality',
          width: 768,
          height: 1024,
          seed: -1,
          chineseSummary: '收到！我現在就為您配對最佳工作流並準備生成內容！',
        });
      }
    }
  }

  function safeParseJson(text: string): any {
    try {
      return JSON.parse(text);
    } catch {
      const markdownMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (markdownMatch) {
        try {
          return JSON.parse(markdownMatch[1].trim());
        } catch {}
      }

      let cleaned = text.trim();
      if (cleaned.charCodeAt(0) === 0xfeff) cleaned = cleaned.slice(1);
      const firstBrace = cleaned.indexOf('{');
      const lastBrace = cleaned.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1) {
        cleaned = cleaned.substring(firstBrace, lastBrace + 1);
      }
      cleaned = cleaned.replace(/,\s*([\]}])/g, '$1');
      cleaned = cleaned.replace(/([\{,])\s*([a-zA-Z0-9_]+)\s*:/g, '$1"$2":');
      cleaned = cleaned.replace(/'([^']*)'/g, '"$1"');

      try {
        return JSON.parse(cleaned);
      } catch {
        return null;
      }
    }
  }

  function extractOutputsFromHistory(historyData: any): { filename: string; subfolder: string; type: string } | null {
    try {
      const outputs = historyData?.outputs;
      if (!outputs) return null;

      const priorityNodes = ['9', '230', '171', '162'];
      for (const nodeId of priorityNodes) {
        if (outputs[nodeId]) {
          const out = outputs[nodeId];
          if (out.images && out.images.length > 0) {
            console.log(`[ComfyUI] 優先擷取主輸出節點 Node ${nodeId} 的第一張圖: ${out.images[0].filename}`);
            return out.images[0];
          }
          if (out.gifs && out.gifs.length > 0) return out.gifs[0];
        }
      }

      for (const nodeId of Object.keys(outputs)) {
        const out = outputs[nodeId];
        if (out.images && out.images.length > 0) {
          console.log(`[ComfyUI] 擷取輸出節點 Node ${nodeId} 的第一張圖: ${out.images[0].filename}`);
          return out.images[0];
        }
        if (out.gifs && out.gifs.length > 0) return out.gifs[0];
      }
    } catch (err) {
      console.error('[ComfyUI] 解析 Output 歷史紀錄失敗:', err);
    }
    return null;
  }

  function getFirstOutputUrl(prefix: string): string | null {
    const dir = path.join(COMFYUI_OUTPUT_DIR, prefix);
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir).filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f));
      if (files.length > 0) return `/comfyui_output/${prefix}/${files[0]}`;
    }

    if (fs.existsSync(COMFYUI_OUTPUT_DIR)) {
      const rootFiles = fs.readdirSync(COMFYUI_OUTPUT_DIR).filter(f =>
        f.startsWith(prefix) && /\.(png|jpg|jpeg|webp)$/i.test(f)
      );
      if (rootFiles.length > 0) return `/comfyui_output/${rootFiles[0]}`;
    }

    return null;
  }

  function getWorkflowDisplayName(id: string): string {
    const names: Record<string, string> = {
      'flux_t2i': 'FLUX 高品質文生圖',
      'ghibli_style': '吉普力動漫宮崎駿風格',
      'image_edit': 'Qwen / Flux 圖像編輯修圖',
      'upscale': 'AI 高清畫質放大',
    };
    return names[id] || id;
  }

  async function executeWorkflowHelper(config: {
    workflowFile: string;
    replacements: Record<string, Record<string, any>>;
    outputPrefix: string;
  }) {
    const workflow = loadWorkflow(config.workflowFile);
    const modified = replaceWorkflowPlaceholders(workflow, config.replacements, '');
    const promptId = await submitWorkflow(modified);
    const history = await pollCompletion(promptId, 60, 2000);

    console.log('[ComfyUI] 工作流執行完成');

    const outputFileInfo = extractOutputsFromHistory(history);
    let outputUrl: string | null = null;

    if (outputFileInfo) {
      outputUrl = `/api/view-comfy?filename=${encodeURIComponent(outputFileInfo.filename)}&subfolder=${encodeURIComponent(outputFileInfo.subfolder || '')}&type=${encodeURIComponent(outputFileInfo.type || 'output')}`;
      console.log('[ComfyUI] 解析產出成果 URL:', outputUrl);
    } else {
      outputUrl = getFirstOutputUrl(config.outputPrefix);
      console.log('[ComfyUI] 備用檔案路徑:', outputUrl);
    }

    return {
      success: !!outputUrl,
      outputUrl,
      outputType: 'image' as const,
      executionTimeMs: history?.metrics?.total_ms,
    };
  }

  interface WorkflowParamMapping {
    workflowFile: string;
    nodeIds: Record<string, Record<string, any>>;
    outputPrefix: string;
  }

  const WORKFLOW_PARAM_MAPS: Record<string, WorkflowParamMapping> = {
    'flux_t2i': {
      workflowFile: 'FLUX_t2i.json',
      nodeIds: {
        '17': { noise_seed: '{{seed}}' },
        '27': { text: '{{prompt}}' },
        '5': { width: '{{width}}', height: '{{height}}' },
      },
      outputPrefix: 'model',
    },
    'ghibli_style': {
      workflowFile: 'ghibli_style.json',
      nodeIds: {
        '225': { text: '{{prompt}}' },
        '217': { seed: '{{seed}}', noise_seed: '{{seed}}' },
        '223': { image: '{{inputImage}}' },
      },
      outputPrefix: 'Ghibli',
    },
    'image_edit': {
      workflowFile: 'image_edit.json',
      nodeIds: {
        '68': { prompt: '{{prompt}}' },
        '69': { prompt: '{{negativePrompt}}' },
        '65': { seed: '{{seed}}' },
        '41': { image: '{{inputImage}}' },
        '110': { width: '{{width}}', height: '{{height}}' },
      },
      outputPrefix: 'ImageEdit',
    },
    'upscale': {
      workflowFile: 'upscale.json',
      nodeIds: {
        '42': { text: '{{prompt}}' },
        '70': { seed: '{{seed}}', noise_seed: '{{seed}}' },
        '233': { image: '{{inputImage}}' },
      },
      outputPrefix: 'Upscale',
    },
  };

  // 中文提示詞翻譯設定（MCP 頭像與 Web UI 共用）
  const translator: TranslatorConfig = {
    vllmUrl: stripSlash(VLLM_URL),
    vllmModel: VLLM_MODEL,
    ollamaUrl: stripSlash(OLLAMA_URL),
    ollamaModel: PORTRAIT_OLLAMA_MODEL,
    translateTimeoutMs: positiveIntEnv('PORTRAIT_TRANSLATE_TIMEOUT_SECONDS', 60) * 1000,
  };

  // ==========================================
  // MCP 端點（僅頭像文生圖，見 lib/portrait-mcp.ts）
  // ==========================================
  registerPortraitMcp(app, {
    authToken: MCP_AUTH_TOKEN || undefined,
    portrait: {
      comfyuiUrl: stripSlash(COMFYUI_URL),
      workflowFile: path.join(process.cwd(), 'workflow', 'FLUX_t2i.json'),
      lexiconFiles: [
        ...PORTRAIT_LEXICON_CATEGORIES.map((name) =>
          path.join(process.cwd(), 'data', 'Sensitive-lexicon', 'Vocabulary', `${name}.txt`)
        ),
        path.join(process.cwd(), 'data', 'portrait_blocklist.txt'),
      ],
      whitelistFile: path.join(process.cwd(), 'data', 'whitelist.txt'),
      ...translator,
      timeoutMs: positiveIntEnv('PORTRAIT_TIMEOUT_SECONDS', 600) * 1000,
      pollIntervalMs: 2000,
      maxImageBytes: 10 * 1024 * 1024,
    },
  });

  /** Web UI 生圖：提示詞含中文時先忠實翻譯成英文（不加頭像構圖詞）；翻譯失敗則沿用原文 */
  async function toEnglishPrompt(text: string): Promise<string> {
    if (!text || !containsCjk(text)) return text;
    const result = await translatePrompt(translator, text, { portrait: false });
    if (result.translated) {
      console.log(`[Translate] ${result.provider} → ${result.text}`);
    }
    return result.text;
  }

  // ==========================================
  // 原生 REST API 路由
  // ==========================================
  app.get('/api/view-comfy', async (req: Request, res: Response) => {
    const { filename, subfolder, type } = req.query;
    if (!filename) return res.status(400).send('Missing filename');
    // 只轉發 ComfyUI 的結果圖（output，或 PreviewImage 產生的 temp），不開放 input
    const viewType = type === undefined ? 'output' : String(type);
    if (viewType !== 'output' && viewType !== 'temp') {
      return res.status(400).send('Only output or temp media is allowed');
    }

    try {
      const comfyImgUrl = `${COMFYUI_URL}/view?filename=${encodeURIComponent(String(filename))}&subfolder=${encodeURIComponent(String(subfolder || ''))}&type=${viewType}`;
      const imgRes = await fetch(comfyImgUrl);

      if (!imgRes.ok) return res.status(404).send('Media not found in ComfyUI');

      const arrayBuffer = await imgRes.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      res.setHeader('Content-Type', imgRes.headers.get('content-type') || 'image/png');
      return res.send(buffer);
    } catch (error: any) {
      return res.status(500).send(error.message);
    }
  });

  app.post('/api/generate/analyze-intent', async (req: Request, res: Response) => {
    try {
      const { userPrompt, uploadedImage } = req.body;
      if (!userPrompt && !uploadedImage) {
        return res.status(400).json({ success: false, message: '缺少使用者提示詞或圖片' });
      }

      let savedImageFilename: string | null = null;
      if (uploadedImage) {
        savedImageFilename = `input_${Date.now()}.png`;
        await resolveOrSaveImage(uploadedImage, savedImageFilename);
      }

      const promptContext = `
使用者輸入：${userPrompt || '（無文字描述）'}
是否提供參考圖片 (hasUploadedImage): ${!!uploadedImage}
`;

      let parsed: any = null;
      try {
        const llmResponse = await callLLM(LLM_DISPATCH_PROMPT + '\n\n' + promptContext);
        parsed = safeParseJson(llmResponse);
      } catch (err: any) {
        console.warn(`[Analyze Intent Warning] LLM 分析失敗: ${err.message}`);
      }

      if (!parsed || !parsed.workflowId) {
        parsed = {
          workflowId: uploadedImage ? 'image_edit' : 'flux_t2i',
          prompt: userPrompt,
          chineseSummary: '好的，為您選擇適合的工作流進行創作！',
        };
      }

      let finalWorkflowId = parsed.workflowId;
      if (finalWorkflowId !== 'chat_only' && !WORKFLOW_PARAM_MAPS[finalWorkflowId]) {
        finalWorkflowId = uploadedImage ? 'image_edit' : 'flux_t2i';
      }

      // 派工 LLM 只負責判斷工作流；英文提示詞改用忠實翻譯，避免小模型改寫或編造內容
      if (finalWorkflowId !== 'chat_only' && userPrompt && containsCjk(userPrompt)) {
        const translated = await translatePrompt(translator, userPrompt, { portrait: false });
        if (translated.translated) {
          parsed.prompt = translated.text;
          console.log(`[Translate] ${translated.provider} → ${translated.text}`);
        }
      }

      const sizeParsed = parseDimensions(userPrompt || '');
      const hasSizeInText = sizeParsed.hasSpecified;
      let sizeOptions: any[] | undefined = undefined;

      if (!hasSizeInText && finalWorkflowId !== 'chat_only' && finalWorkflowId !== 'upscale') {
        sizeOptions = [
          { label: '直向 3:4 (768×1024)', width: 768, height: 1024, ratioKey: 'portrait' },
          { label: '橫向 4:3 (1024×768)', width: 1024, height: 768, ratioKey: 'landscape' },
          { label: '正方 1:1 (1024×1024)', width: 1024, height: 1024, ratioKey: 'square' },
        ];
        if (uploadedImage) {
          sizeOptions.push({ label: '依照原圖尺寸', ratioKey: 'original' });
        }
      }

      const seed = (!parsed.seed || parsed.seed === -1)
        ? Math.floor(Math.random() * 1000000000)
        : parsed.seed;

      res.json({
        success: true,
        isChatOnly: finalWorkflowId === 'chat_only',
        workflowId: finalWorkflowId,
        workflowName: finalWorkflowId === 'chat_only' ? '對話互動' : getWorkflowDisplayName(finalWorkflowId),
        optimizedPrompt: parsed.prompt || userPrompt,
        negativePrompt: parsed.negativePrompt || '',
        params: {
          width: sizeParsed.width,
          height: sizeParsed.height,
          seed,
          inputImage: savedImageFilename,
        },
        hasSpecifiedSize: hasSizeInText,
        sizeOptions,
        avatarResponseText: parsed.chineseSummary || `已為您選擇 ${finalWorkflowId} 工作流！`,
      });
    } catch (error: any) {
      console.error('[Analyze Intent Fatal Error]:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.post('/api/generate/dispatch', async (req: Request, res: Response) => {
    try {
      const { userPrompt, workflowId, params } = req.body;
      if (!userPrompt && !params?.uploadedImage && !params?.inputImage) {
        return res.status(400).json({ success: false, message: '缺少使用者提示或輸入素材' });
      }

      const resolvedWorkflowId = workflowId || 'flux_t2i';
      const mapping = WORKFLOW_PARAM_MAPS[resolvedWorkflowId];
      if (!mapping) {
        return res.status(400).json({ success: false, message: `未知工作流: ${resolvedWorkflowId}` });
      }

      console.log(`[Dispatch] 開始調度工作流: ${resolvedWorkflowId}`);
      console.log(`[Dispatch] 提詞內容: "${userPrompt}"`);

      // FLUX 對中文理解差：含中文時先翻成英文
      const englishPrompt = await toEnglishPrompt(String(userPrompt || ''));
      const negativePrompt = await toEnglishPrompt(String(params?.negativePrompt || ''));

      let imageFilename = params?.inputImage || params?.uploadedImage;
      if (imageFilename && typeof imageFilename === 'string') {
        const savedName = `input_${Date.now()}.png`;
        const resolvedName = await resolveOrSaveImage(imageFilename, savedName);
        imageFilename = resolvedName;
      }

      const seed = (!params?.seed || params.seed === -1)
        ? Math.floor(Math.random() * 1000000000)
        : params.seed;

      let width = Number(params?.width);
      let height = Number(params?.height);

      if (isNaN(width) || width < 16 || isNaN(height) || height < 16) {
        const fallback = parseDimensions(userPrompt, 768, 1024);
        width = fallback.width;
        height = fallback.height;
      }

      const replacements: Record<string, Record<string, any>> = {};

      for (const [nodeId, nodeParams] of Object.entries(mapping.nodeIds)) {
        replacements[nodeId] = {};
        for (const [paramKey, value] of Object.entries(nodeParams)) {
          if (typeof value === 'string' && value.startsWith('{{') && value.endsWith('}}')) {
            const key = value.slice(2, -2);
            switch (key) {
              case 'seed':
                replacements[nodeId][paramKey] = seed;
                break;
              case 'prompt':
                replacements[nodeId][paramKey] = englishPrompt || '';
                break;
              case 'negativePrompt':
                replacements[nodeId][paramKey] = negativePrompt;
                break;
              case 'width':
                replacements[nodeId][paramKey] = width;
                break;
              case 'height':
                replacements[nodeId][paramKey] = height;
                break;
              case 'inputImage':
                if (imageFilename && typeof imageFilename === 'string' && imageFilename.trim() !== '') {
                  replacements[nodeId][paramKey] = imageFilename;
                }
                break;
              default:
                replacements[nodeId][paramKey] = value;
            }
          } else {
            replacements[nodeId][paramKey] = value;
          }
        }
      }

      const result = await executeWorkflowHelper({
        workflowFile: mapping.workflowFile,
        replacements,
        outputPrefix: mapping.outputPrefix,
      });

      res.json({
        success: result.success,
        taskId: randomUUID(),
        workflowName: resolvedWorkflowId,
        workflowId: resolvedWorkflowId,
        status: result.success ? 'completed' : 'failed',
        progress: result.success ? 100 : 0,
        outputType: result.outputType,
        outputUrl: result.outputUrl,
        translatedPrompt: englishPrompt !== userPrompt ? englishPrompt : undefined,
        avatarResponse: {
          text: result.success ? '已經為您調度 ComfyUI 成功完成創作！' : '生成失敗，請檢查 ComfyUI 控制台',
        },
        executionTimeMs: result.executionTimeMs,
      });
    } catch (error: any) {
      console.error('[Dispatch Error]:', error.message);
      res.status(500).json({
        success: false,
        message: error.message,
        avatarResponse: { text: `調度過程發生錯誤: ${error.message}` },
      });
    }
  });

  app.get('/api/comfyui/status', async (req: Request, res: Response) => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1500);

      const comfyRes = await fetch(`${COMFYUI_URL}/system_stats`, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!comfyRes.ok) {
        throw new Error(`ComfyUI 狀態回應異常: ${comfyRes.status}`);
      }
      const data = await comfyRes.json();

      const device = data.devices?.[0];
      let vramTotalGb = 24.0;
      let vramFreeGb = 12.0;
      let gpuName = 'NVIDIA Graphics Card';

      if (device) {
        gpuName = device.name || gpuName;
        vramTotalGb = parseFloat((device.vram_total / (1024 * 1024 * 1024)).toFixed(1));
        vramFreeGb = parseFloat((device.vram_free / (1024 * 1024 * 1024)).toFixed(1));
      }

      const vramUsedGb = parseFloat((vramTotalGb - vramFreeGb).toFixed(1));
      const loadPercent = vramTotalGb > 0 ? Math.round((vramUsedGb / vramTotalGb) * 100) : 0;

      return res.json({
        success: true,
        systemStats: {
          gpu: {
            name: gpuName,
            vramUsedGb,
            vramTotalGb,
            loadPercent,
            temperatureC: 52,
            activeJobsCount: data.exec_info?.queue_remaining || 0,
            comfyConnected: true,
            comfyHost: COMFYUI_URL,
          },
        },
      });
    } catch (error: any) {
      return res.json({
        success: false,
        systemStats: {
          gpu: {
            name: 'ComfyUI 離線中',
            vramUsedGb: 0,
            vramTotalGb: 24.0,
            loadPercent: 0,
            temperatureC: 0,
            activeJobsCount: 0,
            comfyConnected: false,
            comfyHost: COMFYUI_URL,
          },
        },
      });
    }
  });

  app.post('/api/comfyui/interrupt', async (_req: Request, res: Response) => {
    try {
      const interruptRes = await fetch(`${COMFYUI_URL}/interrupt`, { method: 'POST' });
      if (!interruptRes.ok) throw new Error(`ComfyUI 中斷請求失敗: ${interruptRes.status}`);
      console.log('[ComfyUI] 成功發送中斷/取消排程指令');
      return res.json({ success: true, message: '已成功發送取消指令' });
    } catch (error: any) {
      console.error('[ComfyUI Interrupt Error]:', error.message);
      return res.status(500).json({ success: false, message: error.message });
    }
  });

  app.get('/api/comfyui/queue', async (_req: Request, res: Response) => {
    try {
      const queueRes = await fetch(`${COMFYUI_URL}/queue`);
      if (!queueRes.ok) throw new Error(`無法取得佇列資訊: ${queueRes.status}`);
      const data = await queueRes.json();
      return res.json({
        success: true,
        running: data.queue_running || [],
        pending: data.queue_pending || [],
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  });

  app.post('/api/comfyui/queue/delete', async (req: Request, res: Response) => {
    try {
      const { promptId, clearAll } = req.body;
      if (clearAll) {
        await fetch(`${COMFYUI_URL}/queue`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clear: true }),
        });
        return res.json({ success: true, message: '已清空所有排程' });
      }

      if (promptId) {
        await fetch(`${COMFYUI_URL}/queue`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ delete: [promptId] }),
        });
        return res.json({ success: true, message: `已取消任務 ${promptId}` });
      }

      return res.status(400).json({ success: false, message: '缺少 promptId 或 clearAll 參數' });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  });

  const vite = await createViteServer({
    server: {
      middlewareMode: true,
      hmr: { port: 24679 },
      allowedHosts: true,
    },
    appType: 'spa',
  });
  app.use(vite.middlewares);

  app.use('/comfyui_output', express.static(COMFYUI_OUTPUT_DIR));

  const server = app.listen(PORT, HOST, () => {
    const shownHost = HOST.includes(':') ? `[${HOST}]` : HOST;
    console.log(`=================================================`);
    console.log(`🚀 Image Generation MCP Server (Streamable HTTP + SSE + WebUI) 已啟動！`);
    console.log(`• Web 前端網址: http://${shownHost}:${PORT}`);
    console.log(`• MCP 端點: http://${shownHost}:${PORT}/mcp（舊版 SSE: /sse）`);
    console.log(`• MCP 驗證: ${MCP_AUTH_TOKEN ? '已啟用 Bearer Token' : '未啟用（僅限本機）'}`);
    console.log(`• Web UI 外部存取: ${WEBUI_PASSWORD ? '需輸入 WEBUI_PASSWORD' : '關閉（僅限本機）'}`);
    console.log(`=================================================`);
  });
  // 生圖最長可達 PORTRAIT_TIMEOUT_SECONDS，避免 Node 預設 5 分鐘請求逾時中斷 MCP 呼叫
  server.requestTimeout = (positiveIntEnv('PORTRAIT_TIMEOUT_SECONDS', 600) + 120) * 1000;

  process.on('SIGINT', () => {
    server.close(() => {
      console.log('Process terminated');
      process.exit(0);
    });
  });
}

startServer().catch((err) => {
  console.error(err);
  process.exit(1);
});