// MCP 端點：只提供數位員工頭像文生圖（generate_portrait）。
// 傳輸：Streamable HTTP（/mcp，無狀態）與舊版 SSE（/sse + /messages）。

import { timingSafeEqual } from 'crypto';
import type { Express, NextFunction, Request, Response } from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  PORTRAIT_LIMITS,
  PortraitError,
  createPortraitGenerator,
  type PortraitConfig,
} from './portrait.ts';

export interface PortraitMcpOptions {
  portrait: PortraitConfig;
  /** 設定時 /mcp、/sse、/messages 都需要 Authorization: Bearer <token> */
  authToken?: string;
}

const PORTRAIT_TOOL_NAMES = new Set(['generate_portrait', 'flux_t2i', 'generate_image']);

export function registerPortraitMcp(app: Express, options: PortraitMcpOptions) {
  const generator = createPortraitGenerator(options.portrait);
  try {
    generator.preloadKeywords();
  } catch (err: any) {
    console.error(`[MCP Server] ⚠️ 敏感詞庫無法載入，生成請求會被拒絕：${err.message}`);
  }

  function createMcpServer(): Server {
    const server = new Server(
      { name: 'image-generation-mcp-server', version: '1.1.0' },
      { capabilities: { tools: {} } }
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'generate_portrait',
          description:
            '以 FLUX 文生圖產生數位員工頭像。中文提示詞會先轉譯成英文；提示詞含敏感詞時拒絕。成功時回傳一張圖片與一段 JSON 文字（englishPrompt、seed、width、height、elapsedMs）。',
          inputSchema: {
            type: 'object',
            properties: {
              prompt: {
                type: 'string',
                description: '頭像描述（中文或英文）',
                minLength: 1,
                maxLength: PORTRAIT_LIMITS.maxPromptLength,
              },
              width: {
                type: 'integer',
                description: `寬度，預設 ${PORTRAIT_LIMITS.defaultSize}，會取整到 16 的倍數`,
                minimum: PORTRAIT_LIMITS.minSize,
                maximum: PORTRAIT_LIMITS.maxSize,
              },
              height: {
                type: 'integer',
                description: `高度，預設 ${PORTRAIT_LIMITS.defaultSize}，會取整到 16 的倍數`,
                minimum: PORTRAIT_LIMITS.minSize,
                maximum: PORTRAIT_LIMITS.maxSize,
              },
              seed: { type: 'integer', description: '隨機種子；省略則隨機', minimum: 0 },
            },
            required: ['prompt'],
            additionalProperties: false,
          },
        },
      ],
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      const { name, arguments: args } = request.params;
      if (!PORTRAIT_TOOL_NAMES.has(name)) {
        throw new Error(`未知的 MCP 工具: ${name}`);
      }

      const progressToken = request.params._meta?.progressToken;
      try {
        const result = await generator.generate({
          prompt: String(args?.prompt ?? ''),
          width: args?.width as number | undefined,
          height: args?.height as number | undefined,
          seed: args?.seed as number | undefined,
          signal: extra.signal,
          onProgress:
            progressToken === undefined
              ? undefined
              : (elapsedMs, totalMs, message) =>
                  extra.sendNotification({
                    method: 'notifications/progress',
                    params: {
                      progressToken,
                      progress: Math.round(elapsedMs / 1000),
                      total: Math.round(totalMs / 1000),
                      message,
                    },
                  }),
        });
        console.error(`[MCP Server] 頭像生成完成 (${result.width}x${result.height}, ${result.elapsedMs}ms)`);
        return {
          content: [
            { type: 'image', data: result.image.toString('base64'), mimeType: result.mimeType },
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                workflowId: 'flux_t2i',
                englishPrompt: result.englishPrompt,
                translated: result.translated,
                translationProvider: result.translationProvider ?? null,
                seed: result.seed,
                width: result.width,
                height: result.height,
                mimeType: result.mimeType,
                elapsedMs: result.elapsedMs,
              }),
            },
          ],
        };
      } catch (err: any) {
        const code = err instanceof PortraitError ? err.code : 'INTERNAL_ERROR';
        const message = err instanceof PortraitError ? err.message : '頭像生成失敗';
        console.error(`[MCP Server] 頭像生成失敗 (${code}): ${err?.message}`);
        return {
          isError: true,
          content: [{ type: 'text', text: JSON.stringify({ success: false, code, message }) }],
        };
      }
    });

    return server;
  }

  const expectedToken = options.authToken ? Buffer.from(options.authToken) : null;
  function requireMcpAuth(req: Request, res: Response, next: NextFunction) {
    if (!expectedToken) return next();
    const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
    const given = Buffer.from(match ? match[1].trim() : '');
    if (given.length !== expectedToken.length || !timingSafeEqual(given, expectedToken)) {
      res.setHeader('WWW-Authenticate', 'Bearer');
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    next();
  }

  // Streamable HTTP（無狀態，每個請求一個 Server）
  app.post('/mcp', requireMcpAuth, async (req: Request, res: Response) => {
    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err: any) {
      console.error('[MCP Server] /mcp 處理失敗:', err?.message);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  });

  const methodNotAllowed = (_req: Request, res: Response) => {
    res.status(405).set('Allow', 'POST').json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed (stateless server)' },
      id: null,
    });
  };
  app.get('/mcp', requireMcpAuth, methodNotAllowed);
  app.delete('/mcp', requireMcpAuth, methodNotAllowed);

  // 舊版 SSE（每個連線一個 Server）
  const transports = new Map<string, SSEServerTransport>();

  app.get('/sse', requireMcpAuth, async (_req: Request, res: Response) => {
    const transport = new SSEServerTransport('/messages', res);
    const sessionId = transport.sessionId;
    const server = createMcpServer();
    transports.set(sessionId, transport);
    res.on('close', () => {
      transports.delete(sessionId);
      server.close().catch(() => {});
    });
    transport.onerror = (err) => {
      console.error(`[MCP Server] SSE Transport 異常 (${sessionId}):`, err.message);
    };
    await server.connect(transport);
  });

  app.post('/messages', requireMcpAuth, async (req: Request, res: Response) => {
    const sessionId = (req.query.sessionId as string) || (req.headers['x-session-id'] as string);
    if (!sessionId) {
      res.status(400).send('Missing sessionId');
      return;
    }
    const transport = transports.get(sessionId);
    if (!transport) {
      res.status(400).send('Session not found or expired');
      return;
    }
    try {
      await transport.handlePostMessage(req, res, req.body);
    } catch (err: any) {
      console.error('[MCP Server] handlePostMessage 處理失敗:', err?.message);
      if (!res.headersSent) res.status(500).send('Internal server error');
    }
  });
}
