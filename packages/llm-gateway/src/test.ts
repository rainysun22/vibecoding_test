import assert from "node:assert/strict";
import { LLMGateway, BudgetExceededError } from "./index.js";
import { MockProvider } from "./providers/mock.js";
import { listModels, estimateCost } from "./models.js";

async function testMockComplete(): Promise<void> {
  const gateway = new LLMGateway();
  const response = await gateway.complete({
    model: "mock/mock-agent",
    messages: [
      { role: "system", content: "You are a PLANNER." },
      { role: "user", content: "委托目标：写一份AI市场分析" },
    ],
  });
  const plan = JSON.parse(response.content) as { steps: unknown[] };
  assert.ok(Array.isArray(plan.steps) && plan.steps.length === 3);
  assert.ok(response.usage.totalTokens > 0);
  assert.equal(response.usage.costUSD, 0);
  console.log("  ✓ mock complete 生成合法计划");
}

async function testMockStream(): Promise<void> {
  const provider = new MockProvider();
  let text = "";
  let done = false;
  for await (const chunk of provider.stream({
    model: "mock/mock-agent",
    messages: [{ role: "user", content: "委托目标：测试流式" }],
  })) {
    text += chunk.delta;
    done = chunk.done;
  }
  assert.ok(done);
  assert.ok(text.length > 0);
  console.log("  ✓ mock stream 产出增量内容");
}

async function testCostEstimate(): Promise<void> {
  const model = listModels().find((m) => m.id === "anthropic/claude-sonnet-4");
  assert.ok(model);
  const cost = estimateCost(model, 1_000_000, 1_000_000);
  assert.equal(cost, 3 + 15);
  console.log("  ✓ 成本估算正确");
}

async function testLocalFirstRouting(): Promise<void> {
  const gateway = new LLMGateway();
  gateway.configure("ollama", { baseUrl: "http://127.0.0.1:11434" });
  assert.equal(gateway.modelForPurpose("execution"), "mock/mock-agent"); // 未开启本地优先

  gateway.setRouting({ preferLocal: true, localModel: "ollama/qwen3:8b" });
  assert.equal(gateway.modelForPurpose("execution"), "ollama/qwen3:8b"); // 本地优先生效
  assert.equal(gateway.modelForPurpose("planning"), "mock/mock-agent"); // 计划仍用强模型
  console.log("  ✓ 本地优先路由：execution 走本地，planning 不受影响");
}

async function testBudgetDowngrade(): Promise<void> {
  const gateway = new LLMGateway();
  gateway.restoreSpentToday(5); // 今日已消费 $5
  gateway.setRouting({ dailyBudgetUSD: 1 });

  // 无可用付费模型 → 明确报错
  assert.throws(() => gateway.modelForPurpose("execution"), BudgetExceededError);

  // 配置 OpenAI 后 → 降级到最便宜的已配置模型（gpt-4o-mini）
  gateway.configure("openai", { apiKey: "test-key" });
  gateway.configure("anthropic", { apiKey: "test-key" });
  assert.equal(gateway.modelForPurpose("execution"), "openai/gpt-4o-mini");
  console.log("  ✓ 预算降级：超限后自动切换最便宜可用模型");
}

async function main(): Promise<void> {
  await testMockComplete();
  await testMockStream();
  await testCostEstimate();
  await testLocalFirstRouting();
  await testBudgetDowngrade();
  console.log("llm-gateway: 全部测试通过");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
