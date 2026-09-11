import os
import sys
import json
import re
import subprocess

# 1. 強制設定標準輸出與錯誤為 UTF-8
if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')
if sys.stderr.encoding != 'utf-8':
    sys.stderr.reconfigure(encoding='utf-8')

def log(msg: str):
    """將訊息統一輸出到 stderr，防止干擾任何潛在的 MCP JSON-RPC 通訊"""
    sys.stderr.write(f"{msg}\n")
    sys.stderr.flush()

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
BLOCKED_FILE = os.path.join(BASE_DIR, "blocked_keywords.json")
WHITELIST_FILE = os.path.join(BASE_DIR, "whitelist.txt")

POSSIBLE_LEXICON_PATHS = [
    os.path.join(BASE_DIR, "Sensitive-lexicon"),
    os.path.join(os.path.dirname(BASE_DIR), "Sensitive-lexicon"),
    BASE_DIR
]

# 預設白名單：避免常見被開源字典誤傷的日常、學術與技術用語（同時收錄簡繁）
DEFAULT_WHITELIST = {
    "背景", "研究", "分析", "系統", "系统", "執行", "执行", "資訊", "资讯", "管理", "開發", "开发", "報告", "报告",
    "動機", "动机", "架構", "架构", "模型", "設計", "设计", "脈絡", "脉络", "經驗", "经验", "環境", "环境", "平台", "測試", "测试",
    "台北", "北京", "上海", "中國", "中国", "台灣", "台湾", "亞洲", "亚洲", "國家", "国家", "政府", "社會", "社会",
    "民主", "科學", "科学", "經濟", "经济", "市場", "市场", "公司", "單位", "单位", "組織", "组织", "人員", "人员", "教授",
    "管家", "企鵝", "企鹅", "蝴蝶結", "蝴蝶结", "燕尾服", "造型", "黏土"
}

def load_whitelist() -> set:
    """載入白名單（使用 utf-8-sig 自動清除 Windows 記事本的 BOM 標頭）"""
    whitelist = set(DEFAULT_WHITELIST)
    if os.path.exists(WHITELIST_FILE):
        try:
            with open(WHITELIST_FILE, "r", encoding="utf-8-sig") as f:
                for line in f:
                    w = line.strip()
                    if w and not w.startswith("#"):
                        whitelist.add(w)
            log(f"📋 [Lexicon] 成功載入白名單規則，共 {len(whitelist)} 個排除詞彙")
        except Exception as e:
            log(f"⚠️ [Lexicon] 讀取 whitelist.txt 失敗: {e}")
    return whitelist

def is_valid_keyword(word: str, whitelist: set) -> bool:
    """
    過濾規則：
    1. 長度小於 2 排除
    2. 純數字或單純英數字符號排除
    3. 命中白名單，或者包含白名單中的日常安全詞者一律排除（核心修正）
    """
    if len(word) < 2:
        return False
    if word.isdigit():
        return False
    if re.fullmatch(r"[A-Za-z0-9_\-\.\s]+", word):
        return False

    # 🎯 關鍵修正：若敏感詞包含任何白名單詞（例如包含「背景」），視為被誤殺詞，直接剃除
    for white_word in whitelist:
        if white_word in word:
            return False

    return True

def load_existing_keywords(whitelist: set) -> set:
    """讀取原檔 blocked_keywords.json，並用白名單徹底清洗歷史殘留的誤殺詞"""
    existing_words = set()
    filtered_count = 0
    
    if os.path.exists(BLOCKED_FILE):
        try:
            with open(BLOCKED_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, list):
                    for w in data:
                        w_clean = str(w).strip()
                        if is_valid_keyword(w_clean, whitelist):
                            existing_words.add(w_clean)
                        else:
                            filtered_count += 1
            log(f"📖 [步驟 1/3] 讀取現有原檔: 保留 {len(existing_words)} 個有效詞 (已清洗剔除 {filtered_count} 個單字/白名單詞彙)")
        except Exception as e:
            log(f"⚠️ [Lexicon] 讀取現有 {BLOCKED_FILE} 失敗，從空詞庫開始: {e}")
    else:
        log("ℹ️ [Lexicon] 尚未發現現有 blocked_keywords.json，將建立新檔案")
    return existing_words

def auto_git_pull(repo_dir: str):
    """若目錄為 git 儲存庫則執行同步"""
    git_dir = os.path.join(repo_dir, ".git")
    if os.path.exists(git_dir):
        log(f"🔄 [Lexicon] 正在遠端同步 (git pull): {repo_dir}")
        try:
            res = subprocess.run(
                ["git", "-C", repo_dir, "pull"],
                capture_output=True,
                text=True,
                encoding="utf-8",
                timeout=10
            )
            if res.returncode == 0:
                log(f"  ✓ Git 更新完成: {res.stdout.strip()}")
            else:
                log(f"  ⚠️ Git 回應: {res.stderr.strip() or res.stdout.strip()}")
        except Exception as e:
            log(f"  ⚠️ Git pull 略過: {e}")

def main():
    log("=" * 60)
    log("🚀 啟動敏感詞庫增量同步與清洗作業...")
    log("=" * 60)

    whitelist = load_whitelist()
    combined_set = load_existing_keywords(whitelist)
    initial_count = len(combined_set)

    target_dir = None
    for p in POSSIBLE_LEXICON_PATHS:
        if os.path.exists(p) and os.path.isdir(p):
            txts = [f for f in os.listdir(p) if f.endswith(".txt")]
            if txts or os.path.exists(os.path.join(p, ".git")):
                target_dir = p
                break

    loaded_files = 0
    new_words_count = 0
    rejected_by_whitelist = 0

    if target_dir:
        log(f"📁 [步驟 2/3] 掃描詞庫目錄: {target_dir}")
        auto_git_pull(target_dir)

        for root, _, files in os.walk(target_dir):
            for file in files:
                if file.endswith(".txt") and not file.startswith(".") and file != "whitelist.txt":
                    file_path = os.path.join(root, file)
                    try:
                        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                            for line in f:
                                word = line.strip()
                                if not word or word.startswith("#"):
                                    continue
                                
                                if is_valid_keyword(word, whitelist):
                                    if word not in combined_set:
                                        new_words_count += 1
                                        combined_set.add(word)
                                else:
                                    rejected_by_whitelist += 1
                        
                        loaded_files += 1
                    except Exception as e:
                        log(f"  ✗ 讀取 {file} 失敗: {e}")

        log(f"  ✓ 成功掃描 {loaded_files} 個文字檔")
        log(f"  ✓ 新增有效詞: {new_words_count} 個 (已攔截過濾 {rejected_by_whitelist} 個低質/白名單詞彙)")
    else:
        log("⚠️ 未找到本地 Sensitive-lexicon 資料夾，僅清洗現有詞庫。")

    # 排序並寫入結果
    result_list = sorted(list(combined_set))
    with open(BLOCKED_FILE, "w", encoding="utf-8") as f:
        json.dump(result_list, f, ensure_ascii=False, indent=2)

    log("-" * 60)
    log(f"🎉 [步驟 3/3] 詞庫整合寫入完成！")
    log(f"📊 最終有效詞彙: {len(result_list)} 詞 (本次淨增加: {len(result_list) - initial_count} 詞)")
    log(f"📁 已安全更新至: {BLOCKED_FILE}")
    log("=" * 60)

if __name__ == "__main__":
    main()