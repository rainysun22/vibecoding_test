import assert from "node:assert/strict";
import { generateDeliverable } from "./index.js";
import { parseMarkdown } from "./markdown.js";

const SAMPLE = `## 一、引言

任务式 AI 交付正从对话生成演进为**成果交付**。

## 二、核心分析

### 2.1 背景

- 开放中立方案稀缺
- 成本路由成为主流
- 语义级审批优于逐工具确认

### 2.2 数据

| 指标 | 数值 | 说明 |
| --- | --- | --- |
| 采纳率 | 62% | 目标用户群 |
| 成本下降 | 40% | 多模型路由 |
| 交付时长 | 3.5 分钟 | 端到端 |

> 一次撰写，多格式无损交付。

\`\`\`ts
const openwork = "开源中立";
\`\`\`

## 三、结论

1. 结构化拆解降低复杂度
2. 开放格式保证可迁移
3. 成本与信任可以兼得
`;

async function testMarkdownParse(): Promise<void> {
  const blocks = parseMarkdown(SAMPLE);
  const headings = blocks.filter((b) => b.kind === "heading");
  const tables = blocks.filter((b) => b.kind === "table");
  const lists = blocks.filter((b) => b.kind === "list");
  const quotes = blocks.filter((b) => b.kind === "quote");
  const codes = blocks.filter((b) => b.kind === "code");

  assert.equal(headings.length, 5);
  assert.equal(tables.length, 1);
  assert.equal(lists.length, 2);
  assert.equal(quotes.length, 1);
  assert.equal(codes.length, 1);

  const table = tables[0];
  assert.ok(table?.kind === "table");
  if (table?.kind === "table") {
    assert.equal(table.header.length, 3);
    assert.equal(table.rows.length, 3);
  }
  console.log("  ✓ Markdown 解析正确（标题/表格/列表/引用/代码）");
}

async function testAllFormats(): Promise<void> {
  const formats = ["markdown", "html", "docx", "xlsx", "pptx"] as const;
  for (const format of formats) {
    const output = await generateDeliverable({
      title: "OpenWork 测试成果",
      markdown: SAMPLE,
      format,
    });
    assert.ok(output.data.length > 500, `${format} 输出过小: ${output.data.length}`);
    assert.ok(output.extension === format || (format === "markdown" && output.extension === "md"));

    // OOXML 格式必须以 ZIP 魔数开头
    if (["docx", "xlsx", "pptx"].includes(format)) {
      assert.equal(output.data[0], 0x50, `${format} 缺少 ZIP 魔数`);
      assert.equal(output.data[1], 0x4b);
    }
    console.log(`  ✓ ${format.padEnd(8)} ${output.data.length} bytes`);
  }
}

async function testInlineParse(): Promise<void> {
  const { parseInline, stripInline } = await import("./markdown.js");
  const tokens = parseInline("普通 **加粗** *斜体* `代码` [链接](https://x.com)");
  const bold = tokens.find((t) => t.bold);
  const italic = tokens.find((t) => t.italic);
  const code = tokens.find((t) => t.code);
  assert.equal(bold?.text, "加粗");
  assert.equal(italic?.text, "斜体");
  assert.equal(code?.text, "代码");
  assert.ok(stripInline("[链接](https://x.com)").includes("链接"));
  console.log("  ✓ 行内标记解析正确");
}

async function main(): Promise<void> {
  await testMarkdownParse();
  await testInlineParse();
  await testAllFormats();
  console.log("deliverables: 全部测试通过");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
