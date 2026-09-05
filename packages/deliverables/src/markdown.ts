/**
 * 轻量 Markdown 块级解析器 —— OpenWork 的通用中间表示（UIR）。
 *
 * Agent 的原生输出即 Markdown；各格式生成器（html/docx/pptx/xlsx）
 * 共享此解析结果，保证「一次撰写、多格式无损交付」。
 */

export type MdBlock =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "table"; header: string[]; rows: string[][] }
  | { kind: "quote"; text: string }
  | { kind: "code"; language: string; text: string }
  | { kind: "hr" };

export interface MdInlineToken {
  text: string;
  bold: boolean;
  italic: boolean;
  code: boolean;
}

/** 解析为块级结构 */
export function parseMarkdown(markdown: string): MdBlock[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: MdBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";

    // 空行
    if (!line.trim()) {
      i++;
      continue;
    }

    // 标题 # ## ...
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1]!.length, text: heading[2]!.trim() });
      i++;
      continue;
    }

    // 水平线
    if (/^(\*{3,}|-{3,}|_{3,})$/.test(line.trim())) {
      blocks.push({ kind: "hr" });
      i++;
      continue;
    }

    // 代码块
    if (line.trim().startsWith("```")) {
      const language = line.trim().slice(3).trim();
      const buffer: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? "").trim().startsWith("```")) {
        buffer.push(lines[i] ?? "");
        i++;
      }
      i++; // 跳过闭合 ```
      blocks.push({ kind: "code", language, text: buffer.join("\n") });
      continue;
    }

    // 引用
    if (line.trim().startsWith(">")) {
      const buffer: string[] = [];
      while (i < lines.length && (lines[i] ?? "").trim().startsWith(">")) {
        buffer.push((lines[i] ?? "").trim().replace(/^>\s?/, ""));
        i++;
      }
      blocks.push({ kind: "quote", text: buffer.join("\n") });
      continue;
    }

    // 表格
    if (isTableLine(lines[i]) && isTableLine(lines[i + 1]) && isDividerRow(lines[i + 1] ?? "")) {
      const header = splitTableRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableLine(lines[i])) {
        rows.push(splitTableRow(lines[i] ?? ""));
        i++;
      }
      blocks.push({ kind: "table", header, rows });
      continue;
    }

    // 列表（无序）
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i] ?? "")) {
        items.push((lines[i] ?? "").replace(/^\s*[-*+]\s+/, "").trim());
        i++;
      }
      blocks.push({ kind: "list", ordered: false, items });
      continue;
    }

    // 列表（有序）
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i] ?? "")) {
        items.push((lines[i] ?? "").replace(/^\s*\d+[.)]\s+/, "").trim());
        i++;
      }
      blocks.push({ kind: "list", ordered: true, items });
      continue;
    }

    // 段落：连续非空行合并
    const buffer: string[] = [];
    while (
      i < lines.length &&
      (lines[i] ?? "").trim() &&
      !/^(#{1,6})\s/.test(lines[i] ?? "") &&
      !/^\s*[-*+]\s+/.test(lines[i] ?? "") &&
      !/^\s*\d+[.)]\s+/.test(lines[i] ?? "") &&
      !(lines[i] ?? "").trim().startsWith(">") &&
      !(lines[i] ?? "").trim().startsWith("```")
    ) {
      buffer.push(lines[i] ?? "");
      i++;
    }
    if (buffer.length) {
      blocks.push({ kind: "paragraph", text: buffer.join(" ").trim() });
    } else {
      i++; // 防御：避免死循环
    }
  }

  return blocks;
}

/** 解析行内标记：**bold** *italic* `code` */
export function parseInline(text: string): MdInlineToken[] {
  const tokens: MdInlineToken[] = [];
  let bold = false;
  let italic = false;
  let code = false;
  let buffer = "";

  const flush = () => {
    if (buffer) {
      tokens.push({ text: buffer, bold, italic, code });
      buffer = "";
    }
  };

  for (let i = 0; i < text.length; i++) {
    const three = text.slice(i, i + 3);
    if (three === "***") {
      flush();
      bold = !bold;
      italic = !italic;
      i += 2;
      continue;
    }
    if (three === "**`" || three === "`**") {
      // 罕见组合，按字面处理
    }
    const two = text.slice(i, i + 2);
    if (two === "**") {
      flush();
      bold = !bold;
      i++;
      continue;
    }
    if (text[i] === "*" && !italic) {
      flush();
      italic = true;
      continue;
    }
    if (text[i] === "*" && italic) {
      flush();
      italic = false;
      continue;
    }
    if (text[i] === "`") {
      flush();
      code = !code;
      continue;
    }
    if (text[i] === "[") {
      // 链接 [text](url) —— 保留 text，丢弃 url
      const close = text.indexOf("]", i);
      const paren = text.indexOf("(", close);
      if (close > 0 && paren === close + 1) {
        const end = text.indexOf(")", paren);
        if (end > 0) {
          flush();
          const linkText = text.slice(i + 1, close);
          tokens.push({ text: linkText, bold, italic, code });
          i = end;
          continue;
        }
      }
    }
    buffer += text[i];
  }
  flush();
  return tokens;
}

/** 提取纯文本（去标记） */
export function stripInline(text: string): string {
  return parseInline(text)
    .map((t) => t.text)
    .join("");
}

function isTableLine(line: string | undefined): boolean {
  return Boolean(line && line.includes("|") && line.trim().length > 2);
}

function isDividerRow(line: string): boolean {
  return /^\s*\|?\s*:?-{2,}.*\|/.test(line) && line.includes("-");
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}
