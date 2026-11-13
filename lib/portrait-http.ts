// HTTP 端點：數位員工頭像文生圖（POST /api/portraits/generate）。
// 成功回傳 PNG 原始位元組（image/png）；失敗回傳 JSON { success:false, code, message }。

import { timingSafeEqual } from 'crypto';
import type { Express, NextFunction, Request, Response } from 'express';
import {
  PortraitError,
  createPortraitGenerator,
  type PortraitConfig,
  type PortraitErrorCode,
} from './portrait.ts';

export const PORTRAIT_GENERATE_PATH = '/api/portraits/generate';

export interface PortraitHttpOptions {
  portrait: PortraitConfig;
  /** 設定時必須帶 Authorization: Bearer <token> */
  authToken?: string;
}

const STATUS: Record<PortraitErrorCode | 'INTERNAL_ERROR', number> = {
  INVALID_ARGUMENT: 422,
  BLOCKED_PROMPT: 422,
  WORKFLOW_INVALID: 500,
  COMFYUI_UNAVAILABLE: 502,
  COMFYUI_REJECTED: 502,
  COMFYUI_FAILED: 502,
  OUTPUT_MISSING: 502,
  IMAGE_FETCH_FAILED: 502,
  GENERATION_TIMEOUT: 504,
  CANCELLED: 499,
  INTERNAL_ERROR: 500,
};

export function registerPortraitHttp(app: Express, options: PortraitHttpOptions) {
  const generator = createPortraitGenerator(options.portrait);
  try {
    generator.preloadKeywords();
  } catch (err: any) {
    console.error(`[Portrait API] ⚠️ 敏感詞庫無法載入，生成請求會被拒絕：${err.message}`);
  }

  const expectedToken = options.authToken ? Buffer.from(options.authToken) : null;
  function requireToken(req: Request, res: Response, next: NextFunction) {
    if (!expectedToken) return next();
    const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
    const given = Buffer.from(match ? match[1].trim() : '');
    if (given.length !== expectedToken.length || !timingSafeEqual(given, expectedToken)) {
      res.setHeader('WWW-Authenticate', 'Bearer');
      res.status(401).json({ success: false, code: 'UNAUTHORIZED', message: '缺少或錯誤的 Token' });
      return;
    }
    next();
  }

  app.post(PORTRAIT_GENERATE_PATH, requireToken, async (req: Request, res: Response) => {
    // 呼叫端中斷連線時，停止等待並從 ComfyUI 佇列移除工作
    const abort = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) abort.abort();
    });

    const body = req.body ?? {};
    try {
      const result = await generator.generate({
        prompt: typeof body.prompt === 'string' ? body.prompt : '',
        width: body.width,
        height: body.height,
        seed: body.seed,
        signal: abort.signal,
      });
      console.error(`[Portrait API] 頭像生成完成 (${result.width}x${result.height}, ${result.elapsedMs}ms)`);
      res
        .status(200)
        .set({
          'Content-Type': result.mimeType,
          'Cache-Control': 'no-store',
          'X-Portrait-Seed': String(result.seed),
          'X-Portrait-Translated': String(result.translated),
          'X-Portrait-Elapsed-Ms': String(result.elapsedMs),
        })
        .send(result.image);
    } catch (err: any) {
      const code = err instanceof PortraitError ? err.code : 'INTERNAL_ERROR';
      const message = err instanceof PortraitError ? err.message : '頭像生成失敗';
      console.error(`[Portrait API] 頭像生成失敗 (${code}): ${err?.message}`);
      if (!res.headersSent && !abort.signal.aborted) {
        res.status(STATUS[code] ?? 500).json({ success: false, code, message });
      }
    }
  });
}
