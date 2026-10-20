// 付费请求上限（不需要数据库）。重点：没设过上限的服务必须也列得出来，
// 否则它在花钱、却在后台表格里缺一行，谁也看不见。
import assert from "node:assert/strict";
import { test } from "node:test";
import { budgetServices } from "@aihot/backend/admin/settings";

test("会花钱的服务列全了，且不重复、有排序", () => {
  const services = budgetServices();
  // 默认模型与站上配的具名预设各有自己的 service。
  assert.ok(services.includes("llm"), "默认模型的服务要能设上限");
  for (const s of ["embedding", "jina", "dajiala", "socialdata"]) {
    assert.ok(services.includes(s), `${s} 也要能设上限`);
  }
  assert.equal(new Set(services).size, services.length, "同一个服务不能列两次");
  assert.deepEqual(services, [...services].sort(), "按名字排好，页面顺序才稳定");
});

test("站上配的具名模型，它们的服务也在清单里", async () => {
  const { PRESETS } = await import("@aihot/site/models");
  const services = budgetServices();
  for (const [key, preset] of Object.entries(PRESETS)) {
    assert.ok(services.includes(preset.service), `具名模型 ${key} 的服务 ${preset.service} 要能设上限，否则它不受任何约束`);
  }
});
