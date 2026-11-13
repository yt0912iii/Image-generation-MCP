// 呼叫「已在執行中」的伺服器生成一張頭像，存到 tests/_out/。
// 用法：npm run portrait:call -- "戴耳機的柴犬客服專員，3D 卡通風格"
// 位址與 Token 取自 .env：PORTRAIT_API_URL（選填，預設 http://127.0.0.1:<PORT>）、PORTRAIT_API_TOKEN

import fs from 'node:fs';
import path from 'node:path';

try {
  process.loadEnvFile(path.join(process.cwd(), '.env'));
} catch {}

const prompt = process.argv.slice(2).join(' ').trim() || '戴著耳機的柴犬客服專員，3D 卡通風格';
const base = (process.env.PORTRAIT_API_URL || `http://127.0.0.1:${process.env.PORT || 8833}`).replace(/\/+$/, '');
const token = (process.env.PORTRAIT_API_TOKEN || process.env.MCP_AUTH_TOKEN || '').trim();

console.log(`呼叫 ${base}/api/portraits/generate，提示詞：${prompt}`);
const started = Date.now();
let response: Response;
try {
  response = await fetch(`${base}/api/portraits/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ prompt }),
    signal: AbortSignal.timeout(660_000),
  });
} catch (err) {
  console.error(`無法連線：${(err as Error).message}`);
  console.error('請確認已在另一個終端機執行 npm run mcp，且 .env 的 Token 與伺服器一致。');
  process.exit(1);
}

if (!response.ok) {
  console.error(`失敗 HTTP ${response.status}：${await response.text()}`);
  process.exit(1);
}
const image = Buffer.from(await response.arrayBuffer());
const dir = path.join(process.cwd(), 'tests', '_out');
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `portrait-${Date.now()}.png`);
fs.writeFileSync(file, image);
console.log(`已存檔：${file}（${image.length} bytes）`);
console.log(
  `seed=${response.headers.get('x-portrait-seed')} translated=${response.headers.get('x-portrait-translated')}`
);
console.log(`耗時 ${((Date.now() - started) / 1000).toFixed(1)} 秒`);
