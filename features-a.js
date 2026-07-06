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
  window.App.onModalOpen.push(function(dateKey, event) {
    var currentIcon = event ? (event.icon || "") : "";
    window.App.selectedIcon = currentIcon;
    renderIconPicker(currentIcon);
  });

  // ============================================================
  // 検索機能
  // ============================================================
  var searchInput = document.getElementById("search-input");

  if (searchInput) {
    searchInput.oninput = function() {
      var query = this.value.trim().toLowerCase();

      if (!query) {
        // 検索欄が空なら通常表示に戻す
        window.App.renderCalendar();
        return;
      }

      // TODO: カレンダー上でマッチした予定をハイライトする
      // TODO: 一覧表示に切り替えてフィルタ結果を表示する
      console.log("検索ワード:", query);

      // ヒント：window.App.events から検索して結果を表示
      // 例：
      // var results = [];
      // Object.keys(window.App.events).forEach(function(dateKey) {
      //   window.App.events[dateKey].forEach(function(evt) {
      //     if (evt.title.toLowerCase().includes(query) ||
      //         evt.tag.toLowerCase().includes(query)) {
      //       results.push({ dateKey: dateKey, event: evt });
      //     }
      //   });
      // });
    };
  }

  // ============================================================
  // 一覧表示 + ソート
  // ============================================================
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

    // 表示
    if (allEvents.length === 0) {
      listContainer.innerHTML = '<p style="text-align:center; color:#888; padding:40px;">予定がありません</p>';
      return;
    }

    allEvents.forEach(function(item) {
      var isPast = window.App.isEventPast(item.dateKey, item.event.endH, item.event.endM);
      var div = document.createElement("div");
      div.className = "event-list-item" + (isPast ? " past" : "");

      var startTime = String(item.event.startH).padStart(2, "0") + ":" + String(item.event.startM).padStart(2, "0");
      var endTime = String(item.event.endH).padStart(2, "0") + ":" + String(item.event.endM).padStart(2, "0");

      div.innerHTML =
        '<div class="event-list-icon">' + (item.event.icon || "📅") + '</div>' +
        '<div class="event-list-info">' +
        '  <div class="event-list-title">' + item.event.title + '</div>' +
        '  <div class="event-list-meta">' + item.dateKey + '　' + startTime + ' - ' + endTime + '</div>' +
        '</div>' +
        (item.event.tag ? '<span class="event-list-tag">' + item.event.tag + '</span>' : '');

      listContainer.appendChild(div);
    });
  }

  // ソート・フィルター変更時に再描画
  var sortSelect = document.getElementById("sort-select");
  if (sortSelect) sortSelect.onchange = renderList;
  var filterTag = document.getElementById("filter-tag");
  if (filterTag) filterTag.onchange = renderList;

  // グローバルに公開
  window.App.renderList = renderList;

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

  // データ読み込み後にタグフィルターを更新
  window.App.onEventsLoaded.push(updateTagFilter);
  window.App.onEventSave.push(function() { updateTagFilter(); });

  // ============================================================
  // 繰り返し予定の処理
  // ============================================================
  // TODO: 繰り返し予定（daily, weekly, monthly）を
  //       カレンダーに展開して表示する処理を実装する
  //
  // ヒント：
  // - window.App.onCalendarRender にフックを登録
  // - repeat が "none" 以外の予定を見つけたら、
  //   該当する日付にも予定を表示する
  //
  // 例：
  // window.App.onCalendarRender.push(function() {
  //   // 繰り返し予定の展開ロジック
  // });

  // ============================================================
  // 初期化
  // ============================================================
  window.App.onReady.push(function() {
    console.log("機能A: 初期化完了（検索・一覧・タグ・アイコン・繰り返し）");
  });

})();
