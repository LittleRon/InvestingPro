// 用真实的 Fastify 实例验证「立即编写今天」按钮的 400 根因与修复。
//
// 按钮原本带着 `content-type: application/json` 却不发 body。Fastify 的 JSON parser
// 把空 body 判为畸形请求，全局 error handler 回 400 + "The request could not be processed."，
// 页面看起来就是「点了没反应」。这里把两条路径都跑一遍，防止再退化。
import assert from "node:assert/strict";
import { after, test } from "node:test";
import Fastify from "fastify";

const app = Fastify();
app.post("/probe", async () => ({ ok: true }));
// 与 apps/api/src/app.ts 的 error handler 同类的处理：400 归为 invalid_request。
app.setErrorHandler((error, _req, reply) => {
  const status = (error as { statusCode?: number }).statusCode ?? 500;
  if (status === 400) return reply.code(400).send({ code: "invalid_request", detail: "The request could not be processed." });
  return reply.code(503).send({ detail: "temporarily_unavailable" });
});
const address = await app.listen({ port: 0, host: "127.0.0.1" });
after(() => app.close());

const csrf = { "x-csrf-token": "test-csrf" };

test("声明 JSON 却不带 body：确实回 400 + 那句报错（复现原故障）", async () => {
  const res = await fetch(`${address}/probe`, {
    method: "POST",
    headers: { "content-type": "application/json", ...csrf },
  });
  assert.equal(res.status, 400);
  const body = await res.json() as { detail: string };
  assert.equal(body.detail, "The request could not be processed.");
});

test("带 {} body 的 POST：正常 200（修复后的写法）", async () => {
  const res = await fetch(`${address}/probe`, {
    method: "POST",
    headers: { "content-type": "application/json", ...csrf },
    body: "{}",
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

test("不带 body 也不声明 JSON：DELETE 之类无参命令同样正常", async () => {
  const res = await fetch(`${address}/probe`, { method: "POST", headers: { ...csrf } });
  assert.equal(res.status, 200);
});
