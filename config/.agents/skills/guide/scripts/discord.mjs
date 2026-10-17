// Discord REST アダプタ。Gateway は使わず、毎周 REST でリアクションを読む。依存は Node 標準の fetch だけ。
// 受け付けるのは開発者本人のユーザー ID の ✅ / ❌ だけ。チャンネルは repo 名と同じ名前を毎回探し、対応表は持たない。
const BASE = "https://discord.com/api/v10";
const TEXT_CHANNEL = 0;
const PUBLIC_THREAD = 11;
const MAX_CONTENT = 2000;
const EMOJIS = ["✅", "❌"];

// 429（レート制限）は、応答の retry_after（秒。無ければ Retry-After ヘッダ）だけ待ってやり直す。続けば RATE_LIMIT_RETRIES 回で諦める。
const RATE_LIMIT_RETRIES = 3;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function retryAfterMs(res) {
  const body = await res.json().catch(() => ({}));
  const seconds = Number(body.retry_after ?? res.headers.get("retry-after") ?? 1);
  return Math.ceil((Number.isFinite(seconds) ? seconds : 1) * 1000);
}

export function createDiscord({ token, guildId, userId, fetch = globalThis.fetch, warn = console.error, sleep = wait }) {
  async function call(method, path, body) {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${BASE}${path}`, {
        method,
        headers: { Authorization: `Bot ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (res.status === 429 && attempt < RATE_LIMIT_RETRIES) {
        await sleep(await retryAfterMs(res));
        continue;
      }
      if (!res.ok) throw new Error(`Discord ${method} ${path.split("?")[0]} が ${res.status}`);
      return res.status === 204 ? undefined : res.json();
    }
  }

  return {
    async ensureChannel(name) {
      const channels = await call("GET", `/guilds/${guildId}/channels`);
      const found = channels.find((c) => c.type === TEXT_CHANNEL && c.name === name);
      if (found) return found.id;
      return (await call("POST", `/guilds/${guildId}/channels`, { name, type: TEXT_CHANNEL })).id;
    },

    async sendApprovalRequest({ channelId, spec, title, url }) {
      const thread = await call("POST", `/channels/${channelId}/threads`, {
        name: `#${spec} ${title}`.slice(0, 100),
        type: PUBLIC_THREAD,
        auto_archive_duration: 10080,
      });
      const message = await call("POST", `/channels/${thread.id}/messages`, {
        content: `仕様 #${spec}: ${title}\n${url}\n承認は ✅、差し戻しは ❌ を押してください。`,
        allowed_mentions: { parse: [] },
      });
      // 押すだけで済むよう Bot が ✅ / ❌ を先に付けておく。判定は本人の分だけを見るので、Bot の分は数えない。
      // 送信は済んでいるので、付け損ねても例外にしない（本人が手で付ければ同じに動く）。黙って失敗しないよう 1 行残す。
      for (const emoji of EMOJIS) {
        await call("PUT", `/channels/${thread.id}/messages/${message.id}/reactions/${encodeURIComponent(emoji)}/@me`).catch((e) =>
          warn(`仕様 #${spec} の承認依頼に ${emoji} を先付けできなかった: ${e.message}`),
        );
      }
      return { threadId: thread.id, messageId: message.id };
    },

    // map ごとの公開スレッドを立てる。最初のメッセージは送らない（スレッドの ID を印に残すだけ）。
    async createMapThread({ channelId, map, title }) {
      const thread = await call("POST", `/channels/${channelId}/threads`, {
        name: `#${map} ${title}`.slice(0, 100),
        type: PUBLIC_THREAD,
        auto_archive_duration: 10080,
      });
      return { threadId: thread.id };
    },

    // frontier の prototype ticket（人が見る ticket）を map のスレッドに知らせる。
    async sendHumanTicket({ threadId, map, ticket, title, url }) {
      await call("POST", `/channels/${threadId}/messages`, {
        content: `人が見る ticket: map #${map} の #${ticket} ${title}\n${url}`,
        allowed_mentions: { parse: [] },
      });
    },

    // grilling・task の仮決め 1 件を map のスレッドに流す。ID は差し戻しの受け付けに使うので返す。
    // 2000 文字の上限で切れるのは問い・答え・理由・根拠だけにする（題名・リンク・番号を必ず残す）。
    async sendProvisionalDecision({ threadId, map, ticket, title, url, question, answer, reason, evidence }) {
      const head = `仮決め: map #${map} の #${ticket} ${title}\n${url}\n差し戻すときは ❌ を押してください。\n`;
      const labels = ["判断: ", "\n→ ", "\n理由: ", "\n根拠: "];
      const room = Math.max(0, MAX_CONTENT - head.length - labels.reduce((n, l) => n + l.length, 0));
      const values = [question, answer, reason, evidence];
      // 短い項目から順に、残りを均等に割り当てる（長い項目だけが切られる）。
      const shown = [];
      let left = room;
      [...values.keys()]
        .sort((a, b) => values[a].length - values[b].length)
        .forEach((i, k, order) => {
          const max = Math.floor(left / (order.length - k));
          const v = values[i];
          shown[i] = v.length > max ? `${v.slice(0, Math.max(0, max - 1))}…` : v;
          left -= shown[i].length;
        });
      const message = await call("POST", `/channels/${threadId}/messages`, {
        content: `${head}${labels.map((l, i) => `${l}${shown[i]}`).join("")}`,
        allowed_mentions: { parse: [] },
      });
      // 押すだけで済むよう Bot が ❌ を先に付けておく（判定は本人の分だけを見る）。送信は済んでいるので、付け損ねても例外にせず 1 行残す。
      await call("PUT", `/channels/${threadId}/messages/${message.id}/reactions/${encodeURIComponent("❌")}/@me`).catch((e) =>
        warn(`map #${map} の #${ticket} の仮決めに ❌ を先付けできなかった: ${e.message}`),
      );
      return { messageId: message.id };
    },

    // 承認依頼のスレッド（map があれば map のスレッド）に判断依頼を送る。新しいスレッドは作らず、リアクションも付けない（回答は GitHub のラベルかコメントで書き戻す）。
    async sendDecisionRequest({ threadId, spec, map, issue, title, url, reason, reports, step, tab, tail, question }) {
      const head = `判断依頼: ${map === undefined ? `仕様 #${spec}` : `map #${map}`} の #${issue} ${title ?? ""} が止まった\n${url}\n${tab === undefined ? "" : `工程: ${step} / タブ: ${tab}\n`}`;
      const reportLine = reports === undefined ? "" : `\ntakt のレポート: ${reports}`;
      // 問い（grilling の判断依頼）があれば、本人が返信で答えられるよう案内を添える。特権インテントを使わない Bot は、メンションの無い返信の本文を受け取れないので、条件も伝える。
      const replyGuide = question === undefined ? "" : "\nこのメッセージに返信で答えてください（本人の返信を ticket に書き戻して、止まったタブへ流し込みます）。返信のメンション（@）をオンのまま返信するか、Bot をメンションしてください。メンションの無い返信は読めません。";
      const questionLabel = question === undefined ? "" : "問い:\n\n"; // 問いの後ろの改行を含める
      // 2000 文字の上限で切れるのは問い・理由・画面だけにする（工程・仕様・タブ・URL・レポートの場所を必ず残す）。
      const room = Math.max(0, MAX_CONTENT - head.length - reportLine.length - replyGuide.length - questionLabel.length - "理由: ".length);
      const clip = (text, max) => (text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text);
      const shownQuestion = question === undefined ? "" : clip(question, Math.floor(room / 2));
      const afterQuestion = room - shownQuestion.length;
      const shownReason = clip(reason, tail === undefined ? afterQuestion : Math.floor(afterQuestion / 2));
      let screen = "";
      if (tail !== undefined && tail.length > 0) {
        const fence = "```";
        const frame = `\n画面の最後の行:\n${fence}\n\n${fence}`;
        const left = room - shownQuestion.length - shownReason.length - frame.length;
        // 画面の中に ``` が出てもコードブロックが崩れないよう、画面の中の ``` は ˋˋˋ に置き換える。
        if (left > 0) screen = `\n画面の最後の行:\n${fence}\n${clip(tail.join("\n").replaceAll(fence, "ˋˋˋ"), left)}\n${fence}`;
      }
      const message = await call("POST", `/channels/${threadId}/messages`, {
        content: `${head}${question === undefined ? "" : `${questionLabel.slice(0, -1)}${shownQuestion}\n`}理由: ${shownReason}${screen}${reportLine}${replyGuide}`,
        allowed_mentions: { parse: [] },
      });
      return { messageId: message.id };
    },

    // 判断依頼のメッセージへの返信（message_reference が一致するもの）を、ID の昇順で { userId, content } にして返す。誰の返信かは呼び出し側が判定する。
    async readReplies({ threadId, messageId }) {
      // after は 1 回に最大 100 件なので、100 件返る間は最後の ID から続きを読む（共有スレッドで他の書き込みが多くても返信を見落とさない）。
      const newer = (a, b) => (BigInt(a) > BigInt(b) ? 1 : BigInt(a) < BigInt(b) ? -1 : 0);
      const replies = [];
      let cursor = messageId;
      for (;;) {
        const page = await call("GET", `/channels/${threadId}/messages?after=${cursor}&limit=100`);
        replies.push(...page.filter((m) => m.message_reference?.message_id === messageId));
        if (page.length < 100) break;
        cursor = page.map((m) => m.id).sort(newer).at(-1);
      }
      return replies.sort((x, y) => newer(x.id, y.id)).map((m) => ({ userId: m.author.id, content: m.content }));
    },

    // ✅ / ❌ のリアクションのうち本人の分だけを返す。
    async readReactions({ threadId, messageId }) {
      const reactions = [];
      for (const emoji of EMOJIS) {
        const users = await call("GET", `/channels/${threadId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}?limit=100`);
        if (users.some((u) => u.id === userId)) reactions.push({ emoji, userId });
      }
      return reactions;
    },
  };
}
