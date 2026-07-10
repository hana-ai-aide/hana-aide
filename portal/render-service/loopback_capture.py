# -*- coding: utf-8 -*-
"""loopback_capture.py — F6 一次性電腦音訊（loopback）擷取器。

由 portal server spawn 成短命子行程：開系統 loopback、收音直到收尾條件成立，
轉一次文字、寫 result.json、退出。**不是**會議錄製（不建 meeting 物件、不即時分段轉錄）——
重用 meeting_record.py 的 resolve_devices()/make_reader()/drain()，不另寫收音。
設計見 specs/SPEC-floating-chat.md §6b.3。

收尾三選一：
  1. 手動：meetingDir 出現 STOP 控制檔（server /api/stt/loopback/stop 寫入，沿用既有慣例）。
  2. 靜音：偵測到至少一段語音後，連續 SILENCE_SECONDS 秒能量低於 ENERGY_THRESHOLD。
  3. 硬上限：MAX_DURATION_SECONDS 兜底（VAD 失靈時的保險）。

CLI：
    python loopback_capture.py --dir <captureDir> --lang zh --model medium
輸出：captureDir/result.json = {"text","language","duration","endedBy"}
"""
import sys
import os
import json
import time
import wave
import argparse
import threading

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

import numpy as np
import pyaudiowpatch as pyaudio

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import stt  # noqa: E402
from meeting_record import resolve_devices, make_reader, drain, TARGET_RATE  # noqa: E402

SILENCE_SECONDS = 10.0        # 連續靜音多久視為「來賓講完」，可調常數（待拍板 #10）
ENERGY_THRESHOLD = 0.012      # 比照 meeting_record.VadSegmenter 的能量門檻
MAX_DURATION_SECONDS = 300.0  # 5 分鐘硬上限兜底
POLL_INTERVAL = 0.1

# F6d/FVOICE2-02：即時逐字滾動切段（待拍板 #12）——每 ROLL_SECONDS 秒或偵測到
# ROLL_SILENCE_SECONDS 的句界靜默就切一段丟辨識，累積文字寫進 partial.json 供
# GET /api/stt/loopback/partial 輪詢讀取。常數可調。
ROLL_SECONDS = 4.0
ROLL_SILENCE_SECONDS = 0.6
ROLL_MIN_SAMPLES_RATIO = 0.3  # 段落至少要有 0.3 秒音框才值得丟去辨識，濾掉近乎空段
VAD_WINDOW_SECONDS = 0.1      # RMS/VAD 分析的固定小窗大小（見主迴圈註解，防大 chunk 稀釋能量）


def write_json_atomic(path, obj):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False)
    os.replace(tmp, path)


def log(msg):
    print("[loopback_capture] %s" % msg, file=sys.stderr)
    sys.stderr.flush()


def update_meta(capture_dir, **fields):
    meta_path = os.path.join(capture_dir, "meta.json")
    meta = {}
    try:
        with open(meta_path, "r", encoding="utf-8") as f:
            meta = json.load(f)
    except Exception:
        pass
    meta.update(fields)
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True, help="captureDir")
    ap.add_argument("--model", default="medium")
    ap.add_argument("--lang", default="zh")
    ap.add_argument("--prompt", default=None)
    args = ap.parse_args(argv)

    capture_dir = args.dir
    os.makedirs(capture_dir, exist_ok=True)
    stop_path = os.path.join(capture_dir, "STOP")
    audio_path = os.path.join(capture_dir, "audio.wav")
    result_path = os.path.join(capture_dir, "result.json")
    partial_path = os.path.join(capture_dir, "partial.json")
    seg_tmp_path = os.path.join(capture_dir, "seg_tmp.wav")
    write_json_atomic(partial_path, {"text": ""})

    update_meta(capture_dir, model=args.model, lang=args.lang,
                startedAt_proc=time.strftime("%Y-%m-%dT%H:%M:%S"), status="recording")

    p = pyaudio.PyAudio()
    devices = resolve_devices(p, "loopback")
    if not devices:
        update_meta(capture_dir, status="error", error="no loopback device")
        log("找不到系統 loopback 裝置，中止")
        p.terminate()
        with open(result_path, "w", encoding="utf-8") as f:
            json.dump({"text": "", "language": args.lang, "duration": 0.0, "endedBy": "error"}, f, ensure_ascii=False)
        return 2

    index, rate, channels, _label = devices[0]
    stop_evt = threading.Event()
    buf, lock = [], threading.Lock()
    # 先開 reader 別讓收音空窗：faster-whisper 首次預載要數秒，若等預載完才開始收音，開頭那幾秒
    # 使用者講的話會直接漏聽。改成 reader 先開始收、預載跟收音並行，backlog 用下面的「切窗分析」
    # 補救（見迴圈內註解）。
    reader = make_reader(p, index, rate, channels, buf, lock, stop_evt)

    # 預載模型，避免收尾後才卡模型載入
    try:
        stt._get_model(args.model)
    except Exception as e:
        log("模型預載失敗（將於轉錄時重試）：%s" % e)

    chunks = []
    heard_speech = False
    silence_run = 0.0
    start_time = time.time()
    ended_by = "manual"

    # 滾動切段狀態（即時逐字）：seg_buffer 是「這一段」尚未辨識的音框，切段後清空重算，
    # 與 chunks（整段完整音訊，供收尾後的最終轉錄）分開累積。
    seg_buffer = []
    seg_start_time = time.time()
    seg_silence_run = 0.0
    partial_parts = []
    partial_join = "" if (args.lang or "").lower().startswith("zh") else " "

    def cut_segment():
        nonlocal seg_buffer, seg_start_time, seg_silence_run
        seg_audio = np.concatenate(seg_buffer) if seg_buffer else np.zeros(0, dtype=np.float32)
        seg_buffer = []
        seg_start_time = time.time()
        seg_silence_run = 0.0
        if seg_audio.shape[0] < TARGET_RATE * ROLL_MIN_SAMPLES_RATIO:
            return
        i16 = (np.clip(seg_audio, -1.0, 1.0) * 32767.0).astype(np.int16)
        w = wave.open(seg_tmp_path, "wb")
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(TARGET_RATE)
        w.writeframes(i16.tobytes())
        w.close()
        try:
            seg_res = stt.transcribe_file(seg_tmp_path, lang=args.lang, model_size=args.model,
                                           initial_prompt=args.prompt, beam_size=1)
            seg_text = (seg_res.get("text") or "").strip()
        except Exception as e:
            log("滾動切段轉錄失敗（忽略、繼續收音）：%s" % e)
            seg_text = ""
        if seg_text:
            partial_parts.append(seg_text)
            write_json_atomic(partial_path, {"text": partial_join.join(partial_parts)})

    # VAD/切段一律用固定大小的小窗分析，別直接對 drain() 撈回來的整包算 RMS：模型預載（~數秒）
    # 期間 reader 執行緒仍持續收音進 buf，第一次 drain() 常會撈到橫跨數秒的巨大 chunk，若整包算一
    # 個 RMS 會把真正的語音跟前後靜音平均在一起、稀釋到低於門檻，導致 heard_speech 永遠不翻 True
    # （即時逐字與既有的靜音自動收尾都會失靈）。切小窗後不管 drain() 一次撈回多少都能正確辨識。
    win_samples = max(1, int(TARGET_RATE * VAD_WINDOW_SECONDS))

    log("開始擷取電腦音訊（loopback）。靜音 %ss 或滿 %ss 自動收尾，或等 STOP 檔。" %
        (SILENCE_SECONDS, MAX_DURATION_SECONDS))
    try:
        while True:
            if os.path.exists(stop_path):
                ended_by = "manual"
                break
            chunk = drain(buf, lock)
            for wstart in range(0, chunk.shape[0], win_samples):
                sub = chunk[wstart:wstart + win_samples]
                if not sub.shape[0]:
                    continue
                chunks.append(sub)
                seg_buffer.append(sub)
                rms = float(np.sqrt(np.mean(sub ** 2)))
                dt = sub.shape[0] / TARGET_RATE
                if rms > ENERGY_THRESHOLD:
                    heard_speech = True
                    silence_run = 0.0
                    seg_silence_run = 0.0
                elif heard_speech:
                    silence_run += dt
                    seg_silence_run += dt
                if heard_speech and seg_buffer and (
                        (time.time() - seg_start_time) >= ROLL_SECONDS or seg_silence_run >= ROLL_SILENCE_SECONDS):
                    cut_segment()
            if heard_speech and silence_run >= SILENCE_SECONDS:
                ended_by = "silence"
                break
            if (time.time() - start_time) >= MAX_DURATION_SECONDS:
                ended_by = "maxDuration"
                break
            time.sleep(POLL_INTERVAL)
    finally:
        stop_evt.set()
        try: reader.join(timeout=2.0)
        except Exception: pass
        try: os.remove(seg_tmp_path)
        except Exception: pass

    audio = np.concatenate(chunks) if chunks else np.zeros(0, dtype=np.float32)
    i16 = (np.clip(audio, -1.0, 1.0) * 32767.0).astype(np.int16)
    wav = wave.open(audio_path, "wb")
    wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(TARGET_RATE)
    wav.writeframes(i16.tobytes())
    wav.close()

    text = ""
    language = args.lang
    duration = audio.shape[0] / TARGET_RATE
    if audio.shape[0] > 0:
        try:
            # F7 (§6b.8): 互動 loopback 收尾用 beam_size=1（greedy，與 F4 麥克風、滾動切段一致），
            # 比預設 5 快一截，對齊即時逐字的低延遲目標；會議轉錄才用預設 5。
            res = stt.transcribe_file(audio_path, lang=args.lang, model_size=args.model, initial_prompt=args.prompt, beam_size=1)
            text = (res.get("text") or "").strip()
            language = res.get("language") or args.lang
            duration = res.get("duration") or duration
        except Exception as e:
            log("轉錄失敗：%s" % e)

    with open(result_path, "w", encoding="utf-8") as f:
        json.dump({"text": text, "language": language, "duration": duration, "endedBy": ended_by},
                   f, ensure_ascii=False)
    try: os.remove(stop_path)
    except Exception: pass
    update_meta(capture_dir, finishedAt=time.strftime("%Y-%m-%dT%H:%M:%S"), status="done", endedBy=ended_by)
    log("擷取結束（%s），文字長度=%d" % (ended_by, len(text)))

    sys.stdout.flush(); sys.stderr.flush()
    # PyAudioWPatch 的 PortAudio teardown 在 WASAPI loopback 下會 segfault（exit 139）——
    # 資料已落碟，直接 os._exit(0) 跳過 atexit / PortAudio 析構（比照 meeting_record.py）。
    os._exit(0)


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except KeyboardInterrupt:
        sys.exit(0)
