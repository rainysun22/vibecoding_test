import assert from "node:assert/strict";
import { LLMGateway } from "./index.js";
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

async function main(): Promise<void> {
  await testMockComplete();
  await testMockStream();
  await testCostEstimate();
  console.log("llm-gateway: 全部测试通过");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
