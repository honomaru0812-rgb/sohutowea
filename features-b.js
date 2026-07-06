/* ============================================================
   features-b.js — 機能担当B 用
   ============================================================
   【担当する機能】
   ・リマインド（通知）機能
   ・AI機能（予定の提案、自然言語入力など）
   ・音声入力
   ・画像認識（画像から予定を読み取る）
   ・他アプリとの連携（Googleカレンダーなど）
   
   【ルール】
   ・window.App を通じてデータにアクセスする
   ・HTMLの id="xxx" を使って要素を取得する
   ・新しいHTMLが必要な場合は、JavaScriptで動的に追加する
   ・styles.css のクラス名を使う（新しいクラスが必要ならデザイン担当に依頼）
   ============================================================ */

(function() {
  // ============================================================
  // リマインド（通知）機能
  // ============================================================

  // ブラウザの通知許可を求める
  function requestNotificationPermission() {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }

  // 通知を送る
  function sendNotification(title, body) {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(title, { body: body, icon: "📅" });
    }
  }

  // リマインダーをチェック（1分ごとに実行）
  function checkReminders() {
    var now = new Date();
    var todayKey = window.App.formatDate(now.getFullYear(), now.getMonth(), now.getDate());
    var todayEvents = window.App.events[todayKey] || [];

    todayEvents.forEach(function(evt) {
      if (evt.reminder === "none" || evt._notified) return;

      var reminderMin = parseInt(evt.reminder);
      if (isNaN(reminderMin)) return;

      // 予定の開始時刻
      var eventTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), evt.startH, evt.startM);
      var diff = (eventTime - now) / 1000 / 60; // 分単位の差

      // リマインダー時刻になったら通知
      if (diff > 0 && diff <= reminderMin) {
        sendNotification(
          "📅 " + evt.title,
          reminderMin + "分後に「" + evt.title + "」が始まります"
        );
        evt._notified = true; // 重複通知を防ぐ
      }
    });
  }

  // 1分ごとにチェック
  setInterval(checkReminders, 60000);

  // ============================================================
  // 音声入力
  // ============================================================
  var micBtn = document.getElementById("mic-btn");
  var eventTitleInput = document.getElementById("event-title");

  if (micBtn && eventTitleInput) {
    // ブラウザが音声認識に対応しているか確認
    var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (SpeechRecognition) {
      var recognition = new SpeechRecognition();
      recognition.lang = "ja-JP";    // 日本語
      recognition.continuous = false; // 1回だけ認識
      var isRecording = false;

      micBtn.onclick = function() {
        if (isRecording) {
          recognition.stop();
          return;
        }
        recognition.start();
        isRecording = true;
        micBtn.classList.add("recording");
        micBtn.textContent = "⏹️";
      };

      recognition.onresult = function(e) {
        var text = e.results[0][0].transcript;
        eventTitleInput.value = text;
      };

      recognition.onend = function() {
        isRecording = false;
        micBtn.classList.remove("recording");
        micBtn.textContent = "🎤";
      };

      recognition.onerror = function(e) {
        console.error("音声認識エラー:", e.error);
        isRecording = false;
        micBtn.classList.remove("recording");
        micBtn.textContent = "🎤";
      };
    } else {
      // 音声認識に非対応のブラウザ
      micBtn.style.display = "none";
      console.log("このブラウザは音声入力に対応していません");
    }
  }

  // ============================================================
  // 画像認識（画像から予定を読み取る）
  // ============================================================
  var eventImage = document.getElementById("event-image");
  var imageResult = document.getElementById("image-result");

  if (eventImage && imageResult) {
    eventImage.onchange = function() {
      var file = this.files[0];
      if (!file) return;

      imageResult.textContent = "画像を分析中...";

      // 画像をBase64に変換
      var reader = new FileReader();
      reader.onload = function() {
        var base64 = reader.result.split(",")[1];

        // TODO: ここにAI APIを接続して画像を分析する
        // 例：Anthropic Claude API を使う場合
        //
        // fetch("https://api.anthropic.com/v1/messages", {
        //   method: "POST",
        //   headers: { "Content-Type": "application/json" },
        //   body: JSON.stringify({
        //     model: "claude-sonnet-4-6",
        //     max_tokens: 500,
        //     messages: [{
        //       role: "user",
        //       content: [
        //         { type: "image", source: { type: "base64", media_type: file.type, data: base64 } },
        //         { type: "text", text: "この画像に書かれている予定やイベント情報を読み取ってください。タイトル、日時があれば教えてください。" }
        //       ]
        //     }]
        //   })
        // })
        // .then(function(res) { return res.json(); })
        // .then(function(data) {
        //   var text = data.content[0].text;
        //   imageResult.textContent = "AI分析結果: " + text;
        //   // タイトル欄に自動入力
        //   // eventTitleInput.value = 抽出したタイトル;
        // });

        // ダミー表示（AI接続前）
        imageResult.textContent = "画像を検出しました。AI APIを接続すると自動で予定を読み取れます。";
      };
      reader.readAsDataURL(file);
    };
  }

  // ============================================================
  // AI機能（自然言語で予定を追加）
  // ============================================================
  // TODO: 「明日の3時にミーティング」のような自然言語入力から
  //       日付・時間・タイトルを自動解析する機能を実装する
  //
  // ヒント：
  // - タイトル入力欄の下に「AIで解析」ボタンを追加
  // - ボタンを押したら入力テキストをAI APIに送信
  // - 返ってきた日付・時間をフォームに自動入力
  //
  // 例：
  // function parseNaturalLanguage(text) {
  //   return fetch("https://api.anthropic.com/v1/messages", {
  //     method: "POST",
  //     headers: { "Content-Type": "application/json" },
  //     body: JSON.stringify({
  //       model: "claude-sonnet-4-6",
  //       max_tokens: 300,
  //       messages: [{
  //         role: "user",
  //         content: "以下のテキストから予定情報を抽出してJSON形式で返してください: " + text
  //       }]
  //     })
  //   });
  // }

  // ============================================================
  // 他アプリとの連携
  // ============================================================
  // TODO: Googleカレンダー等との連携を実装する
  //
  // 方法1: .ics ファイルのエクスポート
  //   → 予定を .ics 形式に変換してダウンロードさせる
  //   → GoogleカレンダーやAppleカレンダーに取り込める
  //
  // 方法2: Google Calendar API
  //   → OAuth認証が必要で複雑なので、まずは方法1がおすすめ
  //
  // .ics エクスポートの例：
  // function exportToICS(event, dateKey) {
  //   var parts = dateKey.split("-");
  //   var start = parts.join("") + "T" + String(event.startH).padStart(2,"0") + String(event.startM).padStart(2,"0") + "00";
  //   var end = parts.join("") + "T" + String(event.endH).padStart(2,"0") + String(event.endM).padStart(2,"0") + "00";
  //   var ics = "BEGIN:VCALENDAR\nBEGIN:VEVENT\n" +
  //     "DTSTART:" + start + "\nDTEND:" + end + "\n" +
  //     "SUMMARY:" + event.title + "\nEND:VEVENT\nEND:VCALENDAR";
  //   var blob = new Blob([ics], { type: "text/calendar" });
  //   var url = URL.createObjectURL(blob);
  //   var a = document.createElement("a");
  //   a.href = url; a.download = event.title + ".ics"; a.click();
  // }

  // ============================================================
  // 初期化
  // ============================================================
  window.App.onReady.push(function() {
    requestNotificationPermission();
    console.log("機能B: 初期化完了（通知・音声入力・画像認識・AI）");
  });

})();
