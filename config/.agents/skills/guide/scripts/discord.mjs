// Discord REST アダプタ。Gateway は使わず、毎周 REST でリアクションを読む。依存は Node 標準の fetch だけ。
// 受け付けるのは開発者本人のユーザー ID の ✅ / ❌ だけ。チャンネルは repo 名と同じ名前を毎回探し、対応表は持たない。
const BASE = "https://discord.com/api/v10";
const TEXT_CHANNEL = 0;
const PUBLIC_THREAD = 11;
const MAX_CONTENT = 2000;
const EMOJIS = ["✅", "❌"];

export function createDiscord({ token, guildId, userId, fetch = globalThis.fetch, warn = console.error }) {
  async function call(method, path, body) {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { Authorization: `Bot ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Discord ${method} ${path.split("?")[0]} が ${res.status}`);
    return res.status === 204 ? undefined : res.json();
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

    // 承認依頼のスレッドに判断依頼を送る。新しいスレッドは作らず、リアクションも付けない（回答は GitHub のラベルかコメントで書き戻す）。
    async sendDecisionRequest({ threadId, spec, issue, title, url, reason, reports }) {
      const head = `判断依頼: 仕様 #${spec} の #${issue} ${title ?? ""} が止まった\n${url}\n`;
      const tail = `\ntakt のレポート: ${reports}`;
      // 2000 文字の上限で切れるのは理由だけにする（レポートの場所を必ず残す）。
      const room = Math.max(0, MAX_CONTENT - head.length - tail.length - "理由: ".length);
      const shown = reason.length > room ? `${reason.slice(0, Math.max(0, room - 1))}…` : reason;
      await call("POST", `/channels/${threadId}/messages`, {
        content: `${head}理由: ${shown}${tail}`,
        allowed_mentions: { parse: [] },
      });
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
