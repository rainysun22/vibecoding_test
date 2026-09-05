import type { GenerateInput, GenerateOutput } from "../index.js";
import { parseInline, parseMarkdown } from "../markdown.js";

const CSS = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body {
  font-family: -apple-system, "Segoe UI", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif;
  max-width: 860px; margin: 0 auto; padding: 48px 24px 96px;
  color: #1a1a2e; background: #fafbfc; line-height: 1.75; font-size: 16px;
}
h1 { font-size: 2em; margin: 0 0 .6em; padding-bottom: .4em; border-bottom: 3px solid #3b5bdb; }
h2 { font-size: 1.5em; margin: 2em 0 .6em; color: #16213e; }
h3 { font-size: 1.2em; margin: 1.6em 0 .5em; color: #16213e; }
p { margin: .8em 0; }
blockquote {
  margin: 1.2em 0; padding: .8em 1.2em; border-left: 4px solid #3b5bdb;
  background: #eef1ff; border-radius: 0 8px 8px 0; color: #40466a;
}
code { font-family: "JetBrains Mono", Consolas, monospace; background: #eef1f4; padding: .15em .4em; border-radius: 4px; font-size: .9em; }
pre { background: #16213e; color: #e6e9f0; padding: 1em 1.2em; border-radius: 10px; overflow-x: auto; }
pre code { background: none; padding: 0; color: inherit; }
table { border-collapse: collapse; width: 100%; margin: 1.2em 0; font-size: .95em; }
th { background: #3b5bdb; color: #fff; text-align: left; }
th, td { padding: .6em .9em; border: 1px solid #dde1e8; }
tr:nth-child(even) td { background: #f2f4f8; }
ul, ol { padding-left: 1.6em; }
li { margin: .3em 0; }
hr { border: none; border-top: 2px solid #dde1e8; margin: 2em 0; }
footer { margin-top: 4em; padding-top: 1em; border-top: 1px solid #dde1e8; color: #8a90a5; font-size: .85em; }
`;

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function inlineHtml(text: string): string {
  return parseInline(text)
    .map((token) => {
      let html = escapeHtml(token.text);
      if (token.code) html = `<code>${html}</code>`;
      if (token.bold) html = `<strong>${html}</strong>`;
      if (token.italic) html = `<em>${html}</em>`;
      return html;
    })
    .join("");
}

/** HTML 生成器 —— 自包含单文件（内联样式，无外部依赖，任何平台可直接打开） */
export async function generateHtml(input: GenerateInput): Promise<GenerateOutput> {
  const blocks = parseMarkdown(input.markdown);
  const body = blocks
    .map((block) => {
      switch (block.kind) {
        case "heading": {
          const tag = `h${Math.min(block.level + 1, 6)}`; // 文档 h1 留给主标题
          return `<${tag}>${inlineHtml(block.text)}</${tag}>`;
        }
        case "paragraph":
          return `<p>${inlineHtml(block.text)}</p>`;
        case "list": {
          const tag = block.ordered ? "ol" : "ul";
          const items = block.items.map((item) => `<li>${inlineHtml(item)}</li>`).join("");
          return `<${tag}>${items}</${tag}>`;
        }
        case "table": {
          const head = `<tr>${block.header.map((c) => `<th>${inlineHtml(c)}</th>`).join("")}</tr>`;
          const rows = block.rows
            .map((row) => `<tr>${row.map((c) => `<td>${inlineHtml(c)}</td>`).join("")}</tr>`)
            .join("");
          return `<table><thead>${head}</thead><tbody>${rows}</tbody></table>`;
        }
        case "quote":
          return `<blockquote>${inlineHtml(block.text)}</blockquote>`;
        case "code":
          return `<pre><code>${escapeHtml(block.text)}</code></pre>`;
        case "hr":
          return "<hr />";
      }
    })
    .join("\n");

  const generatedAt = new Date().toISOString();
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="generator" content="OpenWork" />
<title>${escapeHtml(input.title)}</title>
<style>${CSS}</style>
</head>
<body>
<h1>${escapeHtml(input.title)}</h1>
${body}
<footer>由 OpenWork 生成 · ${escapeHtml(generatedAt)} · 开放格式，可自由迁移</footer>
</body>
</html>
`;

  return {
    data: Buffer.from(html, "utf-8"),
    extension: "html",
    mimeType: "text/html; charset=utf-8",
  };
}
