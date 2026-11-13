// 冒煙測試：以假 ComfyUI / vLLM 啟動 mcp-server.ts，透過 HTTP 驗證 POST /api/portraits/generate。
// 執行：npm run test:mcp
// 不會連線真實 ComfyUI 或 LLM；只能證明 MCP 介面與流程行為。

import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import { spawn } from 'node:child_process';
import type { AddressInfo } from 'node:net';

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

async function generatePortrait(
  base: string,
  body: unknown,
  headers: Record<string, string> = { Authorization: `Bearer ${TOKEN}` }
) {
  return fetch(`${base}/api/portraits/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
    body: JSON.stringify(body),
  });
}

async function errorCode(res: Response) {
  return ((await res.json()) as { code?: string }).code;
}

async function waitForServer(base: string, child: ReturnType<typeof spawn>) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited with ${child.exitCode}`);
    try {
      const res = await generatePortrait(base, { prompt: 'x' }, {});
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
      PORTRAIT_API_TOKEN: TOKEN,
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

    // 1. 未帶 Token 或 Token 錯誤被拒絕
    const unauth = await generatePortrait(base, { prompt: 'cat' }, {});
    assert.equal(unauth.status, 401, 'missing token should be 401');
    const wrong = await generatePortrait(base, { prompt: 'cat' }, { Authorization: 'Bearer nope' });
    assert.equal(wrong.status, 401, 'wrong token should be 401');
    console.log('✓ 驗證：缺少或錯誤 Token 回 401');

    // 2. 中文提示詞：轉譯後送進 FLUX，回傳 PNG 原始位元組
    const ok = await generatePortrait(base, { prompt: '戴著藍色耳機的貓工程師', seed: 42 });
    assert.equal(ok.status, 200, await ok.clone().text());
    assert.equal(ok.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await ok.arrayBuffer()), PNG);
    assert.equal(ok.headers.get('x-portrait-seed'), '42');
    assert.equal(ok.headers.get('x-portrait-translated'), 'true');
    assert.equal(llmCalls, 2, 'Chinese residue should trigger exactly one retry');
    const wf = submitted.at(-1);
    assert.equal(wf['27'].inputs.text, EXPECTED_PROMPT);
    assert.equal(wf['17'].inputs.noise_seed, 42);
    assert.equal(wf['5'].inputs.width, 1024);
    assert.equal(wf['5'].inputs.height, 1024);
    assert.equal(wf['9'].class_type, 'PreviewImage', 'portraits must not be kept in ComfyUI output');
    assert.equal(viewTypes.at(-1), 'temp', 'image must be fetched from ComfyUI temp');
    console.log('✓ 中文提示詞轉譯（殘留中文會重試）、PreviewImage 從 temp 取圖、回傳 PNG');

    // 3. 英文提示詞不經翻譯
    const english = await generatePortrait(base, { prompt: 'a cat avatar' });
    assert.equal(english.status, 200);
    assert.equal(english.headers.get('x-portrait-translated'), 'false');
    await english.arrayBuffer();
    console.log('✓ 英文提示詞直接使用');

    // 4. 繁體敏感詞被擋，且不送 ComfyUI
    const before = submitted.length;
    const blocked = await generatePortrait(base, { prompt: '血腥的頭像' });
    assert.equal(blocked.status, 422);
    assert.equal(await errorCode(blocked), 'BLOCKED_PROMPT');
    const blockedTw = await generatePortrait(base, { prompt: '法輪功' });
    assert.equal(await errorCode(blockedTw), 'BLOCKED_PROMPT');
    assert.equal(submitted.length, before, 'blocked prompt must not reach ComfyUI');
    console.log('✓ 繁體敏感詞轉簡體後被擋下（422），未送出 ComfyUI');

    // 5. 參數錯誤
    const bad = await generatePortrait(base, { prompt: 'cat', width: 100 });
    assert.equal(bad.status, 422);
    assert.equal(await errorCode(bad), 'INVALID_ARGUMENT');
    const empty = await generatePortrait(base, {});
    assert.equal(await errorCode(empty), 'INVALID_ARGUMENT');
    console.log('✓ 參數錯誤回 422 INVALID_ARGUMENT');

    // 6. ComfyUI 執行失敗
    failNext = true;
    const failed = await generatePortrait(base, { prompt: 'a cat avatar' });
    failNext = false;
    assert.equal(failed.status, 502);
    assert.equal(await errorCode(failed), 'COMFYUI_FAILED');
    console.log('✓ ComfyUI 回報錯誤時回 502 COMFYUI_FAILED');

    // 7. MCP 端點已移除
    for (const p of ['/mcp', '/messages']) {
      const res = await fetch(`${base}${p}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });
      const text = await res.text();
      assert.ok(!text.includes('generate_portrait'), `${p} must not serve MCP`);
    }
    console.log('✓ /mcp、/messages 不再提供 MCP');

    // 8. view-comfy 只允許 output／temp
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
      const basic = (pw: string) => ({
        Authorization: `Basic ${Buffer.from(`tester:${pw}`).toString('base64')}`,
      });
      const page = await fetch(`${remote}/`);
      assert.equal(page.status, 401, 'remote Web UI without password should be 401');
      assert.match(page.headers.get('www-authenticate') || '', /^Basic /);
      const wrongPw = await fetch(`${remote}/api/comfyui/queue`, { headers: basic('wrong') });
      assert.equal(wrongPw.status, 401, 'wrong Web UI password should be 401');
      const rightPw = await fetch(`${remote}/api/comfyui/queue`, { headers: basic(WEBUI_PASSWORD) });
      assert.ok(rightPw.status !== 401 && rightPw.status !== 403, `right password should pass, got ${rightPw.status}`);
      const pwOnly = await generatePortrait(remote, { prompt: 'cat' }, basic(WEBUI_PASSWORD));
      assert.equal(pwOnly.status, 401, 'Web UI password must not unlock the portrait API');
      const remoteOk = await generatePortrait(remote, { prompt: 'a cat avatar' });
      assert.equal(remoteOk.status, 200);
      await remoteOk.arrayBuffer();
      console.log('✓ 外部連線：Web UI 需密碼、本機免密碼；頭像 API 需 Token 且不接受 Web UI 密碼');
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
