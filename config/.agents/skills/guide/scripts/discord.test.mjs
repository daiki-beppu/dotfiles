// discord.mjs のテスト。fetch は偽物を注入し、本物の Discord・ネットワークは呼ばない。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createDiscord } from "./discord.mjs";

const TOKEN = "SECRET-TOKEN-xyz";
const GUILD = "G1";
const OWNER = "U-owner";
const BASE = "https://discord.com/api/v10";
const CHECK = encodeURIComponent("✅");
const CROSS = encodeURIComponent("❌");

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// routes: "METHOD /path" → 応答（関数なら (body) を受ける）。未登録の呼び出しは例外にして、想定外の API 利用に気付く。
const fakeApi = (routes) => {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const method = init.method ?? "GET";
    const headers = new Headers(init.headers);
    const body = init.body === undefined ? undefined : JSON.parse(init.body);
    calls.push({ method, url: String(url), path: u.pathname, search: u.search, headers, body });
    const route = routes[`${method} ${u.pathname}`];
    if (route === undefined) throw new Error(`想定外の呼び出し: ${method} ${u.pathname}`);
    return typeof route === "function" ? route(body) : route;
  };
  return { calls, fetch };
};
const adapter = (routes) => {
  const api = fakeApi(routes);
  return { ...api, discord: createDiscord({ token: TOKEN, guildId: GUILD, userId: OWNER, fetch: api.fetch }) };
};

// ---- チャンネル ----

test("チャンネル: 同じ名前のテキストチャンネルがあれば作らず、その id を返す", async () => {
  const { calls, discord } = adapter({
    "GET /api/v10/guilds/G1/channels": json([{ id: "c0", name: "other", type: 0 }, { id: "c1", name: "live-mindmap", type: 0 }]),
  });
  assert.equal(await discord.ensureChannel("live-mindmap"), "c1");
  assert.ok(calls.every((c) => c.method === "GET"));
});

test("チャンネル: 同じ名前でもテキスト以外（音声・カテゴリ）は使わず、{ name, type: 0 } で 1 回作る", async () => {
  const { calls, discord } = adapter({
    "GET /api/v10/guilds/G1/channels": json([{ id: "v1", name: "live-mindmap", type: 2 }, { id: "k1", name: "live-mindmap", type: 4 }]),
    "POST /api/v10/guilds/G1/channels": json({ id: "new1", name: "live-mindmap", type: 0 }),
  });
  assert.equal(await discord.ensureChannel("live-mindmap"), "new1");
  const posts = calls.filter((c) => c.method === "POST");
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0].body, { name: "live-mindmap", type: 0 });
});

test("チャンネル: 名前が違うチャンネルしか無ければ作る", async () => {
  const { calls, discord } = adapter({
    "GET /api/v10/guilds/G1/channels": json([{ id: "c0", name: "other", type: 0 }]),
    "POST /api/v10/guilds/G1/channels": json({ id: "new2", name: "live-mindmap", type: 0 }),
  });
  assert.equal(await discord.ensureChannel("live-mindmap"), "new2");
  assert.equal(calls.filter((c) => c.method === "POST").length, 1);
});

test("チャンネル: 呼ぶたびに Discord から探し直し、前回の結果を覚えない", async () => {
  let listed = 0;
  const { discord } = adapter({
    "GET /api/v10/guilds/G1/channels": () => { listed += 1; return json([{ id: "c1", name: "live-mindmap", type: 0 }]); },
  });
  await discord.ensureChannel("live-mindmap");
  await discord.ensureChannel("live-mindmap");
  assert.equal(listed, 2);
});

// ---- スレッドと承認依頼 ----

const noContent = () => new Response(null, { status: 204 });
const sendRoutes = () => ({
  "POST /api/v10/channels/c1/threads": json({ id: "T1" }),
  "POST /api/v10/channels/T1/messages": json({ id: "M1" }),
  [`PUT /api/v10/channels/T1/messages/M1/reactions/${CHECK}/@me`]: noContent(),
  [`PUT /api/v10/channels/T1/messages/M1/reactions/${CROSS}/@me`]: noContent(),
});
const issueUrl = "https://github.com/o/live-mindmap/issues/12";

test("承認依頼: スレッド（公開, type 11）を立て、その中に題名と issue へのリンクを送り、ID を返す", async () => {
  const { calls, discord } = adapter(sendRoutes());
  const result = await discord.sendApprovalRequest({ channelId: "c1", spec: 12, title: "仕様A", url: issueUrl });
  assert.deepEqual(result, { threadId: "T1", messageId: "M1" });
  assert.deepEqual(calls.slice(0, 2).map((c) => `${c.method} ${c.path}`), ["POST /api/v10/channels/c1/threads", "POST /api/v10/channels/T1/messages"]);
  assert.equal(calls[0].body.type, 11);
  assert.ok(calls[0].body.name.length > 0 && calls[0].body.name.length <= 100);
  assert.ok(calls[1].body.content.includes("仕様A"));
  assert.ok(calls[1].body.content.includes(issueUrl));
});

test("承認依頼: 題名が長くてもスレッド名は 100 文字以内", async () => {
  const { calls, discord } = adapter(sendRoutes());
  await discord.sendApprovalRequest({ channelId: "c1", spec: 12, title: "長".repeat(300), url: issueUrl });
  assert.ok(calls[0].body.name.length <= 100);
});

test("承認依頼: 題名の @everyone でメンション通知が飛ばない（allowed_mentions で何も許可しない）", async () => {
  const { calls, discord } = adapter(sendRoutes());
  await discord.sendApprovalRequest({ channelId: "c1", spec: 12, title: "@everyone 仕様", url: issueUrl });
  assert.deepEqual(calls[1].body.allowed_mentions, { parse: [] });
});

test("承認依頼: 書き込みの body は JSON で、Content-Type を付ける", async () => {
  const { calls, discord } = adapter(sendRoutes());
  await discord.sendApprovalRequest({ channelId: "c1", spec: 12, title: "仕様A", url: issueUrl });
  for (const c of calls.filter((c) => c.body !== undefined)) assert.match(c.headers.get("content-type"), /application\/json/);
});

test("承認依頼: 送ったメッセージに Bot が ✅・❌ の順でリアクションを先に付ける", async () => {
  const { calls, discord } = adapter(sendRoutes());
  await discord.sendApprovalRequest({ channelId: "c1", spec: 12, title: "仕様A", url: issueUrl });
  assert.deepEqual(calls.slice(2).map((c) => `${c.method} ${c.path}`), [
    `PUT /api/v10/channels/T1/messages/M1/reactions/${CHECK}/@me`,
    `PUT /api/v10/channels/T1/messages/M1/reactions/${CROSS}/@me`,
  ]);
});

test("承認依頼: 先付けのリアクションが失敗しても ID を返し、失敗を warn に 1 行残す（トークンは含めない）", async () => {
  const api = fakeApi({
    ...sendRoutes(),
    [`PUT /api/v10/channels/T1/messages/M1/reactions/${CHECK}/@me`]: json({ message: "Missing Permissions" }, 403),
  });
  const warned = [];
  const discord = createDiscord({ token: TOKEN, guildId: GUILD, userId: OWNER, fetch: api.fetch, warn: (s) => warned.push(s) });
  const result = await discord.sendApprovalRequest({ channelId: "c1", spec: 12, title: "仕様A", url: issueUrl });
  assert.deepEqual(result, { threadId: "T1", messageId: "M1" });
  assert.equal(warned.length, 1);
  assert.match(warned[0], /#12/);
  assert.match(warned[0], /403/);
  assert.ok(!warned[0].includes(TOKEN));
});

test("リアクション: Bot が先に付けた ✅・❌ は本人の操作として数えない", async () => {
  const { discord } = adapter(reactionRoutes(["BOT"], ["BOT"]));
  assert.deepEqual(await discord.readReactions({ threadId: "T1", messageId: "M1" }), []);
});

// ---- リアクション: 本人だけ、✅ / ❌ の語彙だけ ----

const reactionRoutes = (checkUsers, crossUsers) => ({
  [`GET /api/v10/channels/T1/messages/M1/reactions/${CHECK}`]: json(checkUsers.map((id) => ({ id }))),
  [`GET /api/v10/channels/T1/messages/M1/reactions/${CROSS}`]: json(crossUsers.map((id) => ({ id }))),
});
const sortByEmoji = (list) => [...list].sort((a, b) => a.emoji.localeCompare(b.emoji));

test("リアクション: 本人の ✅ だけを返し、他人の ✅ は返さない", async () => {
  const { discord } = adapter(reactionRoutes([OWNER, "U-other"], ["U-other"]));
  assert.deepEqual(await discord.readReactions({ threadId: "T1", messageId: "M1" }), [{ emoji: "✅", userId: OWNER }]);
});

test("リアクション: 本人以外しか付けていなければ空を返す", async () => {
  const { discord } = adapter(reactionRoutes(["U-other"], ["U-other2"]));
  assert.deepEqual(await discord.readReactions({ threadId: "T1", messageId: "M1" }), []);
});

test("リアクション: 本人の ✅ と ❌ が両方あれば両方を { emoji, userId } で返す", async () => {
  const { discord } = adapter(reactionRoutes([OWNER], [OWNER, "U-other"]));
  const got = await discord.readReactions({ threadId: "T1", messageId: "M1" });
  assert.deepEqual(sortByEmoji(got), sortByEmoji([{ emoji: "✅", userId: OWNER }, { emoji: "❌", userId: OWNER }]));
});

test("語彙: ✅ と ❌ のリアクション取得だけを呼び、メッセージの本文や他の絵文字は読まない", async () => {
  const { calls, discord } = adapter(reactionRoutes([OWNER], []));
  await discord.readReactions({ threadId: "T1", messageId: "M1" });
  assert.deepEqual(
    calls.map((c) => `${c.method} ${c.path}`).sort(),
    [`GET /api/v10/channels/T1/messages/M1/reactions/${CHECK}`, `GET /api/v10/channels/T1/messages/M1/reactions/${CROSS}`].sort(),
  );
  for (const c of calls) assert.match(c.search, /limit=100/);
});

test("リアクション: 取得が 404 なら例外にする（空として握りつぶさない）", async () => {
  const { discord } = adapter({
    [`GET /api/v10/channels/T1/messages/M1/reactions/${CHECK}`]: json({ message: "Unknown Message" }, 404),
    [`GET /api/v10/channels/T1/messages/M1/reactions/${CROSS}`]: json({ message: "Unknown Message" }, 404),
  });
  await assert.rejects(discord.readReactions({ threadId: "T1", messageId: "M1" }), /404/);
});

// ---- 認証とトークンの扱い ----

test("認証: すべての呼び出しが Discord REST の v10 に Authorization: Bot <token> で届き、URL にトークンを載せない", async () => {
  const { calls, discord } = adapter({
    "GET /api/v10/guilds/G1/channels": json([{ id: "c1", name: "live-mindmap", type: 0 }]),
    ...sendRoutes(),
    ...reactionRoutes([], []),
  });
  await discord.ensureChannel("live-mindmap");
  await discord.sendApprovalRequest({ channelId: "c1", spec: 12, title: "仕様A", url: issueUrl });
  await discord.readReactions({ threadId: "T1", messageId: "M1" });
  assert.ok(calls.length >= 5);
  for (const c of calls) {
    assert.ok(c.url.startsWith(`${BASE}/`), c.url);
    assert.equal(c.headers.get("authorization"), `Bot ${TOKEN}`);
    assert.ok(!c.url.includes(TOKEN));
  }
});

test("エラー: 2xx 以外は例外にし、message に status を含め、トークンは含めない", async () => {
  const { discord } = adapter({ "GET /api/v10/guilds/G1/channels": json({ message: "Missing Access" }, 403) });
  await assert.rejects(discord.ensureChannel("live-mindmap"), (e) => {
    assert.match(e.message, /403/);
    assert.ok(!e.message.includes(TOKEN));
    assert.ok(!/authorization/i.test(e.message));
    return true;
  });
});

// ---- 依存なし・REST だけ ----

test("依存なし: import は node:* と同じディレクトリのモジュールだけで、Gateway（WebSocket）を使わない", () => {
  const src = readFileSync(new URL("./discord.mjs", import.meta.url), "utf8");
  const specs = [...src.matchAll(/(?:from|import\()\s*["']([^"']+)["']/g)].map((m) => m[1]);
  for (const s of specs) assert.ok(s.startsWith("node:") || s.startsWith("./"), `外部パッケージの import: ${s}`);
  assert.ok(!/WebSocket|gateway/i.test(src.replace(/\/\/.*$/gm, "")));
});

// ---- 判断依頼（既存スレッドへ送る） ----

test("判断依頼: 新しいスレッドは作らず、承認依頼のスレッドに送り、止まった issue・理由・レポートの場所を本文に含める", async () => {
  const { calls, discord } = adapter({ "POST /api/v10/channels/T1/messages": json({ id: "M2" }) });
  await discord.sendDecisionRequest({
    threadId: "T1", spec: 12, issue: 21, title: "実装A", url: "https://github.com/o/live-mindmap/issues/21",
    reason: "takt の run が ABORT で終わった（step: implement）: blocked", reports: "/w/21/.takt/runs",
  });
  assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), ["POST /api/v10/channels/T1/messages"]);
  const content = calls[0].body.content;
  for (const part of ["#12", "#21", "実装A", "https://github.com/o/live-mindmap/issues/21", "ABORT", "blocked", "/w/21/.takt/runs"]) {
    assert.ok(content.includes(part), `本文に ${part} が無い: ${content}`);
  }
  assert.ok(content.length <= 2000);
});

test("判断依頼: 題名の @everyone でメンション通知が飛ばない", async () => {
  const { calls, discord } = adapter({ "POST /api/v10/channels/T1/messages": json({ id: "M2" }) });
  await discord.sendDecisionRequest({ threadId: "T1", spec: 12, issue: 21, title: "@everyone", url: "u", reason: "r", reports: "p" });
  assert.deepEqual(calls[0].body.allowed_mentions, { parse: [] });
});

test("判断依頼: 送信が失敗したら例外にする", async () => {
  const { discord } = adapter({ "POST /api/v10/channels/T1/messages": json({ message: "x" }, 403) });
  await assert.rejects(discord.sendDecisionRequest({ threadId: "T1", spec: 12, issue: 21, title: "t", url: "u", reason: "r", reports: "p" }), /403/);
});

test("判断依頼: 理由が長くても 2000 文字以内に収め、止まった issue とレポートの場所は切り落とさない", async () => {
  const { calls, discord } = adapter({ "POST /api/v10/channels/T1/messages": json({ id: "M2" }) });
  await discord.sendDecisionRequest({
    threadId: "T1", spec: 12, issue: 21, title: "実装A", url: "https://github.com/o/r/issues/21",
    reason: `ABORT ${"x".repeat(5000)}`, reports: "/w/21/.takt/runs",
  });
  const content = calls[0].body.content;
  assert.ok(content.length <= 2000);
  assert.ok(content.includes("#21") && content.includes("実装A") && content.includes("https://github.com/o/r/issues/21"));
  assert.ok(content.endsWith("takt のレポート: /w/21/.takt/runs"));
  assert.ok(content.includes("ABORT"));
});
