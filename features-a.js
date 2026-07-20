/* ============================================================
   features-a.js — 機能担当A 用
   ============================================================
   【担当する機能】
   ・検索機能（ヘッダーの検索バー）
   ・一覧表示 + ソート機能
   ・タグ分け
   ・アイコン選択
   ・繰り返し予定の処理
   ・終わった予定のグレー表示（CSS側は .past クラスで対応済み）
   ・自動的に終わった予定を非表示にするオプション

   【ルール】
   ・window.App を通じてデータにアクセスする
   ・HTMLの id="xxx" を使って要素を取得する
   ・新しいHTMLが必要な場合は、JavaScriptで動的に追加する
   ・styles.css のクラス名を使う（新しいクラスが必要ならデザイン担当に依頼）
   ============================================================ */

(function() {
  // ============================================================
  // 共通ユーティリティ
  // ============================================================

  // HTMLエスケープ（タイトル・タグにユーザー入力が入るため）
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // 「終わった予定を自動的に非表示」設定（localStorageに保存して次回起動時も保持）
  var HIDE_PAST_KEY = "schedule-hide-past-events";

  function getHidePastPref() {
    try {
      return localStorage.getItem(HIDE_PAST_KEY) === "true";
    } catch (e) {
      return false;
    }
  }

  function setHidePastPref(val) {
    try {
      localStorage.setItem(HIDE_PAST_KEY, val ? "true" : "false");
    } catch (e) {
      // localStorageが使えない環境では何もしない
    }
  }

  // タグごとの色分け（未定義のタグはデフォルト色にフォールバック）
  var TAG_STYLES = {
    "仕事":         { bg: "#e8f0fe", color: "#4A7BF7" },
    "プライベート": { bg: "#e6f7ee", color: "#1a7f37" },
    "勉強":         { bg: "#fff4e0", color: "#b8860b" },
    "健康":         { bg: "#ffe8ec", color: "#c0392b" },
    "買い物":       { bg: "#f3e8ff", color: "#8e44ad" }
  };

  function applyTagStyle(el, tag) {
    var style = TAG_STYLES[tag];
    if (style) {
      el.style.background = style.bg;
      el.style.color = style.color;
    }
  }

  // ============================================================
  // アイコンピッカーの初期化
  // ============================================================
  var ICONS = ["📅", "💼", "🏠", "📚", "💪", "🛒", "🎉", "✈️", "🍽️", "💊", "🎓", "⚽"];
  window.App.selectedIcon = "";

  function renderIconPicker(currentIcon) {
    var picker = document.getElementById("icon-picker");
    if (!picker) return;
    picker.innerHTML = "";

    // 「なし」オプション
    var noneBtn = document.createElement("button");
    noneBtn.className = "icon-option" + (!currentIcon ? " selected" : "");
    noneBtn.textContent = "✕";
    noneBtn.title = "なし";
    noneBtn.onclick = function() {
      window.App.selectedIcon = "";
      renderIconPicker("");
    };
    picker.appendChild(noneBtn);

    ICONS.forEach(function(icon) {
      var btn = document.createElement("button");
      btn.className = "icon-option" + (icon === currentIcon ? " selected" : "");
      btn.textContent = icon;
      btn.onclick = function() {
        window.App.selectedIcon = icon;
        renderIconPicker(icon);
      };
      picker.appendChild(btn);
    });
  }

  // モーダルが開いた時にアイコンピッカーを更新
  // （event が null＝新規追加なら空、編集なら保存されているアイコンを反映）
  window.App.onModalOpen.push(function(dateKey, event) {
    var currentIcon = event ? (event.icon || "") : "";
    window.App.selectedIcon = currentIcon;
    renderIconPicker(currentIcon);
  });

  // ============================================================
  // カレンダーの該当日にジャンプする（検索結果・一覧の両方から使用）
  // ============================================================
  function jumpToCalendarDate(dateKey) {
    var parts = dateKey.split("-").map(Number);
    window.App.currentYear = parts[0];
    window.App.currentMonth = parts[1] - 1;
    if (window.App.renderCalendar) window.App.renderCalendar();

    // 「カレンダー」タブに切り替え
    var calTab = document.getElementById("tab-calendar");
    if (calTab) calTab.click();

    // タブ切り替え・再描画の完了を待ってからハイライト
    setTimeout(function() {
      var cell = document.querySelector('.day-cell[data-date="' + dateKey + '"]');
      if (!cell) return;
      cell.scrollIntoView({ behavior: "smooth", block: "center" });
      cell.style.transition = "box-shadow 0.3s";
      cell.style.boxShadow = "0 0 0 3px #4A7BF7";
      setTimeout(function() { cell.style.boxShadow = ""; }, 1600);
    }, 50);
  }

  window.App.jumpToCalendarDate = jumpToCalendarDate;

  // ============================================================
  // 検索機能
  // ============================================================
  var searchInput = document.getElementById("search-input");

  // 検索結果を #event-list に描画する（一覧表示のUIを再利用）
  function renderSearchResults(query) {
    var listContainer = document.getElementById("event-list");
    if (!listContainer) return;
    listContainer.innerHTML = "";

    var hidePast = getHidePastPref();
    var results = [];
    Object.keys(window.App.events).forEach(function(dateKey) {
      window.App.events[dateKey].forEach(function(evt) {
        var title = (evt.title || "").toLowerCase();
        var tag = (evt.tag || "").toLowerCase();
        if (title.indexOf(query) === -1 && tag.indexOf(query) === -1) return;
        if (hidePast && window.App.isEventPast(dateKey, evt.endH, evt.endM)) return;
        results.push({ dateKey: dateKey, event: evt });
      });
    });

    // 日付順に並べる
    results.sort(function(a, b) {
      return a.dateKey.localeCompare(b.dateKey) || a.event.startH - b.event.startH;
    });

    if (results.length === 0) {
      listContainer.innerHTML = '<p style="text-align:center; color:#888; padding:40px;">「' + escapeHtml(query) + '」に一致する予定がありません</p>';
      return;
    }

    results.forEach(function(item) {
      listContainer.appendChild(buildListItem(item.dateKey, item.event, query));
    });
  }

  window.App.renderSearchResults = renderSearchResults;

  if (searchInput) {
    searchInput.oninput = function() {
      var query = this.value.trim().toLowerCase();

      if (!query) {
        // 検索欄が空なら通常の一覧表示に戻す
        if (window.App.renderList) window.App.renderList();
        return;
      }

      // 検索中は自動的に「一覧」タブに切り替える
      var listTab = document.getElementById("tab-list");
      if (listTab && !listTab.classList.contains("active")) {
        listTab.click();
      }

      renderSearchResults(query);
    };
  }

  // ============================================================
  // 一覧表示 + ソート・フィルター
  // ============================================================

  // マッチ部分を <mark> で囲む（検索結果表示用。新しいCSSクラス不要）
  function highlightMatch(text, query) {
    var escaped = escapeHtml(text);
    if (!query) return escaped;
    var lowerText = escaped.toLowerCase();
    var lowerQuery = query.toLowerCase();
    var idx = lowerText.indexOf(lowerQuery);
    if (idx === -1) return escaped;
    return escaped.slice(0, idx) +
      "<mark>" + escaped.slice(idx, idx + query.length) + "</mark>" +
      escaped.slice(idx + query.length);
  }

  // 一覧の1行分のDOMを作る（通常表示・検索結果表示の両方で共用）
  function buildListItem(dateKey, evt, highlightQuery) {
    var isPast = window.App.isEventPast(dateKey, evt.endH, evt.endM);
    var div = document.createElement("div");
    div.className = "event-list-item" + (isPast ? " past" : "");

    var startTime = String(evt.startH).padStart(2, "0") + ":" + String(evt.startM).padStart(2, "0");
    var endTime = String(evt.endH).padStart(2, "0") + ":" + String(evt.endM).padStart(2, "0");
    var titleHtml = highlightQuery ? highlightMatch(evt.title || "", highlightQuery) : escapeHtml(evt.title || "");
    var tagHtml = evt.tag ? (highlightQuery ? highlightMatch(evt.tag, highlightQuery) : escapeHtml(evt.tag)) : "";

    div.innerHTML =
      '<div class="event-list-icon">' + (evt.icon || "📅") + (evt.repeat && evt.repeat !== "none" ? " 🔁" : "") + '</div>' +
      '<div class="event-list-info">' +
      '  <div class="event-list-title">' + titleHtml + '</div>' +
      '  <div class="event-list-meta">' + dateKey + '　' + startTime + ' - ' + endTime + '</div>' +
      '</div>' +
      (evt.tag ? '<span class="event-list-tag" data-tag="' + escapeHtml(evt.tag) + '">' + tagHtml + '</span>' : '');

    if (evt.tag) applyTagStyle(div.querySelector(".event-list-tag"), evt.tag);

    // 「カレンダーで見る」ボタン（その日のカレンダー表示にジャンプする）
    var jumpBtn = document.createElement("button");
    jumpBtn.type = "button";
    jumpBtn.title = "カレンダーでこの日を見る";
    jumpBtn.textContent = "📅";
    jumpBtn.style.border = "none";
    jumpBtn.style.background = "#f0f0f0";
    jumpBtn.style.borderRadius = "6px";
    jumpBtn.style.width = "30px";
    jumpBtn.style.height = "30px";
    jumpBtn.style.fontSize = "14px";
    jumpBtn.style.cursor = "pointer";
    jumpBtn.style.flexShrink = "0";
    jumpBtn.onclick = function(ev) {
      ev.stopPropagation(); // 親要素の編集モーダルが開かないようにする
      jumpToCalendarDate(dateKey);
    };
    div.appendChild(jumpBtn);

    // クリックで編集モーダルを開く（ジャンプボタン以外の部分）
    div.style.cursor = "pointer";
    div.onclick = function() {
      if (window.App.openModal) window.App.openModal(dateKey, evt);
    };

    return div;
  }

  function renderList() {
    var listContainer = document.getElementById("event-list");
    if (!listContainer) return;
    listContainer.innerHTML = "";

    // 全予定をフラットな配列にする
    var allEvents = [];
    Object.keys(window.App.events).forEach(function(dateKey) {
      window.App.events[dateKey].forEach(function(evt) {
        allEvents.push({ dateKey: dateKey, event: evt });
      });
    });

    // ソート
    var sortSelect = document.getElementById("sort-select");
    var sortType = sortSelect ? sortSelect.value : "date-asc";

    allEvents.sort(function(a, b) {
      if (sortType === "date-asc") {
        return a.dateKey.localeCompare(b.dateKey) || a.event.startH - b.event.startH;
      } else if (sortType === "date-desc") {
        return b.dateKey.localeCompare(a.dateKey) || b.event.startH - a.event.startH;
      } else if (sortType === "title") {
        return a.event.title.localeCompare(b.event.title);
      } else if (sortType === "tag") {
        return (a.event.tag || "").localeCompare(b.event.tag || "");
      }
      return 0;
    });

    // タグフィルター
    var filterTag = document.getElementById("filter-tag");
    var selectedTag = filterTag ? filterTag.value : "";
    if (selectedTag) {
      allEvents = allEvents.filter(function(item) {
        return item.event.tag === selectedTag;
      });
    }

    // 終わった予定を隠すオプション
    if (getHidePastPref()) {
      allEvents = allEvents.filter(function(item) {
        return !window.App.isEventPast(item.dateKey, item.event.endH, item.event.endM);
      });
    }

    // 表示
    if (allEvents.length === 0) {
      listContainer.innerHTML = '<p style="text-align:center; color:#888; padding:40px;">予定がありません</p>';
      return;
    }

    allEvents.forEach(function(item) {
      listContainer.appendChild(buildListItem(item.dateKey, item.event, null));
    });
  }

  // ソート・フィルター変更時に再描画
  var sortSelect = document.getElementById("sort-select");
  if (sortSelect) sortSelect.onchange = renderList;
  var filterTag = document.getElementById("filter-tag");
  if (filterTag) filterTag.onchange = renderList;

  // グローバルに公開
  window.App.renderList = renderList;

  // 予定の保存・削除後に一覧表示も最新化する
  window.App.onEventSave.push(function() { renderList(); });
  window.App.onEventDelete.push(function() { renderList(); });

  // ============================================================
  // タグフィルターの選択肢を更新
  // ============================================================
  function updateTagFilter() {
    var filterTag = document.getElementById("filter-tag");
    if (!filterTag) return;

    var tags = {};
    Object.keys(window.App.events).forEach(function(dateKey) {
      window.App.events[dateKey].forEach(function(evt) {
        if (evt.tag) tags[evt.tag] = true;
      });
    });

    // 現在の選択を保持
    var current = filterTag.value;
    filterTag.innerHTML = '<option value="">すべてのタグ</option>';
    Object.keys(tags).forEach(function(tag) {
      var opt = document.createElement("option");
      opt.value = tag; opt.text = tag;
      filterTag.appendChild(opt);
    });
    filterTag.value = current;
  }

  // データ読み込み・保存・削除のたびにタグフィルターを更新
  window.App.onEventsLoaded.push(updateTagFilter);
  window.App.onEventSave.push(function() { updateTagFilter(); });
  window.App.onEventDelete.push(function() { updateTagFilter(); });

  // ============================================================
  // 「終わった予定を隠す」トグルの追加（一覧表示のコントロール欄に挿入）
  // ============================================================
  function initHidePastToggle() {
    if (document.getElementById("hide-past-toggle")) return; // 二重追加防止
    var controls = document.querySelector(".list-controls");
    if (!controls) return;

    var wrapper = document.createElement("label");
    wrapper.style.display = "flex";
    wrapper.style.alignItems = "center";
    wrapper.style.gap = "6px";
    wrapper.style.fontSize = "13px";
    wrapper.style.color = "#555";
    wrapper.style.cursor = "pointer";
    wrapper.style.userSelect = "none";

    var checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.id = "hide-past-toggle";
    checkbox.checked = getHidePastPref();
    checkbox.onchange = function() {
      setHidePastPref(this.checked);
      // カレンダー・一覧の両方に反映
      if (window.App.renderCalendar) window.App.renderCalendar();
      if (window.App.renderList) window.App.renderList();
    };

    wrapper.appendChild(checkbox);
    wrapper.appendChild(document.createTextNode("終わった予定を隠す"));
    controls.appendChild(wrapper);
  }

  window.App.onReady.push(initHidePastToggle);

  // ============================================================
  // 繰り返し予定の処理（daily / weekly / monthly）
  // ============================================================
  // 元の予定は window.App.events[元の日付] にそのまま1件だけ保存されている。
  // カレンダー描画後（onCalendarRender）に、表示中の月の中で
  // 繰り返し条件に当てはまる「他の日付」にもチップを追加で描画する。
  // クリックすると、元の予定を編集モーダルで開く（削除・編集は元の予定に反映される＝繰り返し全体に反映）。

  function generateRepeatOccurrences(originalDateKey, repeatType, year, month) {
    var occurrences = [];
    var parts = originalDateKey.split("-").map(Number);
    var originalDate = new Date(parts[0], parts[1] - 1, parts[2]);
    var daysInMonth = new Date(year, month + 1, 0).getDate();

    for (var d = 1; d <= daysInMonth; d++) {
      var cur = new Date(year, month, d);
      if (cur < originalDate) continue; // 繰り返しは元の日付以降にのみ発生する
      var dateKey = window.App.formatDate(year, month, d);
      if (dateKey === originalDateKey) continue; // 元の日付はメイン描画で表示済み

      var match = false;
      if (repeatType === "daily") {
        match = true;
      } else if (repeatType === "weekly") {
        var diffDays = Math.round((cur - originalDate) / 86400000);
        match = (diffDays % 7 === 0);
      } else if (repeatType === "monthly") {
        match = (cur.getDate() === originalDate.getDate());
      }
      if (match) occurrences.push(dateKey);
    }
    return occurrences;
  }

  // 繰り返し予定のチップをセルに追加する（+N件ラベルもできる範囲で調整）
  function appendRepeatChip(cell, dateKey, originalDateKey, evt) {
    var hidePast = getHidePastPref();
    var isPast = window.App.isEventPast(dateKey, evt.endH, evt.endM);
    if (hidePast && isPast) return;

    var existingChips = cell.querySelectorAll(".event-chip").length;
    var moreLabel = cell.querySelector(".more-label");

    // 1つのセルに表示するチップは最大3つまで（メイン描画と同じルール）
    if (existingChips >= 3) {
      if (moreLabel) {
        var current = parseInt(moreLabel.textContent.replace(/[^0-9]/g, ""), 10) || 0;
        moreLabel.textContent = "+" + (current + 1) + "件";
      } else {
        moreLabel = document.createElement("span");
        moreLabel.className = "more-label";
        moreLabel.textContent = "+1件";
        cell.appendChild(moreLabel);
      }
      return;
    }

    var chip = document.createElement("div");
    chip.className = "event-chip" + (isPast ? " past" : "");
    chip.style.background = evt.color;
    chip.textContent = "🔁" + (evt.icon ? evt.icon : "") + " " + evt.title;
    chip.title = "繰り返し予定（元の日付: " + originalDateKey + "）";
    chip.onclick = function(ev) {
      ev.stopPropagation();
      if (window.App.openModal) window.App.openModal(originalDateKey, evt);
    };

    if (moreLabel) {
      cell.insertBefore(chip, moreLabel);
    } else {
      cell.appendChild(chip);
    }
  }

  window.App.onCalendarRender.push(function() {
    var year = window.App.currentYear;
    var month = window.App.currentMonth;

    Object.keys(window.App.events).forEach(function(originalDateKey) {
      window.App.events[originalDateKey].forEach(function(evt) {
        if (!evt.repeat || evt.repeat === "none") return;
        var occurrences = generateRepeatOccurrences(originalDateKey, evt.repeat, year, month);
        occurrences.forEach(function(dateKey) {
          var cell = document.querySelector('.day-cell[data-date="' + dateKey + '"]');
          if (!cell) return;
          appendRepeatChip(cell, dateKey, originalDateKey, evt);
        });
      });
    });
  });

  // ============================================================
  // 終わった予定を自動的に非表示にする（カレンダー側）
  // ============================================================
  // 上の繰り返し展開フックより後に登録することで、繰り返しチップも対象に含める
  window.App.onCalendarRender.push(function() {
    if (!getHidePastPref()) return;
    document.querySelectorAll("#cal-grid .event-chip.past").forEach(function(chip) {
      chip.style.display = "none";
    });
  });

  // ============================================================
  // 初期化
  // ============================================================
  window.App.onReady.push(function() {
    console.log("機能A: 初期化完了（検索・一覧・タグ・アイコン・繰り返し・終了予定の非表示）");
  });

})();
