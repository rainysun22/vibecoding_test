import type { DeliverableFormat } from "@openwork/types";
import { generateMarkdown } from "./generators/markdown.js";
import { generateHtml } from "./generators/html.js";
import { generateDocx } from "./generators/docx.js";
import { generateXlsx } from "./generators/xlsx.js";
import { generatePptx } from "./generators/pptx.js";

export interface GenerateInput {
  title: string;
  /** 正文（Markdown —— 通用中间表示） */
  markdown: string;
  format: DeliverableFormat;
}

export interface GenerateOutput {
  /** 文件二进制内容（md 为 UTF-8 文本） */
  data: Buffer;
  /** 文件扩展名 */
  extension: string;
  /** MIME 类型 */
  mimeType: string;
}

/**
 * 成果引擎：把 Markdown 正文转换为开放格式文件。
 * 所有生成器纯函数化 —— 无副作用、可测试、可并行。
 */
export function generateDeliverable(input: GenerateInput): Promise<GenerateOutput> {
  switch (input.format) {
    case "markdown":
      return generateMarkdown(input);
    case "html":
      return generateHtml(input);
    case "docx":
      return generateDocx(input);
    case "xlsx":
      return generateXlsx(input);
    case "pptx":
      return generatePptx(input);
  }
}

export { parseMarkdown, parseInline, stripInline } from "./markdown.js";
