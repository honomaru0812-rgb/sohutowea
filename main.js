/* ============================================================
   main.js — 実装担当（あなた）用
   ============================================================
   【担当する内容】
   ・Supabase接続
   ・ログイン・新規登録・ログアウト
   ・カレンダー描画の基本ロジック
   ・予定の保存・読み込み・削除（データベース操作）
   ・他のファイル（features-a.js, features-b.js）との統合
   
   【ルール】
   ・グローバル変数は window.App にまとめる
   ・機能A, B が使う関数は window.App に追加する
   ============================================================ */

// ============================================================
// 🔧 Supabase設定 — config.js から読み込まれます
//    config.js の SUPABASE_URL と SUPABASE_KEY を書き換えてください
// ============================================================

// ============================================================
// Supabase クライアント作成
// ============================================================
var supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ============================================================
// グローバル変数（他のファイルからも使う）
// ============================================================
window.App = {
  supabase: supabaseClient,
  currentUser: null,
  events: {},           // { "2026-07-06": [{id, title, ...}] }
  currentYear: new Date().getFullYear(),
  currentMonth: new Date().getMonth(),

  // 他のファイルが登録するフック（初期化時に呼ばれる）
  onReady: [],          // アプリ起動時に実行する関数リスト
  onEventsLoaded: [],   // 予定読み込み完了時に実行する関数リスト
  onCalendarRender: [], // カレンダー描画後に実行する関数リスト
  onEventSave: [],      // 予定保存時に実行する関数リスト
  onModalOpen: [],      // モーダルを開いた時に実行する関数リスト
};

var COLORS = ["#4A7BF7", "#34A853", "#EA4335", "#9B59B6", "#F5A623"];
var MONTH_NAMES = ["1月","2月","3月","4月","5月","6月","7月","8月","9月","10月","11月","12月"];

var isLoginMode = true;
var editingEvent = null;
var selectedDate = "";
var selectedColor = "#4A7BF7";

// ============================================================
// 要素の取得
// ============================================================
var loginScreen   = document.getElementById("login-screen");
var appScreen     = document.getElementById("app-screen");
var emailInput    = document.getElementById("email-input");
var passwordInput = document.getElementById("password-input");
var passwordConfirmInput = document.getElementById("password-confirm-input");
var passwordConfirmGroup = document.getElementById("password-confirm-group");
var authBtn       = document.getElementById("auth-btn");
var errorMsg      = document.getElementById("error-msg");
var successMsg    = document.getElementById("success-msg");
var switchLink    = document.getElementById("switch-link");
var switchMsgEl   = document.getElementById("switch-msg");
var loginSubtitle = document.getElementById("login-subtitle");
var displayEmail  = document.getElementById("display-email");
var logoutBtn     = document.getElementById("logout-btn");
var prevBtn       = document.getElementById("prev-btn");
var nextBtn       = document.getElementById("next-btn");
var todayBtn      = document.getElementById("today-btn");
var monthLabel    = document.getElementById("month-label");
var calGrid       = document.getElementById("cal-grid");
var modalOverlay  = document.getElementById("modal-overlay");
var modalTitle    = document.getElementById("modal-title");
var modalDate     = document.getElementById("modal-date");
var eventTitleInput = document.getElementById("event-title");
var saveBtn       = document.getElementById("save-btn");
var deleteBtn     = document.getElementById("delete-btn");
var cancelBtn     = document.getElementById("cancel-btn");
var colorPicker   = document.getElementById("color-picker");

// ============================================================
// ユーティリティ関数
// ============================================================
function formatDate(y, m, d) {
  return y + "-" + String(m + 1).padStart(2, "0") + "-" + String(d).padStart(2, "0");
}

function findEvent(dateKey, id) {
  var list = window.App.events[dateKey] || [];
  for (var i = 0; i < list.length; i++) {
    if (list[i].id === id) return list[i];
  }
  return null;
}

// 予定が過去かどうか判定
function isEventPast(dateKey, endH, endM) {
  var now = new Date();
  var parts = dateKey.split("-");
  var eventEnd = new Date(parts[0], parts[1] - 1, parts[2], endH, endM);
  return eventEnd < now;
}

// ============================================================
// 時間セレクト・カラーピッカー
// ============================================================
function fillTimeSelects() {
  var hSelects = [document.getElementById("start-h"), document.getElementById("end-h")];
  var mSelects = [document.getElementById("start-m"), document.getElementById("end-m")];
  for (var s = 0; s < hSelects.length; s++) {
    hSelects[s].innerHTML = "";
    for (var h = 0; h < 24; h++) {
      var opt = document.createElement("option");
      opt.value = h; opt.text = String(h).padStart(2, "0");
      hSelects[s].appendChild(opt);
    }
  }
  for (var s = 0; s < mSelects.length; s++) {
    mSelects[s].innerHTML = "";
    [0, 15, 30, 45].forEach(function(m) {
      var opt = document.createElement("option");
      opt.value = m; opt.text = String(m).padStart(2, "0");
      mSelects[s].appendChild(opt);
    });
  }
}
fillTimeSelects();

function renderColorPicker() {
  colorPicker.innerHTML = "";
  COLORS.forEach(function(c) {
    var dot = document.createElement("button");
    dot.className = "color-dot" + (c === selectedColor ? " selected" : "");
    dot.style.background = c;
    dot.style.color = c;
    dot.setAttribute("data-color", c);
    dot.onclick = function() {
      selectedColor = this.getAttribute("data-color");
      renderColorPicker();
    };
    colorPicker.appendChild(dot);
  });
}

// ============================================================
// メッセージ表示
// ============================================================
function showError(msg) {
  errorMsg.textContent = msg; errorMsg.style.display = "block";
  successMsg.style.display = "none";
}
function showSuccess(msg) {
  successMsg.textContent = msg; successMsg.style.display = "block";
  errorMsg.style.display = "none";
}
function hideMessages() {
  errorMsg.style.display = "none"; successMsg.style.display = "none";
}

// ============================================================
// 認証
// ============================================================
authBtn.onclick = async function() {
  hideMessages();
  var email = emailInput.value.trim();
  var password = passwordInput.value;

  if (!email || !password) { showError("メールアドレスとパスワードを入力してください"); return; }

  authBtn.disabled = true;
  authBtn.textContent = "処理中...";

  var result;
  if (isLoginMode) {
    result = await supabaseClient.auth.signInWithPassword({ email: email, password: password });
    if (result.error) {
      showError("ログイン失敗: " + result.error.message);
      authBtn.disabled = false; authBtn.textContent = "ログイン"; return;
    }
    window.App.currentUser = result.data.user;
    showApp();
  } else {
    var passwordConfirm = passwordConfirmInput.value;

    if (password.length < 6) {
      showError("パスワードは6文字以上にしてください");
      authBtn.disabled = false; authBtn.textContent = "登録"; return;
    }
    if (password !== passwordConfirm) {
      showError("パスワードが一致しません。もう一度入力してください");
      authBtn.disabled = false; authBtn.textContent = "登録"; return;
    }
    result = await supabaseClient.auth.signUp({ email: email, password: password });
    if (result.error) {
      showError("登録失敗: " + result.error.message);
      authBtn.disabled = false; authBtn.textContent = "登録"; return;
    }
    if (result.data.user && !result.data.session) {
      showSuccess("確認メールを送信しました。リンクをクリックしてからログインしてください。");
      authBtn.disabled = false; authBtn.textContent = "登録"; return;
    }
    window.App.currentUser = result.data.user;
    showApp();
  }
};

passwordInput.onkeydown = function(e) { if (e.key === "Enter") authBtn.click(); };

switchLink.onclick = function() {
  isLoginMode = !isLoginMode; hideMessages();
  authBtn.textContent = isLoginMode ? "ログイン" : "登録";
  switchMsgEl.textContent = isLoginMode ? "アカウントがない？" : "すでにアカウントがある？";
  switchLink.textContent = isLoginMode ? "新規登録" : "ログイン";
  loginSubtitle.textContent = isLoginMode ? "ログインして予定を管理" : "アカウントを作成";
  passwordConfirmGroup.style.display = isLoginMode ? "none" : "block";
  passwordConfirmInput.value = "";
  authBtn.disabled = false;
};

logoutBtn.onclick = async function() {
  await supabaseClient.auth.signOut();
  window.App.currentUser = null;
  window.App.events = {};
  appScreen.style.display = "none";
  loginScreen.style.display = "flex";
  emailInput.value = ""; passwordInput.value = ""; passwordConfirmInput.value = "";
  passwordConfirmGroup.style.display = "none";
  authBtn.textContent = "ログイン"; authBtn.disabled = false;
  isLoginMode = true; hideMessages();
};

// ============================================================
// アプリ画面表示
// ============================================================
async function showApp() {
  loginScreen.style.display = "none";
  appScreen.style.display = "block";
  displayEmail.textContent = window.App.currentUser.email;
  authBtn.disabled = false;
  authBtn.textContent = isLoginMode ? "ログイン" : "登録";

  await loadEvents();
  renderCalendar();

  // 他ファイルの初期化フックを実行
  window.App.onReady.forEach(function(fn) { fn(); });
}

// ============================================================
// データベース操作
// ============================================================
async function loadEvents() {
  window.App.events = {};
  var result = await supabaseClient
    .from("events").select("*")
    .eq("user_id", window.App.currentUser.id);

  if (result.error) { console.error("読み込みエラー:", result.error.message); return; }

  result.data.forEach(function(row) {
    var evt = {
      id: row.id,
      title: row.title,
      startH: row.start_h,
      startM: row.start_m,
      endH: row.end_h,
      endM: row.end_m,
      color: row.color,
      tag: row.tag || "",
      icon: row.icon || "",
      repeat: row.repeat_type || "none",
      reminder: row.reminder_min || "none",
    };
    if (!window.App.events[row.date_key]) window.App.events[row.date_key] = [];
    window.App.events[row.date_key].push(evt);
  });

  // フック実行
  window.App.onEventsLoaded.forEach(function(fn) { fn(); });
}

async function saveEventToDB(dateKey, eventData, isEdit) {
  var record = {
    user_id: window.App.currentUser.id,
    date_key: dateKey,
    title: eventData.title,
    start_h: eventData.startH,
    start_m: eventData.startM,
    end_h: eventData.endH,
    end_m: eventData.endM,
    color: eventData.color,
    tag: eventData.tag || "",
    icon: eventData.icon || "",
    repeat_type: eventData.repeat || "none",
    reminder_min: eventData.reminder || "none",
  };

  if (isEdit) {
    await supabaseClient.from("events").update(record).eq("id", eventData.id);
  } else {
    var result = await supabaseClient.from("events").insert(record).select();
    if (result.data && result.data[0]) eventData.id = result.data[0].id;
  }
}

async function removeEventFromDB(eventId) {
  await supabaseClient.from("events").delete().eq("id", eventId);
}

// ============================================================
// カレンダー描画
// ============================================================
function renderCalendar() {
  monthLabel.textContent = window.App.currentYear + "年 " + MONTH_NAMES[window.App.currentMonth];
  calGrid.innerHTML = "";

  var daysInMonth = new Date(window.App.currentYear, window.App.currentMonth + 1, 0).getDate();
  var firstDay = new Date(window.App.currentYear, window.App.currentMonth, 1).getDay();
  firstDay = (firstDay === 0) ? 6 : firstDay - 1;

  var today = new Date();
  var todayKey = formatDate(today.getFullYear(), today.getMonth(), today.getDate());

  for (var i = 0; i < firstDay; i++) {
    var empty = document.createElement("div");
    empty.style.minHeight = "70px";
    calGrid.appendChild(empty);
  }

  for (var d = 1; d <= daysInMonth; d++) {
    var dateKey = formatDate(window.App.currentYear, window.App.currentMonth, d);
    var colIndex = (firstDay + d - 1) % 7;
    var isToday = (dateKey === todayKey);

    var cell = document.createElement("div");
    cell.className = "day-cell" + (isToday ? " today" : "");
    cell.setAttribute("data-date", dateKey);
    cell.onclick = function() { openModal(this.getAttribute("data-date"), null); };

    var numSpan = document.createElement("span");
    numSpan.className = "day-number";
    if (isToday) numSpan.className += " today-num";
    if (colIndex === 5) numSpan.className += " sat";
    if (colIndex === 6) numSpan.className += " sun";
    numSpan.textContent = d;
    cell.appendChild(numSpan);

    var dayEvents = window.App.events[dateKey] || [];
    for (var e = 0; e < Math.min(dayEvents.length, 3); e++) {
      var evt = dayEvents[e];
      var chip = document.createElement("div");
      chip.className = "event-chip";
      if (isEventPast(dateKey, evt.endH, evt.endM)) chip.className += " past";
      chip.style.background = evt.color;
      chip.textContent = (evt.icon ? evt.icon + " " : "") + evt.title;
      chip.setAttribute("data-date", dateKey);
      chip.setAttribute("data-id", evt.id);
      chip.onclick = function(ev) {
        ev.stopPropagation();
        var dk = this.getAttribute("data-date");
        var id = this.getAttribute("data-id");
        var found = findEvent(dk, id);
        if (found) openModal(dk, found);
      };
      cell.appendChild(chip);
    }
    if (dayEvents.length > 3) {
      var more = document.createElement("span");
      more.className = "more-label";
      more.textContent = "+" + (dayEvents.length - 3) + "件";
      cell.appendChild(more);
    }

    calGrid.appendChild(cell);
  }

  // フック実行
  window.App.onCalendarRender.forEach(function(fn) { fn(); });
}

// グローバルに公開（他ファイルから呼べるように）
window.App.renderCalendar = renderCalendar;
window.App.loadEvents = loadEvents;
window.App.formatDate = formatDate;
window.App.isEventPast = isEventPast;

// 前月・次月・今日
prevBtn.onclick = function() {
  window.App.currentMonth--;
  if (window.App.currentMonth < 0) { window.App.currentMonth = 11; window.App.currentYear--; }
  renderCalendar();
};
nextBtn.onclick = function() {
  window.App.currentMonth++;
  if (window.App.currentMonth > 11) { window.App.currentMonth = 0; window.App.currentYear++; }
  renderCalendar();
};
todayBtn.onclick = function() {
  var now = new Date();
  window.App.currentYear = now.getFullYear();
  window.App.currentMonth = now.getMonth();
  renderCalendar();
};

// ============================================================
// モーダル
// ============================================================
function openModal(dateKey, event) {
  selectedDate = dateKey;
  editingEvent = event;
  selectedColor = event ? event.color : "#4A7BF7";

  modalTitle.textContent = event ? "予定を編集" : "予定を追加";
  modalDate.textContent = dateKey;
  eventTitleInput.value = event ? event.title : "";

  document.getElementById("start-h").value = event ? event.startH : 9;
  document.getElementById("start-m").value = event ? event.startM : 0;
  document.getElementById("end-h").value   = event ? event.endH : 10;
  document.getElementById("end-m").value   = event ? event.endM : 0;

  // タグ・アイコン・繰り返し・リマインダー
  var tagSel = document.getElementById("event-tag");
  if (tagSel) tagSel.value = event ? (event.tag || "") : "";
  var repeatSel = document.getElementById("event-repeat");
  if (repeatSel) repeatSel.value = event ? (event.repeat || "none") : "none";
  var reminderSel = document.getElementById("event-reminder");
  if (reminderSel) reminderSel.value = event ? (event.reminder || "none") : "none";

  deleteBtn.style.display = event ? "block" : "none";
  renderColorPicker();
  modalOverlay.classList.add("active");
  eventTitleInput.focus();

  // フック実行
  window.App.onModalOpen.forEach(function(fn) { fn(dateKey, event); });
}

function closeModal() {
  modalOverlay.classList.remove("active");
  editingEvent = null;
}

// 保存
saveBtn.onclick = async function() {
  var title = eventTitleInput.value.trim();
  if (!title) return;

  var tagSel = document.getElementById("event-tag");
  var repeatSel = document.getElementById("event-repeat");
  var reminderSel = document.getElementById("event-reminder");

  var eventData = {
    id: editingEvent ? editingEvent.id : null,
    title: title,
    startH: parseInt(document.getElementById("start-h").value),
    startM: parseInt(document.getElementById("start-m").value),
    endH: parseInt(document.getElementById("end-h").value),
    endM: parseInt(document.getElementById("end-m").value),
    color: selectedColor,
    tag: tagSel ? tagSel.value : "",
    icon: window.App.selectedIcon || (editingEvent ? editingEvent.icon : ""),
    repeat: repeatSel ? repeatSel.value : "none",
    reminder: reminderSel ? reminderSel.value : "none",
  };

  await saveEventToDB(selectedDate, eventData, !!editingEvent);

  if (!window.App.events[selectedDate]) window.App.events[selectedDate] = [];

  if (editingEvent) {
    for (var i = 0; i < window.App.events[selectedDate].length; i++) {
      if (window.App.events[selectedDate][i].id === editingEvent.id) {
        window.App.events[selectedDate][i] = eventData;
        break;
      }
    }
  } else {
    window.App.events[selectedDate].push(eventData);
  }

  // 保存フック実行
  window.App.onEventSave.forEach(function(fn) { fn(selectedDate, eventData); });

  closeModal();
  renderCalendar();
};

// 削除
deleteBtn.onclick = async function() {
  if (!editingEvent) return;
  await removeEventFromDB(editingEvent.id);

  var list = window.App.events[selectedDate];
  for (var i = 0; i < list.length; i++) {
    if (list[i].id === editingEvent.id) { list.splice(i, 1); break; }
  }
  if (list.length === 0) delete window.App.events[selectedDate];

  closeModal();
  renderCalendar();
};

cancelBtn.onclick = closeModal;
modalOverlay.onclick = function(e) { if (e.target === modalOverlay) closeModal(); };

// 表示切り替え（カレンダー ↔ 一覧）
document.querySelectorAll(".view-tab").forEach(function(tab) {
  tab.onclick = function() {
    document.querySelectorAll(".view-tab").forEach(function(t) { t.classList.remove("active"); });
    this.classList.add("active");
    var view = this.getAttribute("data-view");
    document.getElementById("calendar-view").style.display = (view === "calendar") ? "block" : "none";
    document.getElementById("list-view").style.display = (view === "list") ? "block" : "none";
    // 一覧表示の更新
    if (view === "list" && window.App.renderList) window.App.renderList();
  };
});

// ============================================================
// ページ読み込み時：セッション確認
// ============================================================
async function checkSession() {
  var result = await supabaseClient.auth.getSession();
  if (result.data.session) {
    window.App.currentUser = result.data.session.user;
    showApp();
  }
}
checkSession();
