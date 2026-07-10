// tts-normalize.js — 單一共用的「發聲正規化器」。所有把文字唸出來的地方（Chat 朗讀、簡報 deck）
// 都先過這支，避免兩邊各修一份。只改「要唸出來的文字」，不影響畫面顯示或 log。
//
// 兩件事：
//   1. 符號規則：會被 TTS 唸成「斜線」等的分隔符（半/全形 / \ |）→ 空白。
//   2. 發音校正表 SAY：多音字/慣用唸法唸錯時的「同音字替換」（瀏覽器 speechSynthesis 與 edge-tts 兩種
//      引擎都通；不依賴 SSML/phoneme，那在免費 edge-tts 上不保證）。每發現一個唸錯就在 SAY 加一行。
//
// 維護：要新增校正，就在 SAY 加 [原字, 同音替換]。範例：'重新' 的「重」應唸 ㄔㄨㄥˊ，某些 TTS 唸成
// ㄓㄨㄥˋ → 用同音的「蟲新」騙它唸對（畫面/紀錄仍是「重新」，只有發聲被替換）。
(function () {
  var SAY = [
    ['重新', '蟲新'],   // 重(ㄔㄨㄥˊ)新
  ];

  function ttsNormalize(t) {
    if (!t) return '';
    t = String(t);
    t = t.replace(/[\/／\\＼|｜]+/g, ' ');          // 1) 符號 → 空白
    for (var i = 0; i < SAY.length; i++) {            // 2) 同音字替換（發聲用）
      if (SAY[i][0]) t = t.split(SAY[i][0]).join(SAY[i][1]);
    }
    return t.replace(/ {2,}/g, ' ').trim();           // 收斂多餘空白
  }

  if (typeof window !== 'undefined') window.ttsNormalize = ttsNormalize;
  if (typeof module !== 'undefined' && module.exports) module.exports = { ttsNormalize: ttsNormalize };
})();
