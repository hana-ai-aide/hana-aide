# -*- coding: utf-8 -*-
"""diarize.py — G2 語者分離（pyannote）+ 會後改名 remap

設計見 specs/SPEC-meeting-transcriber.md §6。簡單版：會後對 audio.wav 一次跑，
文字優先（即時不標）；會議當下當機只丟標籤、不丟文字（文字已由 meeting_record.py 即時存）。

HF_TOKEN 鐵律：只從 os.environ['HF_TOKEN'] 讀；找不到就明確報錯中止（不硬猜、絕不寫進
任何檔/log/訊息）。需 torch + pyannote.audio（裝在同一個 venv）。

CLI（分離）：
    python diarize.py --dir <meetingDir>
      → 對 audio.wav 跑 speaker-diarization-3.1 → 與 transcript.txt 時間戳對齊
      → 每行掛 人員A/B/C → 寫 transcript.labeled.txt + diarization.json

CLI（會後改名）：
    python diarize.py remap --dir <meetingDir> --map "人員A=王經理,人員B=李工"
      → 對 transcript.labeled.txt 做 find-replace，覆寫成最終完整逐字稿
"""
import sys
import os
import re
import json
import argparse

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

TS_RE = re.compile(r"^\[(\d{2}):(\d{2}):(\d{2})\]\s*(.*)$")


def log(msg):
    print("[diarize] %s" % msg, file=sys.stderr)
    sys.stderr.flush()


def ts_to_seconds(h, m, s):
    return int(h) * 3600 + int(m) * 60 + int(s)


def load_waveform(path):
    """讀 wav 成 (waveform[channel,time] float32, sample_rate)。

    用標準庫 wave + numpy，刻意不依賴 torchcodec/soundfile——pyannote 4 的內建解碼走
    torchcodec，需要 FFmpeg full-shared DLL；本機沒裝會在解碼時炸。改成預載入記憶體、
    以 {'waveform','sample_rate'} dict 餵 pipeline，徹底繞過 torchcodec（官方建議解法）。
    """
    import wave
    import numpy as np
    with wave.open(path, "rb") as wf:
        nch = wf.getnchannels()
        sw = wf.getsampwidth()
        sr = wf.getframerate()
        raw = wf.readframes(wf.getnframes())
    if sw == 2:
        data = np.frombuffer(raw, dtype="<i2").astype("float32") / 32768.0
    elif sw == 1:
        data = (np.frombuffer(raw, dtype=np.uint8).astype("float32") - 128.0) / 128.0
    elif sw == 4:
        data = np.frombuffer(raw, dtype="<i4").astype("float32") / 2147483648.0
    else:
        raise ValueError("不支援的 wav sampwidth=%d" % sw)
    if nch > 1:
        data = data.reshape(-1, nch).T  # (channel, time)
    else:
        data = data.reshape(1, -1)
    return data, sr


def label_for(idx):
    """0→人員A, 1→人員B, ... 26→人員AA（夠用）。"""
    letters = ""
    n = idx
    while True:
        letters = chr(ord("A") + (n % 26)) + letters
        n = n // 26 - 1
        if n < 0:
            break
    return "人員" + letters


def run_diarize(meeting_dir, num_speakers=None, min_speakers=None, max_speakers=None):
    audio_path = os.path.join(meeting_dir, "audio.wav")
    transcript_path = os.path.join(meeting_dir, "transcript.txt")
    if not os.path.exists(audio_path):
        log("找不到 audio.wav：%s" % audio_path)
        return 2

    token = os.environ.get("HF_TOKEN")
    if not token:
        log("環境變數 HF_TOKEN 未設定 → 無法載入 pyannote/speaker-diarization-3.1。"
            "請先設好 HF_TOKEN 並同意模型條款後重試。")
        return 3

    try:
        from pyannote.audio import Pipeline
        import torch
    except Exception as e:
        log("匯入 pyannote/torch 失敗（請確認已裝進此 venv）：%s" % e)
        return 4

    log("載入 pyannote pipeline…")
    pipeline = None
    last_err = None
    # 不同 pyannote.audio 版本對 token 參數命名不同（舊：use_auth_token，新：token）。兩者都試。
    for kw in ("use_auth_token", "token"):
        try:
            pipeline = Pipeline.from_pretrained("pyannote/speaker-diarization-3.1", **{kw: token})
            break
        except TypeError as e:
            last_err = e
            continue
        except Exception as e:
            last_err = e
            break
    if pipeline is None:
        log("載入 pipeline 失敗（token 無效或未同意條款？）：%s" % str(last_err))
        return 5
    try:
        pipeline.to(torch.device("cpu"))
    except Exception:
        pass

    # 發言人數提示（§6.1）：num_speakers 確切；否則 min/max 範圍。數的是「有發言的聲音」非與會人頭。
    dkw = {}
    if num_speakers:
        dkw["num_speakers"] = int(num_speakers)
    else:
        if min_speakers:
            dkw["min_speakers"] = int(min_speakers)
        if max_speakers:
            dkw["max_speakers"] = int(max_speakers)
    if dkw:
        log("發言人數提示：%s" % dkw)

    log("跑語者分離（CPU，視長度可能數分鐘）…")
    # 預載入記憶體再餵 dict，繞過 torchcodec（見 load_waveform 註解）；萬一讀檔失敗才退回路徑。
    try:
        import torch as _torch
        wav, sr = load_waveform(audio_path)
        diarization = pipeline({"waveform": _torch.from_numpy(wav), "sample_rate": sr}, **dkw)
    except Exception as e:
        log("記憶體載入失敗（%s），退回直接餵路徑。" % e)
        diarization = pipeline(audio_path, **dkw)

    # pyannote 的 SPEAKER_xx → 人員A/B/C（依首次出現順序）
    order = {}
    segs = []
    for turn, _, speaker in diarization.itertracks(yield_label=True):
        if speaker not in order:
            order[speaker] = label_for(len(order))
        name = order[speaker]
        segs.append({"start": float(turn.start), "end": float(turn.end), "speaker": name})
    segs.sort(key=lambda x: x["start"])

    with open(os.path.join(meeting_dir, "diarization.json"), "w", encoding="utf-8") as f:
        json.dump(segs, f, ensure_ascii=False, indent=2)
    log("偵測到 %d 位語者、%d 個語段。" % (len(order), len(segs)))

    # 與 transcript.txt 時間戳對齊：每行的 [HH:MM:SS] 是該段在錄音中的起始秒。
    def speaker_at(t):
        # 落在某語段內 → 該語者；否則取最接近者。
        best, best_d = None, 1e18
        for sg in segs:
            if sg["start"] <= t <= sg["end"]:
                return sg["speaker"]
            d = min(abs(t - sg["start"]), abs(t - sg["end"]))
            if d < best_d:
                best, best_d = sg["speaker"], d
        return best or label_for(0)

    labeled_lines = []
    if os.path.exists(transcript_path):
        with open(transcript_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.rstrip("\n")
                mt = TS_RE.match(line)
                if not mt:
                    if line.strip():
                        labeled_lines.append(line)
                    continue
                h, m, s, text = mt.group(1), mt.group(2), mt.group(3), mt.group(4)
                spk = speaker_at(ts_to_seconds(h, m, s))
                labeled_lines.append("[%s:%s:%s] %s：%s" % (h, m, s, spk, text))
    else:
        log("無 transcript.txt，只輸出 diarization.json。")

    labeled_path = os.path.join(meeting_dir, "transcript.labeled.txt")
    with open(labeled_path, "w", encoding="utf-8") as f:
        f.write("\n".join(labeled_lines) + ("\n" if labeled_lines else ""))
    log("已寫 %s" % labeled_path)
    # 摘要到 stdout（單行 JSON）供 server 解析
    sys.stdout.write(json.dumps({
        "speakers": list(order.values()), "segments": len(segs),
        "labeled": os.path.relpath(labeled_path, meeting_dir),
    }, ensure_ascii=False))
    sys.stdout.flush()
    return 0


def run_remap(meeting_dir, map_str):
    labeled_path = os.path.join(meeting_dir, "transcript.labeled.txt")
    if not os.path.exists(labeled_path):
        log("找不到 transcript.labeled.txt（請先跑 diarize）。")
        return 2
    # 解析 "人員A=王經理,人員B=李工"
    mapping = {}
    for pair in (map_str or "").split(","):
        pair = pair.strip()
        if "=" in pair:
            k, v = pair.split("=", 1)
            k, v = k.strip(), v.strip()
            if k and v:
                mapping[k] = v
    if not mapping:
        log("map 解析為空（格式：人員A=王經理,人員B=李工）。")
        return 3

    with open(labeled_path, "r", encoding="utf-8") as f:
        content = f.read()
    # 長 key 先換，避免 人員A 被 人員AA 之類影響（這裡 key 皆為 人員X，無重疊，但仍按長度排序保險）
    for k in sorted(mapping.keys(), key=len, reverse=True):
        content = content.replace(k, mapping[k])
    with open(labeled_path, "w", encoding="utf-8") as f:
        f.write(content)
    log("已 remap：%s" % "、".join("%s→%s" % (k, v) for k, v in mapping.items()))
    sys.stdout.write(json.dumps({"remapped": mapping, "labeled": "transcript.labeled.txt"}, ensure_ascii=False))
    sys.stdout.flush()
    return 0


def main(argv):
    if argv and argv[0] == "remap":
        ap = argparse.ArgumentParser()
        ap.add_argument("mode")
        ap.add_argument("--dir", required=True)
        ap.add_argument("--map", required=True)
        args = ap.parse_args(argv)
        return run_remap(args.dir, args.map)
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True)
    ap.add_argument("--speakers", type=int, default=None, help="發言人數（確切，會講話的人）")
    ap.add_argument("--min-speakers", type=int, default=None)
    ap.add_argument("--max-speakers", type=int, default=None)
    args = ap.parse_args(argv)
    return run_diarize(args.dir, num_speakers=args.speakers,
                       min_speakers=args.min_speakers, max_speakers=args.max_speakers)


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except Exception as e:
        log("錯誤：%s" % e)
        sys.exit(1)
