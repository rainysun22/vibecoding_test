import type { GenerateInput, GenerateOutput } from "../index.js";

/** Markdown 生成器 —— 规范化正文并附加元信息头 */
export async function generateMarkdown(input: GenerateInput): Promise<GenerateOutput> {
  const header = [
    `<!--`,
    `  OpenWork Deliverable`,
    `  Title: ${input.title}`,
    `  Format: markdown`,
    `  Generated: ${new Date().toISOString()}`,
    `-->`,
    "",
  ].join("\n");

  const content = `${header}# ${input.title}\n\n${input.markdown.trim()}\n`;
  return {
    data: Buffer.from(content, "utf-8"),
    extension: "md",
    mimeType: "text/markdown; charset=utf-8",
  };
}
