// 呼叫「已在執行中」的 MCP 伺服器生成一張頭像，存到 tests/_out/。
// 用法：npm run mcp:call -- "戴耳機的柴犬客服專員，3D 卡通風格"
// 連線位址與 Token 取自 .env：MCP_URL（選填，預設 http://127.0.0.1:<PORT>/mcp）、MCP_AUTH_TOKEN

import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

try {
  process.loadEnvFile(path.join(process.cwd(), '.env'));
} catch {}

const prompt = process.argv.slice(2).join(' ').trim() || '戴著耳機的柴犬客服專員，3D 卡通風格';
const url = process.env.MCP_URL || `http://127.0.0.1:${process.env.PORT || 8833}/mcp`;
const token = (process.env.MCP_AUTH_TOKEN || '').trim();

const client = new Client({ name: 'portrait-call', version: '1.0.0' });
try {
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    })
  );
} catch (err) {
  console.error(`無法連線 ${url}：${(err as Error).message}`);
  console.error('請確認已在另一個終端機執行 npm run mcp，且 .env 的 MCP_AUTH_TOKEN 與伺服器一致。');
  process.exit(1);
}

console.log(`連線 ${url}，提示詞：${prompt}`);
const started = Date.now();
const result: any = await client.callTool({ name: 'generate_portrait', arguments: { prompt } }, undefined, {
  timeout: 660_000,
  resetTimeoutOnProgress: true,
  onprogress: (p) => process.stdout.write(`\r  ${p.message ?? ''} ${p.progress}s   `),
});
process.stdout.write('\n');
await client.close();

for (const item of result.content ?? []) {
  if (item.type === 'image') {
    const dir = path.join(process.cwd(), 'tests', '_out');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `portrait-${Date.now()}.${String(item.mimeType).split('/')[1] || 'png'}`);
    fs.writeFileSync(file, Buffer.from(item.data, 'base64'));
    console.log(`已存檔：${file}`);
  } else if (item.type === 'text') {
    console.log(item.text);
  }
}
console.log(`耗時 ${((Date.now() - started) / 1000).toFixed(1)} 秒`);
process.exit(result.isError ? 1 : 0);
