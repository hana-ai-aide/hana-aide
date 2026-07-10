#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
worktable-archive.py — Hana 工作台歸檔 + 結構稽核工具

支援 /task-archive 技能。三種模式（互斥）：

  --lint       只做結構稽核，回報錯位/斷裂/斷字。壞 → exit 1。
  --dry-run    先 lint，再列出每個 `# 字母.` 段的歸檔判定（可歸檔 / 有未完成 / 無勾選框），
               附字數，讓 Hana 判斷。不動任何檔案。
  --apply A,D  對「明確指定的段字母」執行歸檔（複製到 history/<date>_<letter>_<slug>.md、
               從 TASK.md 移除）。**apply 前一律先 lint，結構壞就拒絕動作。**
               段字母由 Hana 在人工確認分類後給，工具絕不自己決定要搬哪些。

判定「可歸檔」的定義（等同 worktable-convention.md §3）：
  某 `# 字母.` 段內「至少有一個勾選框」且「沒有任何 `- [ ]`」（每格都是 [x] 或 [~]）。

結構稽核規則（防 P 跨 Q 那類錯位；ID 前綴＝真相）：
  R1 phase-letter-mismatch：`## <階段ID>.` 的 ID 前綴字母 ≠ 所屬 `# 字母.` 段字母。
  R2 section-noncontiguous：同一個 `# 字母.` 段字母在檔案裡出現一次以上（被切斷）。
  R3 orphan-phase：`## 階段` 出現在任何 `# 字母.` 段之前（無所屬段）。

用法：
  python worktable-archive.py --lint [--task <path>]
  python worktable-archive.py --dry-run [--task <path>]
  python worktable-archive.py --apply P,Q --date 20260710 --slug-P p-inplace-edit --slug-Q meeting-summary
"""
import argparse
import os
import re
import sys

try:
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')
except Exception:
    pass

# --- 標題規則 --------------------------------------------------------------
SEC_RE   = re.compile(r'^# ([A-Z][A-Z0-9-]*)\. (.*)$') # # P. …  / # G-W. …  / # DV. …（代號可多字母）
PHASE_RE = re.compile(r'^## ([A-Za-z][A-Za-z0-9-]*)\. ')  # ## P2-PPTX. …  / ## Q1. …
OPEN_BOX = re.compile(r'^\s*- \[ \]')                 # 未完成
ANY_BOX  = re.compile(r'^\s*(?:- \[[x~/ ]\]|\[x\]|- \[x\]|.*🧑‍✈️.*\[[x ]\])')  # 任何勾選框（寬鬆）
BOX_RE   = re.compile(r'\[[x~/ ]\]')                  # 任一 [ ]/[x]/[~]/[/]


def phase_letters(phase_id):
    """取階段 ID 的前綴字母串：P2-PPTX→P、Q1→Q、P2-DOCX→P。"""
    m = re.match(r'^([A-Za-z]+)', phase_id)
    return m.group(1).upper() if m else ''


def parse(lines):
    """把 TASK.md 切成 `# 字母.` 段。回傳 [{letter,title,start,end,lines,phases[]}]。"""
    sections = []
    cur = None
    for i, ln in enumerate(lines):
        sm = SEC_RE.match(ln)
        if sm:
            if cur:
                cur['end'] = i
                sections.append(cur)
            code = sm.group(1)
            cur = {'code': code, 'letters': phase_letters(code),
                   'title': sm.group(2).strip(),
                   'start': i, 'end': None, 'phases': []}
            continue
        pm = PHASE_RE.match(ln)
        if pm:
            pid = pm.group(1)
            entry = {'id': pid, 'letters': phase_letters(pid), 'line': i,
                     'owner': cur['code'] if cur else None}
            if cur:
                cur['phases'].append(entry)
            else:
                # R3: 段之前的孤兒階段
                sections.append({'orphan_phase': entry})
    if cur:
        cur['end'] = len(lines)
        sections.append(cur)
    return sections


def lint(lines):
    """回傳問題清單 [(rule, msg, lineno)]。空＝結構乾淨。"""
    problems = []
    seen_codes = {}     # code -> 首次出現的段索引，抓 R2
    real_secs = [s for s in parse(lines) if 'code' in s]

    # R3：孤兒階段
    for s in parse(lines):
        if 'orphan_phase' in s:
            e = s['orphan_phase']
            problems.append(('R3-orphan-phase',
                             f"`## {e['id']}.` 出現在任何 `# 代號.` 段之前（無所屬段）",
                             e['line'] + 1))

    for idx, s in enumerate(real_secs):
        code = s['code']
        # R2：段代號重複出現＝被切斷
        if code in seen_codes:
            problems.append(('R2-section-noncontiguous',
                             f"`# {code}.` 段代號重複出現（第 {seen_codes[code]+1} 段又出現在第 {idx+1} 段）— 段被切斷",
                             s['start'] + 1))
        else:
            seen_codes[code] = idx
        # R1：階段 ID 前導字母 ≠ 段代號前導字母（G7 屬 G-W ✓；P2-PPTX 屬 Q ✗）
        for ph in s['phases']:
            if ph['letters'] and ph['letters'] != s['letters']:
                problems.append(('R1-phase-letter-mismatch',
                                 f"`## {ph['id']}.` 掛在 `# {code}.` 底下，但 ID 前導字母是 {ph['letters']}（應在 `# {ph['letters']}…` 段內）",
                                 ph['line'] + 1))
    return problems


def section_body(lines, sec):
    return lines[sec['start']:sec['end']]


def verdict(lines, sec):
    """判定某段：archivable / open / no-box。回傳 (verdict, n_open, n_box)。"""
    body = section_body(lines, sec)
    n_open = sum(1 for ln in body if OPEN_BOX.match(ln))
    n_box = sum(1 for ln in body if BOX_RE.search(ln))
    if n_box == 0:
        return ('no-box', n_open, n_box)
    if n_open > 0:
        return ('open', n_open, n_box)
    return ('archivable', n_open, n_box)


def cmd_lint(lines):
    problems = lint(lines)
    if not problems:
        print("✅ 結構乾淨：無錯位、無斷裂、無孤兒階段。")
        return 0
    print(f"❌ 發現 {len(problems)} 個結構問題：\n")
    for rule, msg, lineno in problems:
        print(f"  [{rule}] L{lineno}: {msg}")
    print("\n→ 錯位會讓歸檔誤判段邊界，apply 已被鎖住。請先修結構（把階段搬回所屬段）。")
    return 1


def cmd_dry_run(lines):
    rc = cmd_lint(lines)
    print("\n--- 各段歸檔判定 ---")
    for sec in [s for s in parse(lines) if 'code' in s]:
        v, n_open, n_box = verdict(lines, sec)
        body = section_body(lines, sec)
        nbytes = len('\n'.join(body).encode('utf-8'))
        tag = {'archivable': '🟢 可歸檔', 'open': '🟡 有未完成', 'no-box': '⚪ 無勾選框'}[v]
        extra = f"（{n_open} 個未完成）" if v == 'open' else ''
        print(f"  # {sec['code']}. {tag}{extra}  勾選框 {n_box}｜{nbytes}B｜{sec['title'][:40]}")
    if rc != 0:
        print("\n⚠️  結構有問題，上面的段邊界判定可能不準——先修結構再歸檔。")
    return rc


def cmd_apply(lines, letters, date, slugs, task_path):
    rc_lint = lint(lines)
    if rc_lint:
        print("❌ 結構稽核未過，拒絕歸檔。先跑 --lint 修好。")
        cmd_lint(lines)
        return 1

    secs = {s['code']: s for s in parse(lines) if 'code' in s}
    hist_dir = os.path.join(os.path.dirname(task_path), 'history')
    os.makedirs(hist_dir, exist_ok=True)

    to_remove = []   # (start, end)
    moved_bytes = 0
    for L in letters:
        if L not in secs:
            print(f"❌ 找不到 `# {L}.` 段，中止。")
            return 1
        sec = secs[L]
        v, n_open, _ = verdict(lines, sec)
        if v != 'archivable':
            print(f"❌ `# {L}.` 判定為 {v}（{n_open} 未完成），不可歸檔。中止。")
            return 1
        body = section_body(lines, sec)
        slug = slugs.get(L, sec['title'][:20])
        fn = os.path.join(hist_dir, f"{date}_{L}_{slug}.md")
        header = (f"# [歸檔 {date}] {sec['title']}\n\n"
                  f"> 由 /task-archive 於 {date} 從 TASK.md 歸檔（原 `# {L}.` 段，全數子項＋指揮官驗證已完成）。\n\n")
        content = header + '\n'.join(body).rstrip() + '\n'
        with open(fn, 'w', encoding='utf-8') as f:
            f.write(content)
        moved_bytes += len('\n'.join(body).encode('utf-8'))
        to_remove.append((sec['start'], sec['end']))
        print(f"  → 已寫 {os.path.basename(fn)}（{len(body)} 行）")

    # 由後往前刪，避免位移
    new_lines = list(lines)
    for start, end in sorted(to_remove, reverse=True):
        del new_lines[start:end]
    with open(task_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(new_lines).rstrip() + '\n')

    print(f"\n✅ 歸檔完成：{len(letters)} 段搬到 history，移出 {moved_bytes}B。TASK.md 已更新。")
    print("   （DASHBOARD 摘要與 git 提交由 /task-archive 技能／指揮官處理，本工具不碰。）")
    return 0


def main():
    ap = argparse.ArgumentParser(description='Hana 工作台歸檔 + 結構稽核')
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument('--lint', action='store_true')
    mode.add_argument('--dry-run', action='store_true')
    mode.add_argument('--apply', metavar='A,B,C', help='要歸檔的段字母（逗號分隔）')
    ap.add_argument('--task', default=None, help='TASK.md 路徑（預設 ./.worktable/TASK.md）')
    ap.add_argument('--date', default=None, help='歸檔日期 YYYYMMDD（apply 用）')
    ap.add_argument('--slug', action='append', default=[], help='段檔名 slug，格式 P=my-slug（apply 可多次）')
    args = ap.parse_args()

    task_path = args.task or os.path.join(os.getcwd(), '.worktable', 'TASK.md')
    if not os.path.exists(task_path):
        print(f"❌ 找不到 TASK.md：{task_path}")
        return 2
    with open(task_path, 'r', encoding='utf-8') as f:
        lines = f.read().split('\n')

    if args.lint:
        return cmd_lint(lines)
    if args.dry_run:
        return cmd_dry_run(lines)
    if args.apply:
        letters = [x.strip().upper() for x in args.apply.split(',') if x.strip()]
        if not args.date:
            print("❌ --apply 需 --date YYYYMMDD")
            return 2
        slugs = {}
        for s in args.slug:
            if '=' in s:
                k, v = s.split('=', 1)
                slugs[k.strip().upper()] = v.strip()
        return cmd_apply(lines, letters, args.date, slugs, task_path)


if __name__ == '__main__':
    sys.exit(main())
