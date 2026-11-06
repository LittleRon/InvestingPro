// 部署时用 LLM_EXTRA_MODELS 登记的额外模型：能登记多家厂商、同厂同模型不同密钥，
// 没配好的密钥在后台标成「未配置密钥」，写坏了的登记不该让进程起不来。
import assert from "node:assert/strict";
import { test } from "node:test";

/** 每个用例都要在同一个进程里换环境变量，所以把读取逻辑做成函数，按需重新读。 */
async function loadModels() {
  // 动态导入：模块在第一次导入时就固定了 MODELS，所以每个用例换完环境变量再重新导入。
  const mod = await import(`../packages/backend/src/providers/llm.ts?cachebust=${Date.now()}${Math.random()}`);
  return mod;
}

test("LLM_EXTRA_MODELS 登记的模型能被识别，同厂同模型不同密钥算两项", async () => {
  process.env.DEEPSEEK_KEY_A = "key-a";
  process.env.DEEPSEEK_KEY_B = "key-b";
  process.env.LLM_EXTRA_MODELS = JSON.stringify({
    "deepseek-a": { service: "deepseek", model: "deepseek-flash", baseUrl: "https://api.deepseek.com/v1", apiKeyEnv: "DEEPSEEK_KEY_A", extra: { thinking: { type: "disabled" } } },
    "deepseek-b": { service: "deepseek", model: "deepseek-flash", baseUrl: "https://api.deepseek.com/v1", apiKeyEnv: "DEEPSEEK_KEY_B", extra: { thinking: { type: "disabled" } } },
    "qwen-a": { service: "dashscope", model: "qwen3.8-flash", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", apiKeyEnv: "DEEPSEEK_KEY_A", extra: { enable_thinking: false } },
  });
  const { MODELS, extraModelKeys } = await loadModels();
  assert.ok(MODELS["deepseek-a"], "deepseek-a registered");
  assert.ok(MODELS["deepseek-b"], "deepseek-b registered");
  assert.ok(MODELS["qwen-a"], "qwen-a registered");
  // 同厂同模型不同密钥：两把是不同的可选模型。
  assert.equal(MODELS["deepseek-a"]!.model, MODELS["deepseek-b"]!.model);
  assert.notEqual(MODELS["deepseek-a"]!.key, MODELS["deepseek-b"]!.key);
  assert.equal(MODELS["deepseek-a"]!.service, "deepseek");
  assert.equal(MODELS["qwen-a"]!.service, "dashscope");
  // 密钥按各自的变量读。
  assert.equal(MODELS["deepseek-a"]!.apiKey, "key-a");
  assert.equal(MODELS["deepseek-b"]!.apiKey, "key-b");
  // 站点写好的具名预设不受影响。
  assert.ok(MODELS["deepseek-flash"], "the named preset is still there");
  assert.deepEqual(Object.keys(extraModelKeys()).sort(), ["deepseek-a", "deepseek-b", "qwen-a"]);
  delete process.env.LLM_EXTRA_MODELS;
});

test("登记缺字段时报错说明缺哪个", async () => {
  process.env.LLM_EXTRA_MODELS = JSON.stringify({ bad: { service: "deepseek" } });
  const { extraModelKeys, extraModelsError } = await loadModels();
  // 写坏的登记不该让进程起不来：这里只读键，读不到就是空的。
  assert.deepEqual(extraModelKeys(), {});
  // 但后台要能看到错在哪，否则「配了却不生效」无从查起。
  const message = extraModelsError();
  assert.ok(message, "there is an error message");
  assert.match(message, /bad/, "the message names the offending entry");
  delete process.env.LLM_EXTRA_MODELS;
});

test("登记写坏 JSON 时也能说出原因", async () => {
  process.env.LLM_EXTRA_MODELS = "{ not json";
  const { extraModelKeys, extraModelsError } = await loadModels();
  assert.deepEqual(extraModelKeys(), {});
  assert.match(extraModelsError() ?? "", /LLM_EXTRA_MODELS/, "the message says which variable is wrong");
  delete process.env.LLM_EXTRA_MODELS;
});

test("登记写对了就没有错误提示", async () => {
  process.env.DEEPSEEK_KEY_C = "key-c";
  process.env.LLM_EXTRA_MODELS = JSON.stringify({
    "deepseek-c": { service: "deepseek", model: "deepseek-flash", baseUrl: "https://api.deepseek.com/v1", apiKeyEnv: "DEEPSEEK_KEY_C" },
  });
  const { extraModelsError } = await loadModels();
  assert.equal(extraModelsError(), null);
  delete process.env.LLM_EXTRA_MODELS;
});

test("没登记额外模型时不影响原有的模型表", async () => {
  delete process.env.LLM_EXTRA_MODELS;
  const { MODELS } = await loadModels();
  assert.ok(MODELS.default, "default is there");
  assert.ok(MODELS["deepseek-flash"], "the named preset is there");
});
