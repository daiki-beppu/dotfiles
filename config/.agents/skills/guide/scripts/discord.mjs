// Discord REST アダプタ。Gateway は使わず、毎周 REST でリアクションを読む。依存は Node 標準の fetch だけ。
// 受け付けるのは開発者本人のユーザー ID の ✅ / ❌ だけ。チャンネルは repo 名と同じ名前を毎回探し、対応表は持たない。
const BASE = "https://discord.com/api/v10";
const TEXT_CHANNEL = 0;
const PUBLIC_THREAD = 11;
const EMOJIS = ["✅", "❌"];

export function createDiscord({ token, guildId, userId, fetch = globalThis.fetch }) {
  async function call(method, path, body) {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { Authorization: `Bot ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Discord ${method} ${path.split("?")[0]} が ${res.status}`);
    return res.json();
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
        content: `仕様 #${spec}: ${title}\n${url}\n承認は ✅、差し戻しは ❌ をこのメッセージに付けてください。`,
        allowed_mentions: { parse: [] },
      });
      return { threadId: thread.id, messageId: message.id };
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
