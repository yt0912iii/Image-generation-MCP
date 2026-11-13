// 冒煙測試：以假 ComfyUI / vLLM 啟動 mcp-server.ts，透過 MCP Client 驗證 generate_portrait。
// 執行：npm run test:mcp
// 不會連線真實 ComfyUI 或 LLM；只能證明 MCP 介面與流程行為。

import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import { spawn } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

const TOKEN = 'smoke-test-token';
const WEBUI_PASSWORD = 'smoke-webui-password';
// 1x1 PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

const submitted: any[] = [];
let failNext = false;
const viewTypes: string[] = [];

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => resolve(body));
  });
}

const comfy = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://x');
  if (req.method === 'POST' && url.pathname === '/prompt') {
    submitted.push(JSON.parse(await readBody(req)).prompt);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ prompt_id: `p${submitted.length}` }));
    return;
  }
  if (url.pathname.startsWith('/history/')) {
    const id = decodeURIComponent(url.pathname.slice('/history/'.length));
    const status = failNext
      ? { status_str: 'error', completed: false }
      : { status_str: 'success', completed: true };
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        // PreviewImage 的結果放在 ComfyUI temp
        [id]: { status, outputs: { '9': { images: [{ filename: 'out.png', subfolder: '', type: 'temp' }] } } },
      })
    );
    return;
  }
  if (url.pathname === '/view') {
    viewTypes.push(url.searchParams.get('type') || '');
    res.setHeader('content-type', 'image/png');
    res.end(PNG);
    return;
  }
  if (url.pathname === '/queue') {
    res.end('{}');
    return;
  }
  res.statusCode = 404;
  res.end();
});

// 假 vLLM：第一次回覆夾帶中文（應觸發重試），之後回覆正確英文
let llmCalls = 0;
const llm = http.createServer(async (req, res) => {
  await readBody(req);
  llmCalls++;
  const content =
    llmCalls === 1 ? 'Minimalist 3D clay cat engineer, 純白背景' : 'Output: "Minimalist 3D clay cat engineer avatar"';
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ choices: [{ message: { content } }] }));
});
const EXPECTED_PROMPT =
  'Minimalist 3D clay cat engineer avatar, clean soft studio background, avatar portrait, centered head and shoulders composition, highly detailed';

async function connect(base: string, kind: 'http' | 'sse', token = TOKEN) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const client = new Client({ name: 'smoke', version: '1.0.0' });
  const transport =
    kind === 'http'
      ? new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers } })
      : new SSEClientTransport(new URL(`${base}/sse`), {
          requestInit: { headers },
          eventSourceInit: { fetch: (url, init) => fetch(url, { ...init, headers: { ...(init?.headers as any), ...headers } }) },
        });
  await client.connect(transport);
  return client;
}

function parseText(result: any) {
  const text = result.content.find((c: any) => c.type === 'text');
  return JSON.parse(text.text);
}

async function waitForServer(base: string, child: ReturnType<typeof spawn>) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited with ${child.exitCode}`);
    try {
      const res = await fetch(`${base}/mcp`, { method: 'GET' });
      if (res.status === 401) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('server did not start');
}

async function main() {
  const comfyPort = await listen(comfy);
  const llmPort = await listen(llm);
  const probe = http.createServer();
  const port = await listen(probe);
  await new Promise((r) => probe.close(r));

  const child = spawn(process.execPath, ['--import', 'tsx', 'mcp-server.ts'], {
    env: {
      ...process.env,
      PORT: String(port),
      // 綁定所有介面，才能從本機區網 IP 模擬「其他電腦」連線
      HOST: '0.0.0.0',
      MCP_AUTH_TOKEN: TOKEN,
      WEBUI_PASSWORD,
      COMFYUI_URL: `http://127.0.0.1:${comfyPort}`,
      VLLM_URL: `http://127.0.0.1:${llmPort}`,
      OLLAMA_URL: `http://127.0.0.1:${llmPort}`,
      PORTRAIT_TIMEOUT_SECONDS: '20',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let logs = '';
  child.stderr?.on('data', (d) => (logs += d));
  const base = `http://127.0.0.1:${port}`;

  try {
    await waitForServer(base, child);

    // 1. 未帶 Token 被拒絕
    const unauth = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    assert.equal(unauth.status, 401, 'missing token should be 401');
    const wrong = await fetch(`${base}/sse`, { headers: { Authorization: 'Bearer nope' } });
    assert.equal(wrong.status, 401, 'wrong token on /sse should be 401');
    console.log('✓ 驗證：缺少或錯誤 Token 回 401');

    const client = await connect(base, 'http');

    // 2. 只公開 generate_portrait
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map((t) => t.name), ['generate_portrait']);
    console.log('✓ 工具清單只有 generate_portrait');

    // 3. 中文提示詞：轉譯後送進 FLUX，回傳圖片
    const progress: string[] = [];
    const ok: any = await client.callTool(
      { name: 'generate_portrait', arguments: { prompt: '戴著藍色耳機的貓工程師', seed: 42 } },
      undefined,
      { onprogress: (p) => progress.push(p.message || '') }
    );
    assert.ok(!ok.isError, JSON.stringify(ok));
    const image = ok.content.find((c: any) => c.type === 'image');
    assert.equal(image.mimeType, 'image/png');
    assert.deepEqual(Buffer.from(image.data, 'base64'), PNG);
    const meta = parseText(ok);
    assert.equal(meta.englishPrompt, EXPECTED_PROMPT);
    assert.equal(meta.translated, true);
    assert.equal(meta.translationProvider, 'vLLM');
    assert.equal(llmCalls, 2, 'Chinese residue should trigger exactly one retry');
    assert.equal(meta.seed, 42);
    const wf = submitted.at(-1);
    assert.equal(wf['27'].inputs.text, EXPECTED_PROMPT);
    assert.equal(wf['17'].inputs.noise_seed, 42);
    assert.equal(wf['5'].inputs.width, 1024);
    assert.equal(wf['5'].inputs.height, 1024);
    assert.ok(progress.length > 0, 'should report progress');
    assert.equal(wf['9'].class_type, 'PreviewImage', 'portraits must not be kept in ComfyUI output');
    assert.equal(viewTypes.at(-1), 'temp', 'image must be fetched from ComfyUI temp');
    console.log('✓ 中文提示詞轉譯（殘留中文會重試）、PreviewImage 從 temp 取圖、回傳 PNG 與進度通知');

    // 4. 繁體敏感詞被擋，且不送 ComfyUI
    const before = submitted.length;
    const blocked: any = await client.callTool({ name: 'generate_portrait', arguments: { prompt: '血腥的頭像' } });
    assert.equal(blocked.isError, true);
    assert.equal(parseText(blocked).code, 'BLOCKED_PROMPT');
    const blockedTw: any = await client.callTool({ name: 'generate_portrait', arguments: { prompt: '法輪功' } });
    assert.equal(parseText(blockedTw).code, 'BLOCKED_PROMPT');
    assert.equal(submitted.length, before, 'blocked prompt must not reach ComfyUI');
    console.log('✓ 繁體敏感詞轉簡體後被擋下，未送出 ComfyUI');

    // 5. 參數錯誤
    const bad: any = await client.callTool({ name: 'generate_portrait', arguments: { prompt: 'cat', width: 100 } });
    assert.equal(parseText(bad).code, 'INVALID_ARGUMENT');
    console.log('✓ 尺寸超出範圍回 INVALID_ARGUMENT');

    // 6. ComfyUI 執行失敗
    failNext = true;
    const failed: any = await client.callTool({ name: 'generate_portrait', arguments: { prompt: 'a cat avatar' } });
    failNext = false;
    assert.equal(parseText(failed).code, 'COMFYUI_FAILED');
    console.log('✓ ComfyUI 回報錯誤時回 COMFYUI_FAILED');
    await client.close();

    // 7. 舊版 SSE 仍可使用
    const sse = await connect(base, 'sse');
    const sseResult: any = await sse.callTool({ name: 'generate_portrait', arguments: { prompt: 'a cat avatar' } });
    assert.ok(!sseResult.isError);
    assert.equal(parseText(sseResult).translated, false);
    await sse.close();
    console.log('✓ 舊版 SSE 傳輸可呼叫 generate_portrait');

    // 8. view-comfy 只允許 output
    const input = await fetch(`${base}/api/view-comfy?filename=a.png&type=input`);
    assert.equal(input.status, 400);
    const temp = await fetch(`${base}/api/view-comfy?filename=a.png&type=temp`);
    assert.equal(temp.status, 200);
    console.log('✓ /api/view-comfy 只允許 output／temp，拒絕 input');

    // 9. 外部連線：以本機區網 IP 連線，來源位址不是 loopback
    const lanIp = Object.values(os.networkInterfaces())
      .flat()
      .find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
    const localQueue = await fetch(`${base}/api/comfyui/queue`);
    assert.notEqual(localQueue.status, 401, 'loopback Web UI API should not need a password');
    if (!lanIp) {
      console.log('- 找不到區網 IPv4，略過外部連線測試');
    } else {
      const remote = `http://${lanIp}:${port}`;
      const basic = (pw: string) => ({ Authorization: `Basic ${Buffer.from(`tester:${pw}`).toString('base64')}` });
      const page = await fetch(`${remote}/`);
      assert.equal(page.status, 401, 'remote Web UI without password should be 401');
      assert.match(page.headers.get('www-authenticate') || '', /^Basic /);
      const wrongPw = await fetch(`${remote}/api/comfyui/queue`, { headers: basic('wrong') });
      assert.equal(wrongPw.status, 401, 'wrong Web UI password should be 401');
      const rightPw = await fetch(`${remote}/api/comfyui/queue`, { headers: basic(WEBUI_PASSWORD) });
      assert.ok(rightPw.status !== 401 && rightPw.status !== 403, `right password should pass, got ${rightPw.status}`);
      const remoteMcpNoToken = await fetch(`${remote}/mcp`, { method: 'POST', headers: basic(WEBUI_PASSWORD) });
      assert.equal(remoteMcpNoToken.status, 401, 'Web UI password must not unlock MCP');
      const remoteClient = await connect(remote, 'http');
      assert.deepEqual((await remoteClient.listTools()).tools.map((t) => t.name), ['generate_portrait']);
      await remoteClient.close();
      console.log('✓ 外部連線：Web UI 需密碼、本機免密碼；MCP 需 Token 且不接受 Web UI 密碼');
    }

    console.log('\n全部通過');
  } catch (err) {
    console.error(logs.split('\n').slice(-30).join('\n'));
    throw err;
  } finally {
    child.kill();
    comfy.close();
    llm.close();
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
