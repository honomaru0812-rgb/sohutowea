/* ============================================================
   features-b.js — 機能担当B 用
   ============================================================
   【担当する機能】
   ・リマインド（通知）機能
   ・AI機能（予定の提案、自然言語入力など）
   ・音声入力
   ・画像認識（画像から予定を読み取る）
   ・他アプリとの連携（.ics エクスポート）

   【AI呼び出しについて】
   Claude APIキーはブラウザに置かず、Supabase Edge Function
   "ai-assist" を経由して呼び出します（セットアップ手順は
   SETUP-AI.md を参照）。
   window.App.supabase.functions.invoke("ai-assist", {...}) を使うので、
   このファイル自体にAPIキーは一切書きません。

   【ルール】
   ・window.App を通じてデータにアクセスする
   ・HTMLの id="xxx" を使って要素を取得する
   ・新しいHTMLが必要な場合は、JavaScriptで動的に追加する
   ・styles.css のクラス名を使う（新しいクラスが必要ならデザイン担当に依頼）
   ============================================================ */

(function() {

  function pad2(n) { return String(n).padStart(2, "0"); }

  // ============================================================
  // 【テスト用】Edge Functionデプロイ前にUIだけ先に確認したいときはtrueにする
  // 本番/デプロイ後は必ず false に戻すこと！
  // ============================================================
  var USE_MOCK_AI = false;

  // モック応答（本物のAIより単純だが、テストしやすいよう簡易的な日本語解析をする）
  function mockParseDate(text) {
    var now = new Date();
    var base = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    if (!text) return base;

    if (text.indexOf("明後日") !== -1) {
      base.setDate(base.getDate() + 2);
      return base;
    }
    if (text.indexOf("明日") !== -1) {
      base.setDate(base.getDate() + 1);
      return base;
    }
    if (text.indexOf("来週") !== -1) {
      base.setDate(base.getDate() + 7);
      return base;
    }

    // 「8月24日」「8/24」形式
    var m = text.match(/(\d{1,2})\s*[月\/]\s*(\d{1,2})\s*日?/);
    if (m) {
      var month = Number(m[1]) - 1;
      var day = Number(m[2]);
      var candidate = new Date(now.getFullYear(), month, day);
      // 今年の日付が既に過ぎていたら来年とみなす（例：1月に「12月」と言われた場合など）
      if (candidate < base && (base - candidate) > 1000 * 60 * 60 * 24 * 30) {
        candidate.setFullYear(now.getFullYear() + 1);
      }
      return candidate;
    }

    return base; // 今日
  }

  function mockParseTime(text, fallbackH) {
    if (!text) return { h: fallbackH, m: 0 };
    var m = text.match(/(\d{1,2})\s*時(?:\s*(\d{1,2})\s*分)?/);
    if (!m) return { h: fallbackH, m: 0 };
    var h = Number(m[1]);
    if (text.indexOf("午後") !== -1 || text.indexOf("夜") !== -1) {
      if (h < 12) h += 12;
    }
    return { h: h, m: m[2] ? Number(m[2]) : 0 };
  }

  function mockAI(action, extra) {
    console.log("[MOCK] callAI呼び出し:", action, extra);
    return new Promise(function(resolve) {
      setTimeout(function() {
        if (action === "parse_text") {
          var text = extra.text || "";
          var dateObj = mockParseDate(text);
          var dateStr = dateObj.getFullYear() + "-" + pad2(dateObj.getMonth() + 1) + "-" + pad2(dateObj.getDate());

          var time = mockParseTime(text, 15);
          var title = text
            .replace(/明後日|明日|今日|来週/g, "")
            .replace(/\d{1,2}\s*[月\/]\s*\d{1,2}\s*日?/g, "")
            .replace(/\d{1,2}\s*時(\s*\d{1,2}\s*分)?/g, "")
            .replace(/午後|午前|夜/g, "")
            .replace(/[のにを、。\s]/g, "")
            .trim();

          resolve({
            title: title || "（モック）予定",
            date: dateStr,
            startH: time.h, startM: time.m,
            endH: (time.h + 1) % 24, endM: time.m,
            tag: "仕事",
          });
        } else if (action === "parse_image") {
          resolve({
            title: "（モック）画像から読み取った予定",
            date: extra.referenceDate || null,
            startH: 10, startM: 30,
            endH: 11, endM: 30,
            tag: "プライベート",
          });
        } else {
          resolve({ title: "", date: null, startH: null, startM: null, endH: null, endM: null, tag: "" });
        }
      }, 600); // 本物っぽく少し待たせる
    });
  }

  // ============================================================
  // AI呼び出し共通ヘルパー（Edge Function経由）
  // ============================================================
  // action: "parse_text" | "parse_image"
  async function callAI(action, extra) {
    if (USE_MOCK_AI) {
      return mockAI(action, extra || {});
    }

    var body = Object.assign({ action: action, now: new Date().toISOString() }, extra);
    var result = await window.App.supabase.functions.invoke("ai-assist", { body: body });
    if (result.error) {
      console.error("AI呼び出しエラー:", result.error);
      throw new Error("AI機能の呼び出しに失敗しました。Edge Function 'ai-assist' がデプロイされているか確認してください（SETUP-AI.md参照）。");
    }
    return result.data;
  }

  // 現在開いているモーダルの日付（YYYY-MM-DD）を取得
  function getCurrentModalDateKey() {
    var el = document.getElementById("modal-date");
    return el ? el.textContent.trim() : "";
  }

  // AIの解析結果をモーダルのフォームに反映する（保存は本人が行う）
  function applyParsedEventToModal(parsed) {
    if (!parsed) return;

    if (parsed.title) {
      var titleInput = document.getElementById("event-title");
      if (titleInput) titleInput.value = parsed.title;
    }

    if (typeof parsed.startH === "number") {
      var startH = document.getElementById("start-h");
      var startM = document.getElementById("start-m");
      if (startH) startH.value = parsed.startH;
      if (startM && typeof parsed.startM === "number") startM.value = roundToStep(parsed.startM);
    }
    if (typeof parsed.endH === "number") {
      var endH = document.getElementById("end-h");
      var endM = document.getElementById("end-m");
      if (endH) endH.value = parsed.endH;
      if (endM && typeof parsed.endM === "number") endM.value = roundToStep(parsed.endM);
    }

    if (parsed.tag) {
      var tagSel = document.getElementById("event-tag");
      if (tagSel) {
        var hasOption = Array.prototype.some.call(tagSel.options, function(o) { return o.value === parsed.tag; });
        if (hasOption) tagSel.value = parsed.tag;
      }
    }
  }

  // start-m / end-m は 0,15,30,45 の選択肢しかないので一番近い値に丸める
  function roundToStep(m) {
    var steps = [0, 15, 30, 45];
    var closest = steps[0];
    var minDiff = 60;
    steps.forEach(function(s) {
      var diff = Math.abs(s - m);
      if (diff < minDiff) { minDiff = diff; closest = s; }
    });
    return closest;
  }

  function showInlineNote(afterEl, text, isWarning) {
    var existing = document.getElementById("ai-inline-note");
    if (existing) existing.remove();
    var note = document.createElement("p");
    note.id = "ai-inline-note";
    note.style.fontSize = "12px";
    note.style.marginTop = "4px";
    note.style.color = isWarning ? "#c0392b" : "#888";
    note.textContent = text;
    afterEl.insertAdjacentElement("afterend", note);
  }

  // ============================================================
  // リマインド（通知）機能
  // ============================================================
  var notifiedKeys = {}; // "dateKey:id" -> true （同じ予定に重複通知しない）

  function requestNotificationPermission() {
    if (!("Notification" in window)) return;
    if (Notification.permission === "default") {
      Notification.requestPermission().then(updateNotificationButton);
    }
  }

  function sendNotification(title, body) {
    if ("Notification" in window && Notification.permission === "granted") {
      try {
        new Notification(title, { body: body });
      } catch (e) {
        console.warn("通知の表示に失敗しました:", e);
      }
    } else {
      // 通知が許可されていない場合はアプリ内トースト表示にフォールバック
      showInAppToast(title, body);
    }
  }

  function showInAppToast(title, body) {
    var toast = document.createElement("div");
    toast.style.position = "fixed";
    toast.style.bottom = "20px";
    toast.style.right = "20px";
    toast.style.background = "#333";
    toast.style.color = "#fff";
    toast.style.padding = "12px 16px";
    toast.style.borderRadius = "10px";
    toast.style.boxShadow = "0 4px 20px rgba(0,0,0,0.2)";
    toast.style.zIndex = "9999";
    toast.style.maxWidth = "260px";
    toast.style.fontSize = "13px";
    toast.innerHTML = "<strong>" + title + "</strong><br>" + body;
    document.body.appendChild(toast);
    setTimeout(function() { toast.remove(); }, 8000);
  }

  // 通知許可を促す小さなボタンをヘッダーに出す（許可済み/非対応なら出さない）
  function updateNotificationButton() {
    var existing = document.getElementById("notif-permission-btn");
    if (existing) existing.remove();

    if (!("Notification" in window)) return;
    if (Notification.permission !== "default") return;

    var headerRight = document.querySelector(".header-right");
    if (!headerRight) return;

    var btn = document.createElement("button");
    btn.id = "notif-permission-btn";
    btn.className = "btn-logout"; // 既存クラスを流用（デザイン担当に専用クラスを依頼してもOK）
    btn.textContent = "🔔 通知を許可";
    btn.onclick = requestNotificationPermission;
    headerRight.insertBefore(btn, headerRight.firstChild);
  }

  // リマインダーをチェック（20秒ごと）
  function checkReminders() {
    var now = new Date();
    var todayKey = window.App.formatDate(now.getFullYear(), now.getMonth(), now.getDate());
    var todayEvents = window.App.events[todayKey] || [];

    todayEvents.forEach(function(evt) {
      if (!evt.reminder || evt.reminder === "none") return;

      var key = todayKey + ":" + evt.id;
      if (notifiedKeys[key]) return;

      var reminderMin = parseInt(evt.reminder, 10);
      if (isNaN(reminderMin)) return;

      var eventTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), evt.startH, evt.startM);
      var diffMin = (eventTime - now) / 1000 / 60;

      // リマインダー時刻を過ぎていても、まだ予定開始前ならまとめて通知する
      if (diffMin <= reminderMin && diffMin > -1) {
        var whenText = diffMin > 0 ? Math.ceil(diffMin) + "分後に" : "まもなく";
        sendNotification("📅 " + evt.title, whenText + "「" + evt.title + "」が始まります");
        notifiedKeys[key] = true;
      }
    });
  }

  setInterval(checkReminders, 20000);

  // ============================================================
  // 音声入力
  // ============================================================
  (function setupVoiceInput() {
    var micBtn = document.getElementById("mic-btn");
    var eventTitleInput = document.getElementById("event-title");
    if (!micBtn || !eventTitleInput) return;

    var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      micBtn.style.display = "none";
      console.log("このブラウザは音声入力に対応していません");
      return;
    }

    var recognition = null;
    var isRecording = false;

    function createRecognition() {
      var r = new SpeechRecognition();
      r.lang = "ja-JP";
      r.continuous = false;
      r.interimResults = false;

      r.onresult = function(e) {
        var text = e.results[0][0].transcript;
        eventTitleInput.value = text;
      };
      r.onend = function() {
        isRecording = false;
        micBtn.classList.remove("recording");
        micBtn.textContent = "🎤";
      };
      r.onerror = function(e) {
        console.error("音声認識エラー:", e.error);
        isRecording = false;
        micBtn.classList.remove("recording");
        micBtn.textContent = "🎤";
        if (e.error === "not-allowed" || e.error === "service-not-allowed") {
          showInlineNote(micBtn, "マイクの使用が許可されていません。ブラウザの設定を確認してください。", true);
        }
      };
      return r;
    }

    micBtn.onclick = function() {
      if (isRecording) {
        if (recognition) recognition.stop();
        return;
      }
      recognition = createRecognition(); // 毎回作り直す（連続使用時の不具合を避ける）
      try {
        recognition.start();
        isRecording = true;
        micBtn.classList.add("recording");
        micBtn.textContent = "⏹️";
      } catch (e) {
        console.error("音声認識の開始に失敗:", e);
      }
    };
  })();

  // ============================================================
  // AIでテキスト解析（モーダル内：タイトル欄の自然文から時間などを抽出）
  // 例：「15時から16時に打ち合わせ」→ 開始15:00 終了16:00 タイトル「打ち合わせ」
  // ============================================================
  (function setupAiTextParse() {
    var eventTitleInput = document.getElementById("event-title");
    var micBtn = document.getElementById("mic-btn");
    if (!eventTitleInput || !micBtn) return;

    var aiBtn = document.createElement("button");
    aiBtn.type = "button";
    aiBtn.id = "ai-parse-btn";
    aiBtn.className = "btn-mic"; // 既存クラスを流用
    aiBtn.title = "AIで日時・タイトルを解析";
    aiBtn.textContent = "🤖";
    micBtn.insertAdjacentElement("afterend", aiBtn);

    aiBtn.onclick = async function() {
      var text = eventTitleInput.value.trim();
      if (!text) return;

      aiBtn.disabled = true;
      var originalText = aiBtn.textContent;
      aiBtn.textContent = "⏳";

      try {
        var referenceDate = getCurrentModalDateKey();
        var parsed = await callAI("parse_text", { text: text, referenceDate: referenceDate });
        applyParsedEventToModal(parsed);

        if (parsed.date && referenceDate && parsed.date !== referenceDate) {
          showInlineNote(
            document.getElementById("event-title").closest(".form-group"),
            "AIは日付「" + parsed.date + "」を検出しましたが、このモーダルの日付は " + referenceDate + " のままです。日付を変えたい場合は一度キャンセルして該当日をクリックしてください。",
            false
          );
        }
      } catch (e) {
        showInlineNote(eventTitleInput.closest(".form-group"), e.message, true);
      } finally {
        aiBtn.disabled = false;
        aiBtn.textContent = originalText;
      }
    };
  })();

  // ============================================================
  // 画像認識（画像から予定を読み取る）
  // ============================================================
  (function setupImageRecognition() {
    var eventImage = document.getElementById("event-image");
    var imageResult = document.getElementById("image-result");
    if (!eventImage || !imageResult) return;

    eventImage.onchange = function() {
      var file = this.files[0];
      if (!file) return;

      imageResult.textContent = "画像を分析中...";

      var reader = new FileReader();
      reader.onload = async function() {
        var base64 = reader.result.split(",")[1];
        try {
          var referenceDate = getCurrentModalDateKey();
          var parsed = await callAI("parse_image", {
            image: base64,
            mediaType: file.type,
            referenceDate: referenceDate,
          });

          applyParsedEventToModal(parsed);

          var summary = "AI分析結果: " + (parsed.title || "（タイトル不明）");
          if (parsed.date) summary += " / " + parsed.date;
          if (typeof parsed.startH === "number") {
            summary += " " + pad2(parsed.startH) + ":" + pad2(parsed.startM || 0);
          }
          imageResult.textContent = summary;

          if (parsed.date && referenceDate && parsed.date !== referenceDate) {
            showInlineNote(
              imageResult,
              "検出された日付（" + parsed.date + "）は現在のモーダルの日付（" + referenceDate + "）と異なります。日付を変えたい場合は一度キャンセルして該当日をクリックしてください。",
              false
            );
          }
        } catch (e) {
          imageResult.textContent = "分析に失敗しました: " + e.message;
        }
      };
      reader.readAsDataURL(file);
    };
  })();

  // ============================================================
  // AIで予定をサッと追加（自然言語入力・カレンダーを開かず追加）
  // 例：「明日の15時にミーティング」と入力するだけで
  //     該当月に移動 → 該当日のモーダルを開いて自動入力
  // ============================================================
  function openQuickAddOverlay() {
    var overlay = document.createElement("div");
    overlay.className = "modal-overlay active";
    overlay.id = "ai-quickadd-overlay";
    overlay.style.zIndex = "200";

    overlay.innerHTML =
      '<div class="modal">' +
      '  <h2>🤖 AIで予定を追加</h2>' +
      '  <p class="modal-date">「明日の15時にミーティング」のように入力してください</p>' +
      '  <div class="form-group">' +
      '    <textarea id="ai-quickadd-text" rows="3" style="width:100%;padding:10px;font-size:14px;border:1px solid #ddd;border-radius:8px;"></textarea>' +
      '  </div>' +
      '  <div class="modal-buttons">' +
      '    <button class="btn-save" id="ai-quickadd-submit">解析する</button>' +
      '    <button class="btn-cancel" id="ai-quickadd-cancel">キャンセル</button>' +
      '  </div>' +
      '</div>';

    document.body.appendChild(overlay);
    var textarea = document.getElementById("ai-quickadd-text");
    textarea.focus();

    document.getElementById("ai-quickadd-cancel").onclick = function() {
      overlay.remove();
    };
    overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };

    document.getElementById("ai-quickadd-submit").onclick = async function() {
      var text = textarea.value.trim();
      if (!text) return;

      var submitBtn = this;
      submitBtn.disabled = true;
      submitBtn.textContent = "解析中...";

      try {
        var parsed = await callAI("parse_text", { text: text });
        if (!parsed.date) throw new Error("日付を認識できませんでした。もう少し具体的に入力してください。");

        var parts = parsed.date.split("-").map(Number);
        window.App.currentYear = parts[0];
        window.App.currentMonth = parts[1] - 1;
        window.App.renderCalendar();

        var cell = document.querySelector('.day-cell[data-date="' + parsed.date + '"]');
        overlay.remove();

        if (cell) {
          cell.click(); // main.js の openModal(dateKey, null) がここで呼ばれる
          // モーダルが開いた直後にAIの解析結果で上書き入力
          applyParsedEventToModal(parsed);
        } else {
          showInAppToast("予定を確認してください", parsed.date + " のカレンダーを表示しました。日付をクリックして内容を確認・保存してください。");
        }
      } catch (e) {
        alert("解析に失敗しました: " + e.message);
        submitBtn.disabled = false;
        submitBtn.textContent = "解析する";
      }
    };
  }

  function addQuickAddButton() {
    if (document.getElementById("ai-quickadd-btn")) return;
    var headerRight = document.querySelector(".header-right");
    if (!headerRight) return;

    var btn = document.createElement("button");
    btn.id = "ai-quickadd-btn";
    btn.className = "btn-today"; // 既存クラスを流用
    btn.textContent = "🤖 AIで追加";
    btn.onclick = openQuickAddOverlay;
    headerRight.insertBefore(btn, headerRight.firstChild);
  }

  // ============================================================
  // 他アプリとの連携（.ics エクスポート）
  // ============================================================
  function escapeICSText(text) {
    return String(text || "").replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\n/g, "\\n");
  }

  function eventToICSBlock(dateKey, event) {
    var parts = dateKey.split("-");
    var datePrefix = parts[0] + pad2(Number(parts[1])) + pad2(Number(parts[2]));
    var start = datePrefix + "T" + pad2(event.startH) + pad2(event.startM) + "00";
    var end = datePrefix + "T" + pad2(event.endH) + pad2(event.endM) + "00";
    var uid = (event.id || (dateKey + Math.random())) + "@schedule-app";

    return [
      "BEGIN:VEVENT",
      "UID:" + uid,
      "DTSTART:" + start,
      "DTEND:" + end,
      "SUMMARY:" + escapeICSText((event.icon ? event.icon + " " : "") + event.title),
      event.tag ? "CATEGORIES:" + escapeICSText(event.tag) : null,
      "END:VEVENT",
    ].filter(Boolean).join("\r\n");
  }

  function downloadICS(filename, vevents) {
    var ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//schedule-app//JA",
      vevents,
      "END:VCALENDAR",
    ].join("\r\n");

    var blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function exportSingleEvent(dateKey, event) {
    downloadICS((event.title || "event") + ".ics", eventToICSBlock(dateKey, event));
  }

  function exportAllEvents() {
    var blocks = [];
    Object.keys(window.App.events).forEach(function(dateKey) {
      window.App.events[dateKey].forEach(function(evt) {
        blocks.push(eventToICSBlock(dateKey, evt));
      });
    });
    if (blocks.length === 0) {
      alert("エクスポートできる予定がありません。");
      return;
    }
    downloadICS("all-events.ics", blocks.join("\r\n"));
  }

  // モーダル内に「この予定をエクスポート」ボタンを差し込む（既存の予定を編集中のみ）
  window.App.onModalOpen.push(function(dateKey, event) {
    var existing = document.getElementById("export-ics-btn");
    if (existing) existing.remove();
    if (!event) return; // 新規作成中はエクスポート対象がない

    var modalButtons = document.querySelector(".modal-buttons");
    if (!modalButtons) return;

    var btn = document.createElement("button");
    btn.type = "button";
    btn.id = "export-ics-btn";
    btn.className = "btn-cancel"; // 既存クラスを流用
    btn.textContent = "📤 エクスポート";
    btn.onclick = function() { exportSingleEvent(dateKey, event); };
    modalButtons.appendChild(btn);
  });

  function addExportAllButton() {
    if (document.getElementById("export-all-btn")) return;
    var headerRight = document.querySelector(".header-right");
    if (!headerRight) return;

    var btn = document.createElement("button");
    btn.id = "export-all-btn";
    btn.className = "btn-logout"; // 既存クラスを流用
    btn.textContent = "📤 全予定を書き出す";
    btn.onclick = exportAllEvents;
    headerRight.insertBefore(btn, document.getElementById("logout-btn"));
  }

  // ============================================================
  // 他アプリとの連携（.ics インポート）
  // Googleカレンダー等で「エクスポート」した.icsファイルを取り込む
  // ============================================================

  // "YYYYMMDD" or "YYYYMMDDTHHMMSS(Z)?" を dateKey/時刻に変換
  function parseICSDateValue(value) {
    if (!value) return null;
    value = value.trim();

    var m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
    if (!m) return null;

    var year = Number(m[1]), month = Number(m[2]), day = Number(m[3]);

    if (!m[4]) {
      // 終日イベント（時刻情報なし）
      return { dateKey: year + "-" + pad2(month) + "-" + pad2(day), h: null, m: null, allDay: true };
    }

    var hour = Number(m[4]), min = Number(m[5]), sec = Number(m[6]);
    var isUTC = !!m[7];
    var d = isUTC ? new Date(Date.UTC(year, month - 1, day, hour, min, sec)) : new Date(year, month - 1, day, hour, min, sec);

    return {
      dateKey: d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()),
      h: d.getHours(),
      m: d.getMinutes(),
      allDay: false,
    };
  }

  // .icsファイルのテキストをイベント配列に変換
  function parseICS(text) {
    var normalized = text.replace(/\r\n[ \t]/g, ""); // 折り返し行を結合（簡易対応）
    var blocks = normalized.split("BEGIN:VEVENT").slice(1);

    return blocks.map(function(block) {
      block = block.split("END:VEVENT")[0];

      function getField(name) {
        // 例: "DTSTART;TZID=Asia/Tokyo:20260715T150000" のようにパラメータが付く場合にも対応
        var re = new RegExp("^" + name + "(;[^:\\r\\n]*)?:(.+)$", "m");
        var m = block.match(re);
        return m ? m[2].trim() : "";
      }

      var summary = getField("SUMMARY").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\n/g, " ").replace(/\\\\/g, "\\");
      var dtstart = parseICSDateValue(getField("DTSTART"));
      var dtend = parseICSDateValue(getField("DTEND"));
      var categories = getField("CATEGORIES");

      if (!summary || !dtstart) return null;

      return {
        title: summary,
        dateKey: dtstart.dateKey,
        startH: dtstart.allDay ? 9 : dtstart.h,
        startM: dtstart.allDay ? 0 : dtstart.m,
        endH: dtend && !dtend.allDay ? dtend.h : (dtstart.allDay ? 18 : (dtstart.h + 1) % 24),
        endM: dtend && !dtend.allDay ? dtend.m : (dtstart.allDay ? 0 : dtstart.m),
        tag: ["仕事", "プライベート", "勉強", "健康", "買い物"].indexOf(categories) !== -1 ? categories : "",
      };
    }).filter(Boolean);
  }

  // モーダルが閉じるのを待つ（保存処理の完了を大まかに待つため）
  function waitForModalClose(timeoutMs) {
    return new Promise(function(resolve) {
      var overlay = document.getElementById("modal-overlay");
      var waited = 0;
      var interval = setInterval(function() {
        waited += 100;
        if (!overlay.classList.contains("active") || waited >= timeoutMs) {
          clearInterval(interval);
          resolve();
        }
      }, 100);
    });
  }

  function sleep(ms) { return new Promise(function(resolve) { setTimeout(resolve, ms); }); }

  // 1件のイベントをカレンダー日付クリック→フォーム入力→保存、の流れで追加する
  async function addOneImportedEvent(evt) {
    var parts = evt.dateKey.split("-").map(Number);
    window.App.currentYear = parts[0];
    window.App.currentMonth = parts[1] - 1;
    window.App.renderCalendar();

    var cell = document.querySelector('.day-cell[data-date="' + evt.dateKey + '"]');
    if (!cell) return false;

    cell.click(); // main.js の openModal(dateKey, null)

    var titleInput = document.getElementById("event-title");
    var startH = document.getElementById("start-h");
    var startM = document.getElementById("start-m");
    var endH = document.getElementById("end-h");
    var endM = document.getElementById("end-m");
    var tagSel = document.getElementById("event-tag");

    if (titleInput) titleInput.value = evt.title;
    if (startH && typeof evt.startH === "number") startH.value = evt.startH;
    if (startM && typeof evt.startM === "number") startM.value = roundToStep(evt.startM);
    if (endH && typeof evt.endH === "number") endH.value = evt.endH;
    if (endM && typeof evt.endM === "number") endM.value = roundToStep(evt.endM);
    if (tagSel && evt.tag) tagSel.value = evt.tag;

    var saveBtn = document.getElementById("save-btn");
    if (saveBtn) saveBtn.click();

    await waitForModalClose(3000);
    await sleep(200); // DB保存の余裕を持たせる
    return true;
  }

  async function importICSEvents(events) {
    if (events.length === 0) {
      alert("インポートできる予定が見つかりませんでした。");
      return;
    }
    var ok = confirm(events.length + "件の予定をインポートします。よろしいですか？");
    if (!ok) return;

    var successCount = 0;
    for (var i = 0; i < events.length; i++) {
      try {
        var added = await addOneImportedEvent(events[i]);
        if (added) successCount++;
      } catch (e) {
        console.error("インポート中にエラー:", events[i], e);
      }
    }

    showInAppToast("インポート完了", events.length + "件中 " + successCount + "件を追加しました。");
  }

  function addImportButton() {
    if (document.getElementById("import-ics-btn")) return;
    var headerRight = document.querySelector(".header-right");
    if (!headerRight) return;

    // 隠しファイル入力
    var fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".ics";
    fileInput.style.display = "none";
    fileInput.id = "import-ics-input";
    fileInput.onchange = function() {
      var file = this.files[0];
      this.value = ""; // 同じファイルを連続で選んでも動くようにリセット
      if (!file) return;

      var reader = new FileReader();
      reader.onload = function() {
        var events = parseICS(reader.result);
        importICSEvents(events);
      };
      reader.readAsText(file);
    };
    document.body.appendChild(fileInput);

    var btn = document.createElement("button");
    btn.id = "import-ics-btn";
    btn.className = "btn-logout"; // 既存クラスを流用
    btn.textContent = "📥 予定を取り込む";
    btn.title = "Googleカレンダー等でエクスポートした.icsファイルを取り込む";
    btn.onclick = function() { fileInput.click(); };
    headerRight.insertBefore(btn, document.getElementById("logout-btn"));
  }

  // ============================================================
  // 初期化
  // ============================================================
  window.App.onReady.push(function() {
    updateNotificationButton();
    addQuickAddButton();
    addExportAllButton();
    addImportButton();
    checkReminders(); // 起動直後にも1回チェック
    console.log("機能B: 初期化完了（通知・音声入力・AI解析・画像認識・ICSエクスポート/インポート）");
  });

})();
