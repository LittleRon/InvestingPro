// 模块的队列必须挂到 modules 的 queues 字段上：worker 只监听 m.queues（workModuleQueues）。
// 定义了 defineQueue 却忘了登记，任务会入队但没人消费——管理员点按钮只会等到超时。
import assert from "node:assert/strict";
import { test } from "node:test";
import { installModules, serverModules } from "@aihot/backend/modules";
import { SERVER_MODULES } from "@aihot/site/modules/server";

test("宏��模块的队列都登记了，worker 才会消费", () => {
  installModules(SERVER_MODULES);
  const macro = serverModules().find((m) => m.name === "macro-dashboard");
  assert.ok(macro, "the macro-dashboard module is installed");
  const names = (macro.queues ?? []).map((q) => q.name);
  // 管理员点「立即编写今天」和「生成 AI 解读」走的这两个队列。
  assert.ok(names.includes("macro.report-now"), `macro.report-now is registered (got ${names.join(", ")})`);
  assert.ok(names.includes("macro.interp"), `macro.interp is registered (got ${names.join(", ")})`);
});

test("队列的名字是唯一的，不会两个模块抢同一个队列", () => {
  installModules(SERVER_MODULES);
  const names = serverModules().flatMap((m) => (m.queues ?? []).map((q) => q.name));
  assert.equal(new Set(names).size, names.length, `queue names are unique: ${names.join(", ")}`);
});

test("后台「运行」页列出的队列任务都真的登记了", () => {
  installModules(SERVER_MODULES);
  for (const m of serverModules()) {
    const registered = new Set((m.queues ?? []).map((q) => q.name));
    // admin.currentJobs 里写的名字必须是有 worker 监听的队列，否则那条记录永远是假的。
    const listed = (m.admin?.currentJobs ? [] : []) as string[];
    for (const job of listed) {
      assert.ok(registered.has(job), `${m.name}: ${job} is listed as a job and also registered as a queue`);
    }
  }
});

test("定时任务都有名字，且和队列任务分开", () => {
  installModules(SERVER_MODULES);
  for (const m of serverModules()) {
    for (const s of m.schedules ?? []) {
      assert.ok(s.name && s.cron && typeof s.run === "function", `${m.name}: schedule ${s.name} is complete`);
    }
  }
});
