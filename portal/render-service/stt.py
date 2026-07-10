# -*- coding: utf-8 -*-
"""stt.py — 共用語音辨識模組（faster-whisper + OpenCC 繁體後處理）

單一職責：給一個音檔 → 回文字。會議錄製（meeting_record.py）、portal 麥克風
（/api/stt → F4）、Telegram 語音（F5）全部呼叫這支。

設計見 specs/SPEC-meeting-transcriber.md §3 與 SPEC-floating-chat.md §6。

函式介面：
    transcribe_file(audio_path, lang="auto", model_size="medium", initial_prompt=None) -> dict
回傳：
    { "text": str,            # 已做繁體轉換（若偵測/指定為 zh）
      "language": str, "duration": float,
      "segments": [ {"start": float, "end": float, "text": str}, ... ] }

CLI（給 node spawn）：
    python stt.py <audio> --lang zh --model medium [--prompt "人名/術語"]
    → 把上述 dict 以 JSON 單行印到 stdout；錯誤走 stderr + 非 0 exit。

鐵律：寫檔/輸出一律 utf-8；呼叫端帶 PYTHONUTF8=1（Windows console 是 cp950）。
"""
import sys
import os
import json
import argparse

# Windows console 是 cp950，印中文/® 會炸 → 強制 stdout/stderr 走 utf-8。
# 用 reconfigure（保留原串流物件）而非重包 TextIOWrapper——後者在行程 teardown 時會丟
# "I/O operation on closed file"。
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

# Windows 上 pip 裝的 nvidia-cublas-cu12/nvidia-cudnn-cu12 不會自動掛進 DLL 搜尋路徑。
# ctranslate2 用 cuda 時是靠 PATH 環境變數找 cublas64_12.dll/cudnn64_9.dll（實測
# os.add_dll_directory 對它無效，它認的是 PATH）——沒掛上會在第一次 encode() 才炸，
# 不是 import 期，容易誤以為模型已經在吃 GPU。
if sys.platform == "win32":
    _venv_root = os.path.dirname(os.path.dirname(sys.executable))  # ...\.venv\Scripts\python.exe → ...\.venv
    _bins = [os.path.join(_venv_root, "Lib", "site-packages", "nvidia", _pkg, "bin")
             for _pkg in ("cublas", "cudnn", "cuda_nvrtc")]
    _bins = [b for b in _bins if os.path.isdir(b)]
    if _bins:
        os.environ["PATH"] = os.pathsep.join(_bins) + os.pathsep + os.environ.get("PATH", "")

# ── 模型快取（singleton per size）──────────────────────────────────────────
# WhisperModel 載入要 ~3-20s；同 size 在行程內只載一次。會議錄製是長駐行程，
# 每個 chunk 都呼叫 transcribe_file → 絕不可每次重載。
_MODEL_CACHE = {}
# OpenCC 轉換器也快取（簡體→台灣繁體用語）。
_OPENCC = None

# 模型快取目錄：電腦共用（多專案/多 whisper 用途都吃同一份），不專屬 _harness，
# 故不放專案目錄下，改放 D:\Models（可用 HANA_STT_MODEL_DIR 覆蓋）。
MODEL_DOWNLOAD_ROOT = os.environ.get("HANA_STT_MODEL_DIR", r"D:\Models\huggingface\hub")

_DEVICE = None  # (device, compute_type) 快取，避免每次都重新偵測


def _detect_device():
    global _DEVICE
    if _DEVICE is None:
        try:
            import ctranslate2
            if ctranslate2.get_cuda_device_count() > 0:
                _DEVICE = ("cuda", "float16")
            else:
                _DEVICE = ("cpu", "int8")
        except Exception:
            _DEVICE = ("cpu", "int8")
    return _DEVICE

# F6d：中文辨識常整段黏一串、無標點——Whisper 對中文的已知脾氣（OpenCC 只管簡→繁，不加標點）。
# 預設餵一段「本身帶標點」的中文 initial_prompt，讓 Whisper 模仿其書寫風格補逗號/句號/斷句。
# 只在呼叫端未指定 prompt 且語言為中文/auto 時套用；呼叫端仍可傳自己的 --prompt（人名/術語）覆蓋。
DEFAULT_PUNCT_PROMPT_ZH = "以下是一段中文對話，語氣自然，包含逗號、句號、問號等標點符號。"


def _get_model(model_size):
    if model_size not in _MODEL_CACHE:
        from faster_whisper import WhisperModel
        device, compute_type = _detect_device()
        # 有 GPU 用 cuda+float16（快且準）；沒有退回原本驗證過的 CPU+int8。
        _MODEL_CACHE[model_size] = WhisperModel(
            model_size, device=device, compute_type=compute_type,
            download_root=MODEL_DOWNLOAD_ROOT,
        )
    return _MODEL_CACHE[model_size]


def _to_traditional(text):
    """簡體 → 台灣繁體（含用語轉換，如 '程序'→'程式'）。Whisper 預設吐簡體。"""
    global _OPENCC
    if not text:
        return text
    try:
        if _OPENCC is None:
            from opencc import OpenCC
            _OPENCC = OpenCC("s2twp")
        return _OPENCC.convert(text)
    except Exception as e:
        # OpenCC 缺失不該讓整條鏈死掉：退回原文，但在 stderr 留痕。
        print("[stt] OpenCC 轉繁失敗，退回原文：%s" % e, file=sys.stderr)
        return text


def transcribe_file(audio_path, lang="auto", model_size="medium", initial_prompt=None, beam_size=5):
    if not audio_path or not os.path.exists(audio_path):
        raise FileNotFoundError("找不到音檔：%s" % audio_path)

    model = _get_model(model_size)
    language = None if (not lang or lang == "auto") else lang
    prompt = initial_prompt
    if prompt is None and (lang in (None, "auto", "zh")):
        prompt = DEFAULT_PUNCT_PROMPT_ZH
    segments_iter, info = model.transcribe(
        audio_path,
        language=language,
        initial_prompt=prompt,
        vad_filter=True,            # 去靜音段，降低空轉與幻聽
        beam_size=beam_size,        # 互動路徑用 1（greedy，短句夠準又快）；會議可用 5
    )

    detected = info.language if info and getattr(info, "language", None) else (language or "")
    is_zh = (detected or "").lower().startswith("zh")

    segments = []
    parts = []
    for seg in segments_iter:
        t = seg.text or ""
        if is_zh:
            t = _to_traditional(t)
        t = t.strip()
        segments.append({"start": float(seg.start), "end": float(seg.end), "text": t})
        if t:
            parts.append(t)

    # 中文段間不加空白；其餘語言以空白接合。
    text = ("" if is_zh else " ").join(parts).strip()
    duration = float(getattr(info, "duration", 0.0) or 0.0)
    return {"text": text, "language": detected, "duration": duration, "segments": segments}


def _serve(default_model):
    """常駐模式（F4/F5 延遲修正）：模型只載一次，之後從 stdin 逐行讀 JSON 請求、回 JSON 行。

    每行請求：{"id":N, "audio":path, "lang":"zh", "model":"medium", "beam_size":1, "prompt":null}
    每行回應：{"id":N, "text":..., "language":..., "duration":..., "segments":[...]}  或  {"id":N,"error":...}
    stdout 只寫 JSON 行；所有 log 走 stderr（不可污染 stdout，否則 node 端 JSON.parse 會炸）。
    """
    try:
        _get_model(default_model)   # 啟動時預載 → 連第一個請求都免重載
    except Exception as e:
        print("[stt] 預載模型失敗：%s" % e, file=sys.stderr)
    print("[stt] serve ready (model=%s)" % default_model, file=sys.stderr)
    sys.stderr.flush()
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        rid = None
        try:
            req = json.loads(line)
            rid = req.get("id")
            result = transcribe_file(
                req.get("audio"),
                lang=req.get("lang", "auto"),
                model_size=req.get("model", default_model),
                initial_prompt=req.get("prompt"),
                beam_size=int(req.get("beam_size", 5)),
            )
            result["id"] = rid
            sys.stdout.write(json.dumps(result, ensure_ascii=False) + "\n")
        except Exception as e:
            sys.stdout.write(json.dumps({"id": rid, "error": str(e)}, ensure_ascii=False) + "\n")
        sys.stdout.flush()
    return 0


def _main(argv):
    ap = argparse.ArgumentParser(description="STT：音檔 → 文字（繁體後處理）")
    ap.add_argument("audio", nargs="?", help="輸入音檔路徑（wav/mp3/ogg/...）；--serve 模式可省略")
    ap.add_argument("--lang", default="auto", help="auto | zh | en | ...")
    ap.add_argument("--model", default="medium", help="tiny/base/small/medium/large-v3")
    ap.add_argument("--prompt", default=None, help="領域詞彙（人名/術語）提升準度")
    ap.add_argument("--beam-size", type=int, default=5, help="互動短句建議 1（greedy）；會議用 5")
    ap.add_argument("--serve", action="store_true", help="常駐模式：模型載一次，從 stdin 逐行收 JSON 請求")
    args = ap.parse_args(argv)
    if args.serve:
        return _serve(args.model)
    if not args.audio:
        ap.error("需要 audio 路徑（或加 --serve 進常駐模式）")
    result = transcribe_file(args.audio, lang=args.lang, model_size=args.model,
                             initial_prompt=args.prompt, beam_size=args.beam_size)
    # 單行 JSON 到 stdout（node 端 JSON.parse）。ensure_ascii=False 保留中文原樣。
    sys.stdout.write(json.dumps(result, ensure_ascii=False))
    sys.stdout.flush()
    return 0


if __name__ == "__main__":
    try:
        sys.exit(_main(sys.argv[1:]))
    except Exception as e:
        print("[stt] 錯誤：%s" % e, file=sys.stderr)
        sys.exit(1)
