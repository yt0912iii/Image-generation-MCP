import os
import sys
import json

print(">>> [步驟 1] Python 腳本已成功啟動！", flush=True)

# 1. 取得目前所在目錄
current_dir = os.path.dirname(os.path.abspath(__file__))
print(f">>> [步驟 2] 當前執行目錄: {current_dir}", flush=True)

# 2. 列出當前目錄下的所有資料夾與檔案
files_in_dir = os.listdir(current_dir)
print(f">>> [步驟 3] 目錄下的檔案與資料夾清單: {files_in_dir}", flush=True)

# 3. 尋找含有 .txt 的目錄或 Sensitive-lexicon
lexicon_dir = None
for name in files_in_dir:
    full_path = os.path.join(current_dir, name)
    if os.path.isdir(full_path) and "sensitive" in name.lower():
        lexicon_dir = full_path
        break

if not lexicon_dir:
    # 檢查是否直接把 txt 放在當前目錄
    txt_here = [f for f in files_in_dir if f.endswith(".txt")]
    if txt_here:
        lexicon_dir = current_dir

print(f">>> [步驟 4] 鎖定詞庫目錄: {lexicon_dir}", flush=True)

# 4. 掃描所有 .txt 檔案並計算詞數
total_words = set()
txt_count = 0

if lexicon_dir and os.path.exists(lexicon_dir):
    for root, _, files in os.walk(lexicon_dir):
        for f in files:
            if f.endswith(".txt"):
                txt_count += 1
                txt_path = os.path.join(root, f)
                try:
                    with open(txt_path, "r", encoding="utf-8", errors="ignore") as file_obj:
                        lines = [l.strip() for l in file_obj if l.strip() and not l.startswith("#")]
                        total_words.update(lines)
                        print(f"    ✓ 讀取檔案 [{f}]: 找到 {len(lines)} 個詞彙", flush=True)
                except Exception as err:
                    print(f"    ✗ 讀取 [{f}] 發生錯誤: {err}", flush=True)

print(f">>> [步驟 5] 掃描結果: 共讀取 {txt_count} 個 txt 檔，合計 {len(total_words)} 個不重複詞彙", flush=True)

# 5. 寫入 blocked_keywords.json
if total_words:
    out_path = os.path.join(current_dir, "blocked_keywords.json")
    with open(out_path, "w", encoding="utf-8") as out_file:
        json.dump(sorted(list(total_words)), out_file, ensure_ascii=False, indent=2)
    print(f">>> [步驟 6] 成功寫入至: {out_path}", flush=True)
else:
    print(">>> [警告] 未讀取到任何詞彙，請檢查 txt 檔案位置！", flush=True)

print(">>> [完成] 執行完畢！", flush=True)