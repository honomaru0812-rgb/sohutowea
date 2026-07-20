/* ============================================================
   features-b.js — 機能担当B 用（改善版）
   ============================================================ */

(function() {

  function pad2(n) { return String(n).padStart(2, "0"); }

  // ============================================================
  // テスト用モックフラグ
  // ============================================================
  var USE_MOCK_AI = false;

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

    var m = text.match(/(\d{1,2})\s*[月\/]\s*(\d{1,2})\s*日?/);
    if (m) {
      var month = Number(m[1]) - 1;
      var day = Number(m[2]);
      var candidate = new Date(now.getFullYear(), month, day);
      if (candidate < base && (base - candidate) > 1000 * 60 * 60 * 24 * 30) {
        candidate.setFullYear(now.getFullYear() + 1);
      }
      return candidate;
    }

    return base;
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
      }, 600);
    });
  }

  // ============================================================
  // AI呼び出し共通ヘルパー（Edge Function経由）
  // ============================================================
  async function callAI(action, extra) {
    if (USE_MOCK_AI) {
      return mockAI(action, extra || {});
    }

    var now = new Date();
    var localNow = now.getFullYear() + "-" + pad2(now.getMonth() + 1) + "-" + pad2(now.getDate()) + 
                   " " + pad2(now.getHours()) + ":" + pad2(now.getMinutes());

    var body = Object.assign({ action: action, now: localNow }, extra);
    var result = await window.App.supabase.functions.invoke("ai-assist", { body: body });
    
    if (result.error) {
      console.error("AI呼び出しエラー:", result.error);
      throw new Error("AI機能の呼び出しに失敗しました。Edge Function 'ai-assist' がデプロイされているか確認してください。");
    }

    var data = result.data;
    console.log("[callAI] action=" + action + " 生レスポンス:", data);

    if (data && data.error) {
      throw new Error(String(data.error));
    }

    if (action === "parse_text" && data && Array.isArray(data.events)) {
      return data.events[0] || { title: "", date: null, startH: null, startM: null, endH: null, endM: null, tag: "" };
    }

    return data;
  }

  async function callAIWithRetry(action, extra, retries) {
    retries = typeof retries === "number" ? retries : 1;
    try {
      return await callAI(action, extra);
    } catch (e) {
      if (retries <= 0) throw e;
      await sleep(800);
      return callAIWithRetry(action, extra, retries - 1);
    }
  }

  function getCurrentModalDateKey() {
    var el = document.getElementById("modal-date");
    return el ? el.textContent.trim() : "";
  }

  function applyParsedEventToModal(parsed) {
    if (!parsed) return;

    if (parsed.title) {
      var titleInput = document.getElementById("event-title");
      if (titleInput) titleInput.value = parsed.title;
    }

    if (parsed.startH !== undefined && parsed.startH !== null && parsed.startH !== "") {
      var startH = document.getElementById("start-h");
      var startM = document.getElementById("start-m");
      var sh = parseInt(parsed.startH, 10);
      if (startH && !isNaN(sh)) startH.value = sh;
      if (startM && parsed.startM !== undefined && parsed.startM !== null) {
        var sm = parseInt(parsed.startM, 10);
        if (!isNaN(sm)) startM.value = roundToStep(sm);
      }
    }

    if (parsed.endH !== undefined && parsed.endH !== null && parsed.endH !== "") {
      var endH = document.getElementById("end-h");
      var endM = document.getElementById("end-m");
      var eh = parseInt(parsed.endH, 10);
      if (endH && !isNaN(eh)) endH.value = eh;
      if (endM && parsed.endM !== undefined && parsed.endM !== null) {
        var em = parseInt(parsed.endM, 10);
        if (!isNaN(em)) endM.value = roundToStep(em);
      }
    }

    if (parsed.tag) {
      var tagSel = document.getElementById("event-tag");
      if (tagSel) {
        var hasOption = Array.prototype.some.call(tagSel.options, function(o) { return o.value === parsed.tag; });
        if (hasOption) tagSel.value = parsed.tag;
      }
    }
  }

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

  var currentModalEvent = null;
  window.App.onModalOpen.push(function(dateKey, event) {
    currentModalEvent = event || null;
  });

  function navigateCalendarToDate(dateKey) {
    var parts = dateKey.split("-").map(Number);
    window.App.currentYear = parts[0];
    window.App.currentMonth = parts[1] - 1;
    window.App.renderCalendar();
  }

  function openAddModalForDate(dateKey) {
    navigateCalendarToDate(dateKey);
    var cell = document.querySelector('.day-cell[data-date="' + dateKey + '"]');
    if (cell) {
      cell.click();
      return true;
    }
    return false;
  }

  async function handleAiParsedResult(parsed) {
    var referenceDate = getCurrentModalDateKey();
    var titleInput = document.getElementById("event-title");

    if (parsed.date && referenceDate && parsed.date !== referenceDate) {
      if (!currentModalEvent) {
        var moved = openAddModalForDate(parsed.date);
        if (moved) {
          await sleep(150);
          applyParsedEventToModal(parsed);
          return;
        }
      } else {
        applyParsedEventToModal(parsed);
        if (titleInput) {
          showInlineNote(
            titleInput.closest(".form-group"),
            "AIは日付「" + parsed.date + "」を検出しましたが、編集中の予定の日付（" + referenceDate + "）は変更されません。",
            false
          );
        }
        return;
      }
    }

    applyParsedEventToModal(parsed);
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
  var notifiedKeys = {};

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

  function updateNotificationButton() {
    var existing = document.getElementById("notif-permission-btn");
    if (existing) existing.remove();

    if (!("Notification" in window)) return;
    if (Notification.permission !== "default") return;

    var drawer = document.getElementById("drawer");
    var logoutBtn = document.getElementById("logout-btn");
    if (!drawer || !logoutBtn) return;

    var btn = document.createElement("button");
    btn.id = "notif-permission-btn";
    btn.className = "drawer-item";
    btn.textContent = "🔔 通知を許可";
    btn.onclick = function(){
      if (typeof closeDrawer === "function") closeDrawer();
      requestNotificationPermission();
    };
    drawer.insertBefore(btn, logoutBtn);
  }

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
    var lastRecognizedText = "";

    function createRecognition() {
      var r = new SpeechRecognition();
      r.lang = "ja-JP";
      r.continuous = false;
      r.interimResults = false;

      r.onresult = function(e) {
        var text = e.results[0][0].transcript;
        eventTitleInput.value = text;
        lastRecognizedText = text;
      };
      r.onend = function() {
        isRecording = false;
        micBtn.classList.remove("recording");
        micBtn.textContent = "🎤";

        var text = lastRecognizedText;
        lastRecognizedText = "";
        if (text) {
          micBtn.disabled = true;
          var originalIcon = micBtn.textContent;
          micBtn.textContent = "⏳";
          callAI("parse_text", { text: text, referenceDate: getCurrentModalDateKey() })
            .then(function(parsed) {
              return handleAiParsedResult(parsed);
            })
            .catch(function(e) {
              console.error("音声のAI解析に失敗:", e);
              showInlineNote(
                eventTitleInput.closest(".form-group"),
                "日時の自動解析に失敗しました。タイトルは認識結果のまま反映されています。",
                true
              );
            })
            .finally(function() {
              micBtn.disabled = false;
              micBtn.textContent = "🎤";
            });
        }
      };
      r.onerror = function(e) {
        console.error("音声認識エラー:", e.error);
        isRecording = false;
        micBtn.classList.remove("recording");
        micBtn.textContent = "🎤";
        if (e.error === "not-allowed" || e.error === "service-not-allowed") {
          showInlineNote(micBtn, "マイクの使用が許可されていません。ブラウザ・端末の設定を確認してください。", true);
        }
      };
      return r;
    }

    micBtn.onclick = function() {
      if (location.protocol !== "https:" && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
        showInAppToast("セキュリティ制限", "音声認識は HTTPS 環境（https://...）でのみ動作します。");
        return;
      }

      if (isRecording) {
        if (recognition) recognition.stop();
        return;
      }
      recognition = createRecognition();
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
  // AIでテキスト解析（モーダル内）
  // ============================================================
  (function setupAiTextParse() {
    var eventTitleInput = document.getElementById("event-title");
    var micBtn = document.getElementById("mic-btn");
    if (!eventTitleInput || !micBtn) return;

    var aiBtn = document.createElement("button");
    aiBtn.type = "button";
    aiBtn.id = "ai-parse-btn";
    aiBtn.className = "btn-mic";
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
        
        // ★修正: AIが日付を返さなかった場合は、今開いているモーダルの日付で補完する
        if (parsed && !parsed.date) {
            parsed.date = referenceDate;
        }

        await handleAiParsedResult(parsed);
      } catch (e) {
        showInlineNote(eventTitleInput.closest(".form-group"), e.message, true);
      } finally {
        aiBtn.disabled = false;
        aiBtn.textContent = originalText;
      }
    };
  })();

  // ============================================================
  // 画像認識
  // ============================================================
  (function setupImageRecognition() {
    var eventImage = document.getElementById("event-image");
    var imageResult = document.getElementById("image-result");
    if (!eventImage || !imageResult) return;

    function resizeImage(file, maxWidth, maxHeight) {
      return new Promise(function(resolve, reject) {
        var img = new Image();
        img.src = URL.createObjectURL(file);
        img.onload = function() {
          var width = img.width;
          var height = img.height;
          if (width > maxWidth || height > maxHeight) {
            if (width > height) {
              height *= maxWidth / width;
              width = maxWidth;
            } else {
              width *= maxHeight / height;
              height = maxHeight;
            }
          }
          var canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          var ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, width, height);
          var base64 = canvas.toDataURL("image/jpeg", 0.8).split(",")[1];
          resolve(base64);
        };
        img.onerror = reject;
      });
    }

    function waitForUserAction() {
      return new Promise(function(resolve) {
        var overlay = document.getElementById("modal-overlay");
        var interval = setInterval(function() {
          if (!overlay.classList.contains("active")) {
            clearInterval(interval);
            resolve();
          }
        }, 300);
      });
    }

    eventImage.onchange = function() {
      var file = this.files[0];
      if (!file) return;

      imageResult.textContent = "画像を最適化して分析中...";

      var reader = new FileReader();
      reader.onload = async function() {
        try {
          var base64 = await resizeImage(file, 1024, 1024);
          var referenceDate = getCurrentModalDateKey();

          imageResult.textContent = "AI分析中...";

          var parsed = await callAIWithRetry("parse_image", {
            image: base64,
            mediaType: "image/jpeg",
            referenceDate: referenceDate,
            instruction: "画像内に複数の予定がある場合は、それらすべてを配列形式で返してください。"
          }, 1);

          var eventsToProcess = [];
          if (Array.isArray(parsed)) {
            eventsToProcess = parsed;
          } else if (parsed && typeof parsed === "object") {
            if (Array.isArray(parsed.events)) {
              eventsToProcess = parsed.events;
            } else {
              eventsToProcess = [parsed];
            }
          }

          if (eventsToProcess.length === 0 || !eventsToProcess[0]) {
            throw new Error("予定を検出できませんでした。");
          }

          var cancelBtn = document.getElementById("cancel-btn");
          if (cancelBtn) cancelBtn.click();
          await new Promise(function(res) { setTimeout(res, 300); });

          var bulkAdd = false;
          if (eventsToProcess.length > 1) {
            bulkAdd = confirm(
              "画像から " + eventsToProcess.length + " 件の予定を検出しました。\n" +
              "OK：内容を確認せずに全部まとめて追加する\n" +
              "キャンセル：1件ずつ内容を確認しながら追加する"
            );
          }

          if (bulkAdd) {
            var addedCount = 0;
            for (var b = 0; b < eventsToProcess.length; b++) {
              var bd = eventsToProcess[b];
              var bdDate = bd.date || referenceDate;
              if (!bdDate) continue;
              try {
                var added = await addOneImportedEvent({
                  dateKey: bdDate,
                  title: bd.title || "（タイトルなし）",
                  startH: bd.startH, startM: bd.startM,
                  endH: bd.endH, endM: bd.endM,
                  tag: bd.tag,
                });
                if (added) addedCount++;
              } catch (e) {
                console.error("画像からの一括追加中にエラー:", bd, e);
              }
            }
            showInAppToast("追加完了", eventsToProcess.length + "件中 " + addedCount + "件を追加しました。");
          } else {
            for (var i = 0; i < eventsToProcess.length; i++) {
              var evData = eventsToProcess[i];
              var targetDate = evData.date || referenceDate;
              if (!targetDate) continue;

              navigateCalendarToDate(targetDate);

              var cell = document.querySelector('.day-cell[data-date="' + targetDate + '"]');
              if (cell) {
                cell.click();
                applyParsedEventToModal(evData);

                var modalTitle = document.getElementById("modal-title");
                if (modalTitle) {
                  modalTitle.textContent = "画像からの予定確認 (" + (i + 1) + "/" + eventsToProcess.length + ")";
                }

                var currentResult = document.getElementById("image-result");
                if (currentResult) {
                  currentResult.textContent = "内容を確認して「保存」を押してください。";
                }

                await waitForUserAction();
                await new Promise(function(res) { setTimeout(res, 300); });
              }
            }
            showInAppToast("確認完了", "すべての予定の確認が終わりました。");
          }

        } catch (e) {
          var currentResultErr = document.getElementById("image-result");
          if (currentResultErr) currentResultErr.textContent = "分析に失敗しました: " + e.message;
          if (typeof showInAppToast === "function") {
            showInAppToast("エラー", e.message);
          }
        } finally {
          eventImage.value = "";
        }
      };
      reader.readAsDataURL(file);
    };
  })();

  // ============================================================
  // AIで予定をサッと追加
  // ============================================================
  function openQuickAddOverlay() {
    var overlay = document.createElement("div");
    overlay.className = "modal-overlay active";
    overlay.id = "ai-quickadd-overlay";
    overlay.style.zIndex = "1000";

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
        var todayNow = new Date();
        var todayKeyForAI = window.App.formatDate(todayNow.getFullYear(), todayNow.getMonth(), todayNow.getDate());
        
        var parsed = await callAI("parse_text", { text: text, referenceDate: todayKeyForAI });
        console.log("[AIで予定を追加] 解析結果:", parsed);

        // ★修正: AIが日付を null で返してきた場合の救済措置（今日の日付を補完する）
        if (parsed && !parsed.date) {
            parsed.date = todayKeyForAI;
        }

        // タイトルすら取れなかった場合のみエラーにする
        if (!parsed || !parsed.title) {
            throw new Error("予定を読み取れませんでした。もう少し具体的に入力してください。");
        }

        var parts = parsed.date.split("-").map(Number);
        window.App.currentYear = parts[0];
        window.App.currentMonth = parts[1] - 1;
        window.App.renderCalendar();

        var cell = document.querySelector('.day-cell[data-date="' + parsed.date + '"]');
        overlay.remove();

        if (cell) {
          cell.click();
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
    var drawer = document.getElementById("drawer");
    var logoutBtn = document.getElementById("logout-btn");
    if (!drawer || !logoutBtn) return;

    var btn = document.createElement("button");
    btn.id = "ai-quickadd-btn";
    btn.className = "drawer-item";
    btn.textContent = "🤖 AIで追加";
    btn.onclick = function() {
      if (typeof closeDrawer === "function") closeDrawer();
      openQuickAddOverlay();
    };
    drawer.insertBefore(btn, logoutBtn);
  }

  // ============================================================
  // .ics エクスポート/インポート
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

  window.App.onModalOpen.push(function(dateKey, event) {
    var existing = document.getElementById("export-ics-btn");
    if (existing) existing.remove();
    if (!event) return;

    var modalButtons = document.querySelector(".modal-buttons");
    if (!modalButtons) return;

    var btn = document.createElement("button");
    btn.type = "button";
    btn.id = "export-ics-btn";
    btn.className = "btn-cancel";
    btn.textContent = "📤 エクスポート";
    btn.onclick = function() { exportSingleEvent(dateKey, event); };
    modalButtons.appendChild(btn);
  });

  function addExportAllButton() {
    if (document.getElementById("export-all-btn")) return;
    var drawer = document.getElementById("drawer");
    var logoutBtn = document.getElementById("logout-btn");
    if (!drawer || !logoutBtn) return;

    var btn = document.createElement("button");
    btn.id = "export-all-btn";
    btn.className = "drawer-item";
    btn.textContent = "📤 全予定を書き出す";
    btn.onclick = function() {
      if (typeof closeDrawer === "function") closeDrawer();
      exportAllEvents();
    };
    drawer.insertBefore(btn, logoutBtn);
  }

  function parseICSDateValue(value) {
    if (!value) return null;
    value = value.trim();

    var m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
    if (!m) return null;

    var year = Number(m[1]), month = Number(m[2]), day = Number(m[3]);

    if (!m[4]) {
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

  function parseICS(text) {
    var normalized = text.replace(/\r\n[ \t]/g, "");
    var blocks = normalized.split("BEGIN:VEVENT").slice(1);

    return blocks.map(function(block) {
      block = block.split("END:VEVENT")[0];

      function getField(name) {
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

  async function addOneImportedEvent(evt) {
    var parts = evt.dateKey.split("-").map(Number);
    window.App.currentYear = parts[0];
    window.App.currentMonth = parts[1] - 1;
    window.App.renderCalendar();

    var cell = document.querySelector('.day-cell[data-date="' + evt.dateKey + '"]');
    if (!cell) return false;

    cell.click();

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
    await sleep(200);
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
    var drawer = document.getElementById("drawer");
    var logoutBtn = document.getElementById("logout-btn");
    if (!drawer || !logoutBtn) return;

    var fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".ics";
    fileInput.style.display = "none";
    fileInput.id = "import-ics-input";
    fileInput.onchange = function() {
      var file = this.files[0];
      this.value = "";
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
    btn.className = "drawer-item";
    btn.textContent = "📥 予定を取り込む";
    btn.title = "Googleカレンダー等でエクスポートした.icsファイルを取り込む";
    btn.onclick = function() { 
      if (typeof closeDrawer === "function") closeDrawer();
      fileInput.click(); 
    };
    drawer.insertBefore(btn, logoutBtn);
  }

  // ============================================================
  // 初期化
  // ============================================================
  window.App.onReady.push(function() {
    updateNotificationButton();
    addQuickAddButton();
    addExportAllButton();
    addImportButton();
    checkReminders();
    console.log("機能B: 初期化完了");
  });

})();