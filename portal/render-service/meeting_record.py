# -*- coding: utf-8 -*-
"""meeting_record.py — G1 核心錄製器（收音 → 分塊即時轉 → 防當機 append → 存 audio.wav）

由 portal spawn 成長駐子行程；以「STOP 控制檔」停止（見 SPEC §8，Windows 無 POSIX signal，
硬殺會毀最後一段與 wav 尾巴）。設計見 specs/SPEC-meeting-transcriber.md §5、§8。

CLI：
    python meeting_record.py --dir <meetingDir> --source both --model medium --lang zh [--chunk-seconds 20]

命脈：每段轉完立刻 append 到 transcript.txt 並 flush + os.fsync()——電腦中途當掉，
已轉內容全保得住（最多丟最後一個 chunk）。

第一版決策（§11 待拍板採預設）：定時分塊（非 VAD）、wav（非 opus）、both=混音單路。
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

# 同目錄的共用 STT 模組（同行程 import，不另 spawn → 共用 WhisperModel singleton + OpenCC）。
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import stt  # noqa: E402

TARGET_RATE = 16000          # faster-whisper 的工作取樣率；wav 也以此寫出（mono int16）
READ_FRAMES = 1600           # 每次 read 的 frame 數（約 0.03~0.1s，視來源原生率）


def log(msg):
    print("[meeting] %s" % msg, file=sys.stderr)
    sys.stderr.flush()


def fmt_ts(seconds):
    s = int(seconds)
    return "%02d:%02d:%02d" % (s // 3600, (s % 3600) // 60, s % 60)


def resolve_devices(p, source):
    """回傳要開的來源清單 [(index, rate, channels, label), ...]。名稱/預設動態解析，勿寫死 index。"""
    devices = []
    if source in ("mic", "both"):
        try:
            di = p.get_default_input_device_info()
            devices.append((di["index"], int(di["defaultSampleRate"]),
                            int(di["maxInputChannels"]) or 1, "mic"))
        except Exception as e:
            log("找不到預設麥克風：%s" % e)
    if source in ("loopback", "both"):
        lb = None
        try:
            lb = p.get_default_wasapi_loopback()   # 預設輸出的 loopback（系統正在播的聲音）
        except Exception:
            lb = None
        if lb is None:
            # 後援：掃描名稱含 [Loopback] 的裝置
            for i in range(p.get_device_count()):
                info = p.get_device_info_by_index(i)
                if "[Loopback]" in info.get("name", "") and info.get("maxInputChannels", 0) > 0:
                    lb = info
                    break
        if lb is not None:
            devices.append((lb["index"], int(lb["defaultSampleRate"]),
                            int(lb["maxInputChannels"]) or 1, "loopback"))
        else:
            log("找不到系統 loopback 裝置（系統音無法錄）")
    return devices


def make_reader(p, index, rate, channels, buf, lock, stop_evt):
    """開一條 input stream，持續讀 → 降為單聲道 → 重採樣到 16k float32 → 進 buf。"""
    stream = p.open(format=pyaudio.paInt16, channels=channels, rate=rate,
                    input=True, input_device_index=index, frames_per_buffer=READ_FRAMES)

    def run():
        while not stop_evt.is_set():
            try:
                data = stream.read(READ_FRAMES, exception_on_overflow=False)
            except Exception as e:
                log("讀取中斷：%s" % e)
                break
            arr = np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32768.0
            if channels > 1:
                arr = arr.reshape(-1, channels).mean(axis=1)
            if rate != TARGET_RATE and arr.shape[0] > 0:
                n = arr.shape[0]
                m = int(round(n * TARGET_RATE / rate))
                if m > 0:
                    arr = np.interp(np.linspace(0, 1, m, endpoint=False),
                                    np.linspace(0, 1, n, endpoint=False), arr).astype(np.float32)
            with lock:
                buf.append(arr)
        try:
            stream.stop_stream(); stream.close()
        except Exception:
            pass

    t = threading.Thread(target=run, daemon=True)
    t.start()
    return t


def drain(buf, lock):
    with lock:
        if not buf:
            return np.zeros(0, dtype=np.float32)
        chunk = np.concatenate(buf) if len(buf) > 1 else buf[0]
        buf.clear()
    return chunk


def update_meta(meeting_dir, **fields):
    meta_path = os.path.join(meeting_dir, "meta.json")
    meta = {}
    try:
        with open(meta_path, "r", encoding="utf-8") as f:
            meta = json.load(f)
    except Exception:
        pass
    meta.update(fields)
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)


class StreamingPartial:
    """MTG-P4-03：真·即時逐字浮現。VadSegmenter 判定「講話中」的當下語句尚未斷句完（endpoint
    靜音未到），本類別在講話過程中每隔 interval 秒對「目前累積的這句音訊」跑一次快模型轉錄，
    寫出暫定文字給前端輪詢顯示——比等一整句講完（VAD endpoint）再轉快得多。

    採簡化版 LocalAgreement：把這次與上次暫定結果逐字比對，共同前綴視為「本輪一致前綴」；
    只有當它確實延伸了既有的 `stable`（即前綴相符）才推進 `stable`，**絕不倒退**——實測發現
    Whisper 重新解碼整段窗口時，偶爾會連早先已經「看似定案」的字都改判（例如新聽到的下文
    讓它回頭修正語意），若每輪都直接拿「這次 vs 上次」的共同前綴覆蓋，畫面會偶爾閃退已顯示
    的字，體感比不即時更糟。落定的最終文字仍是 on_utterance 用主模型（beam_size 較大）跑出
    的結果，本類別只負責「邊講邊冒字」的過渡體感；一旦該句 emit，stable/tentative 立刻清空。
    """

    def __init__(self, model_size, interval=0.6, min_audio=0.3):
        self.model_size = model_size
        self.interval = interval
        self.min_audio = min_audio
        self.last_emit = 0.0
        self.last_text = ""
        self.stable = ""

    def maybe_update(self, seg, meeting_dir, lang, prompt):
        if not seg.voiced or not seg.utter or seg.utter_n / seg.rate < self.min_audio:
            return
        now = time.time()
        if now - self.last_emit < self.interval:
            return
        self.last_emit = now
        audio = np.concatenate(seg.utter)
        i16 = (np.clip(audio, -1.0, 1.0) * 32767.0).astype(np.int16)
        tmp = os.path.join(meeting_dir, "_partial.wav")
        cw = wave.open(tmp, "wb")
        cw.setnchannels(1); cw.setsampwidth(2); cw.setframerate(TARGET_RATE)
        cw.writeframes(i16.tobytes()); cw.close()
        text = None
        try:
            res = stt.transcribe_file(tmp, lang=lang, model_size=self.model_size,
                                      initial_prompt=prompt, beam_size=1)
            text = (res.get("text") or "").strip()
        except Exception as e:
            log("即時逐字暫停一次（不影響最終轉錄）：%s" % e)
        finally:
            try: os.remove(tmp)
            except Exception: pass
        if text is None:
            return
        n = min(len(self.last_text), len(text))
        i = 0
        while i < n and self.last_text[i] == text[i]:
            i += 1
        agree_prefix = text[:i]
        self.last_text = text
        if agree_prefix.startswith(self.stable):   # 只增不減：確實延伸才推進，否則保留舊 stable
            self.stable = agree_prefix
        # tentative 只在這次假設仍以 stable 開頭時取用（=接得上）；否則本輪暫定文字不可靠，
        # 寧可暫不顯示尾巴也不要顯示接不上、看起來錯亂的字（stable 本身不受影響）。
        tentative = text[len(self.stable):] if text.startswith(self.stable) else ""
        write_partial(meeting_dir, self.stable, tentative)

    def clear(self, meeting_dir):
        self.last_text = ""
        self.stable = ""
        write_partial(meeting_dir, "", "")


def write_partial(meeting_dir, stable, tentative):
    path = os.path.join(meeting_dir, "partial.json")
    tmp = path + ".tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"stable": stable, "tentative": tentative}, f, ensure_ascii=False)
        os.replace(tmp, path)   # 原子寫入，前端輪詢不會讀到半截 JSON
    except Exception:
        pass


class VadSegmenter:
    """連續音訊（16k mono float32）→ 切 30ms frame → VAD 判語音/靜音 → 斷句。

    講完一句（停頓 endpoint_sil 秒）或連續講滿 max_utter 秒 → 觸發 on_utterance(audio, start_sample)。
    每個 frame 都呼叫 on_frame(frame)（供寫 wav，含停頓段，給 diarization 完整時間軸）。
    webrtcvad 不可用時退回能量門檻 VAD（仍有斷句行為，不退回呆板定時）。即時體感的核心。"""

    def __init__(self, rate, on_frame, on_utterance, vad=None,
                 endpoint_sil=0.7, max_utter=8.0, min_utter=0.4, energy_th=0.012):
        self.rate = rate
        self.frame = int(rate * 30 / 1000)   # 30ms（webrtcvad 只吃 10/20/30ms）
        self.on_frame = on_frame
        self.on_utterance = on_utterance
        self.vad = vad
        self.endpoint_sil = endpoint_sil
        self.max_utter = max_utter
        self.min_utter = min_utter
        self.energy_th = energy_th
        self.acc = np.zeros(0, dtype=np.float32)
        self.utter = []
        self.utter_n = 0
        self.utter_start = 0
        self.voiced = False
        self.sil = 0.0
        self.total = 0                       # 已處理 sample 數（時間軸）

    def _is_speech(self, f):
        if self.vad is not None:
            i16 = (np.clip(f, -1.0, 1.0) * 32767.0).astype("<i2")
            try:
                return self.vad.is_speech(i16.tobytes(), self.rate)
            except Exception:
                return True
        rms = float(np.sqrt(np.mean(f ** 2))) if f.shape[0] else 0.0
        return rms > self.energy_th

    def _emit(self):
        frames, n, start = self.utter, self.utter_n, self.utter_start
        self.utter, self.utter_n = [], 0
        self.voiced, self.sil = False, 0.0
        if n and n / self.rate >= self.min_utter:
            self.on_utterance(np.concatenate(frames), start)

    def _frame(self, f):
        self.total += f.shape[0]
        self.on_frame(f)
        if self._is_speech(f):
            if not self.voiced:
                self.voiced = True
                self.utter_start = self.total - f.shape[0]
            self.utter.append(f); self.utter_n += f.shape[0]
            self.sil = 0.0
        elif self.voiced:
            self.utter.append(f); self.utter_n += f.shape[0]   # 句尾靜音也留著
            self.sil += f.shape[0] / self.rate
            if self.sil >= self.endpoint_sil:
                self._emit(); return
        if self.voiced and self.utter_n / self.rate >= self.max_utter:
            self._emit()

    def feed(self, mix):
        if mix is None or mix.shape[0] == 0:
            return
        self.acc = np.concatenate([self.acc, mix]) if self.acc.shape[0] else mix
        while self.acc.shape[0] >= self.frame:
            self._frame(self.acc[:self.frame])
            self.acc = self.acc[self.frame:]

    def finish(self):
        """收尾：剩餘不足一 frame 的也寫 wav，當前語句送轉。"""
        if self.acc.shape[0] > 0:
            self.total += self.acc.shape[0]
            self.on_frame(self.acc)
            if self.voiced:
                self.utter.append(self.acc); self.utter_n += self.acc.shape[0]
            self.acc = np.zeros(0, dtype=np.float32)
        self._emit()


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True, help="meetingDir")
    ap.add_argument("--source", default="both", choices=["mic", "loopback", "both"])
    ap.add_argument("--model", default="medium")
    ap.add_argument("--lang", default="zh")
    ap.add_argument("--chunk-seconds", type=float, default=10.0)
    ap.add_argument("--prompt", default=None, help="領域詞彙提升準度")
    ap.add_argument("--partial-model", default="base", help="即時逐字用的快模型（MTG-P4-03）；空字串=關閉")
    ap.add_argument("--partial-interval", type=float, default=0.6, help="即時逐字推論間隔（秒）")
    args = ap.parse_args(argv)

    meeting_dir = args.dir
    os.makedirs(meeting_dir, exist_ok=True)
    transcript_path = os.path.join(meeting_dir, "transcript.txt")
    audio_path = os.path.join(meeting_dir, "audio.wav")
    stop_path = os.path.join(meeting_dir, "STOP")

    started = time.strftime("%Y-%m-%dT%H:%M:%S")
    update_meta(meeting_dir, source=args.source, model=args.model, lang=args.lang,
                startedAt_proc=started, status="recording")

    p = pyaudio.PyAudio()
    devices = resolve_devices(p, args.source)
    if not devices:
        update_meta(meeting_dir, status="error", error="no audio source")
        log("無可用音源，中止")
        p.terminate()
        return 2
    log("音源：" + "、".join("%s(idx=%d,%dHz,%dch)" % (d[3], d[0], d[1], d[2]) for d in devices))

    # 每個來源一條 buffer + reader thread
    stop_evt = threading.Event()
    sources = []
    for (index, rate, channels, label) in devices:
        buf, lock = [], threading.Lock()
        try:
            t = make_reader(p, index, rate, channels, buf, lock, stop_evt)
            sources.append({"buf": buf, "lock": lock, "thread": t, "label": label})
        except Exception as e:
            log("開啟 %s 失敗：%s" % (label, e))

    if not sources:
        update_meta(meeting_dir, status="error", error="open stream failed")
        p.terminate()
        return 2

    wav = wave.open(audio_path, "wb")
    wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(TARGET_RATE)

    # 預載模型（避免第一個 chunk 卡 model 載入）
    try:
        stt._get_model(args.model)
    except Exception as e:
        log("模型預載失敗（將於首段重試）：%s" % e)

    # MTG-P4-03：即時逐字浮現用的快模型也一併預載（同一 WhisperModel singleton cache）。
    streaming = None
    if args.partial_model:
        try:
            stt._get_model(args.partial_model)
            streaming = StreamingPartial(args.partial_model, interval=args.partial_interval)
            log("即時逐字：model=%s interval=%.1fs device=%s" %
                (args.partial_model, args.partial_interval, stt._detect_device()))
        except Exception as e:
            log("即時逐字模型預載失敗（本次會議停用即時逐字，最終轉錄不受影響）：%s" % e)
            streaming = None

    # ── VAD 斷句（即時體感）：講完一句即送轉，不再呆板定時 chunk ──
    try:
        import webrtcvad
        _vad = webrtcvad.Vad(2)   # 0~3 越大越敏感；2 平衡
    except Exception as e:
        _vad = None
        log("webrtcvad 不可用（%s）→ 退回能量門檻 VAD。" % e)

    tf = open(transcript_path, "a", encoding="utf-8")

    def on_frame(frame_f32):
        # 全程音訊都寫 wav（含停頓段，供 diarization 完整時間軸）
        i16 = (np.clip(frame_f32, -1.0, 1.0) * 32767.0).astype(np.int16)
        wav.writeframes(i16.tobytes())

    def on_utterance(audio, start_sample):
        # 一句講完（VAD endpoint）→ 即時逐字的暫定文字失效，清空讓下一句從零開始浮現。
        if streaming is not None:
            streaming.clear(meeting_dir)
        # 寫暫存 wav → stt（同行程，共用 singleton）→ 防當機 append
        i16 = (np.clip(audio, -1.0, 1.0) * 32767.0).astype(np.int16)
        tmp = os.path.join(meeting_dir, "_utter.wav")
        cw = wave.open(tmp, "wb"); cw.setnchannels(1); cw.setsampwidth(2); cw.setframerate(TARGET_RATE)
        cw.writeframes(i16.tobytes()); cw.close()
        try:
            res = stt.transcribe_file(tmp, lang=args.lang, model_size=args.model, initial_prompt=args.prompt)
            text = (res.get("text") or "").strip()
        except Exception as e:
            log("轉錄失敗（保留音訊，跳過此段文字）：%s" % e)
            text = ""
        finally:
            try: os.remove(tmp)
            except Exception: pass
        if text:
            tf.write("[%s] %s\n" % (fmt_ts(start_sample / TARGET_RATE), text))
            tf.flush()
            os.fsync(tf.fileno())   # 命脈：落碟，當機也不丟

    seg = VadSegmenter(TARGET_RATE, on_frame, on_utterance, vad=_vad)

    def drain_mix():
        """收各來源新音框 → max-pad 混成單路（silent 來源不拖累；both 模式修正）。"""
        new = [drain(s["buf"], s["lock"]) for s in sources]
        ln = max((x.shape[0] for x in new), default=0)
        if ln == 0:
            return None
        mix = np.zeros(ln, dtype=np.float32)
        for x in new:
            if x.shape[0]:
                mix[:x.shape[0]] += x
        return mix

    log("開始錄製。停止＝在 meetingDir 寫 STOP 檔。VAD=%s。" % ("webrtcvad" if _vad else "energy"))
    try:
        while True:
            stopping = os.path.exists(stop_path)
            seg.feed(drain_mix())
            if streaming is not None and not stopping:
                streaming.maybe_update(seg, meeting_dir, args.lang, args.prompt)
            if stopping:
                if streaming is not None:
                    streaming.clear(meeting_dir)
                seg.finish()   # 收尾：剩餘音訊 + 當前語句送轉
                break
            time.sleep(0.05)   # VAD 要即時 → 縮短輪詢（原 0.3 太鈍）
    finally:
        # 先讓 reader thread 收到停止、各自關閉自己的 stream 並 join。
        stop_evt.set()
        for s in sources:
            try: s["thread"].join(timeout=2.0)
            except Exception: pass
        # 把命脈資料全部落碟（這幾步必須在退出前完成）。
        try: tf.close()
        except Exception: pass
        try: wav.close()
        except Exception: pass
        try: os.remove(stop_path)
        except Exception: pass
        update_meta(meeting_dir, finishedAt=time.strftime("%Y-%m-%dT%H:%M:%S"), status="done")
        log("錄製結束，逐字稿：%s" % transcript_path)
        # PyAudioWPatch 的 PortAudio teardown 在 Windows WASAPI loopback 下會 segfault（exit 139），
        # 即使資料已安全寫完——server 端會誤判失敗。資料既已落碟，直接 os._exit(0) 跳過 atexit /
        # PortAudio 析構，保證乾淨退出碼。
        sys.stdout.flush(); sys.stderr.flush()
        os._exit(0)


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except KeyboardInterrupt:
        sys.exit(0)
