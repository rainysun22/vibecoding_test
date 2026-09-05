import PptxGenJS from "pptxgenjs";
import type { GenerateInput, GenerateOutput } from "../index.js";
import { parseMarkdown, stripInline, type MdBlock } from "../markdown.js";

/**
 * pptxgenjs 的类型入口在 NodeNext 下与 CJS 互操作存在缺陷，
 * 这里仅声明本生成器用到的最小结构化类型（运行时已验证兼容）。
 */
interface PptxTextOptions {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  color?: string;
  align?: "left" | "center" | "right";
  valign?: "top" | "middle" | "bottom";
  breakLine?: boolean;
  bullet?: boolean | { type?: string };
  fill?: { color: string };
  fontFace?: string;
}

interface PptxSlide {
  background: { color?: string };
  addText(
    text: string | { text: string; options?: PptxTextOptions }[],
    options?: PptxTextOptions,
  ): unknown;
  addTable(rows: string[][], options?: PptxTextOptions & Record<string, unknown>): unknown;
}

interface PptxPresentation {
  author: string;
  title: string;
  layout: string;
  addSlide(): PptxSlide;
  write(options: { outputType: string }): Promise<unknown>;
}

const PptxConstructor = PptxGenJS as unknown as new () => PptxPresentation;

const THEME = {
  primary: "16213E",
  accent: "3B5BDB",
  text: "2B2F44",
  muted: "8A90A5",
  bg: "FFFFFF",
};

/** 段落块聚合为组（不超过每页上限） */
interface SlideChunk {
  blocks: MdBlock[];
  bulletCount: number;
}

const MAX_BULLETS_PER_SLIDE = 6;

/**
 * pptx 生成器 —— 将 Markdown 结构转译为演示文稿：
 * 1. 封面页（标题 + 日期）
 * 2. 每个 h2 一个章节页 + 内容页（要点/表格/引用）
 * 3. 结尾页
 */
export async function generatePptx(input: GenerateInput): Promise<GenerateOutput> {
  const pptx = new PptxConstructor();
  pptx.author = "OpenWork";
  pptx.title = input.title;
  pptx.layout = "LAYOUT_16x9";

  const blocks = parseMarkdown(input.markdown);

  // 封面
  const cover = pptx.addSlide();
  cover.background = { color: THEME.primary };
  cover.addText(input.title, {
    x: 0.6, y: 2.2, w: 8.8, h: 1.6,
    fontSize: 40, bold: true, color: "FFFFFF",
    align: "center", valign: "middle",
  });
  cover.addText(`由 OpenWork 生成 · ${new Date().toLocaleDateString("zh-CN")}`, {
    x: 0.6, y: 3.9, w: 8.8, h: 0.5,
    fontSize: 14, color: "AAB3D4", align: "center",
  });

  // 内容：按 h2 分节
  const sections = splitIntoSections(blocks);
  for (const section of sections) {
    if (section.title) {
      const divider = pptx.addSlide();
      divider.background = { color: THEME.primary };
      divider.addText(section.title, {
        x: 0.6, y: 2.5, w: 8.8, h: 1.2,
        fontSize: 30, bold: true, color: "FFFFFF", align: "left",
      });
      divider.addText(`0${section.index + 1}`, {
        x: 0.6, y: 1.4, w: 2, h: 0.8,
        fontSize: 44, bold: true, color: THEME.accent, align: "left",
      });
    }

    const chunks = chunkContent(section.blocks);
    for (const chunk of chunks) {
      const slide = pptx.addSlide();
      slide.background = { color: THEME.bg };
      if (section.title) {
        slide.addText(section.title, {
          x: 0.55, y: 0.25, w: 8.9, h: 0.4,
          fontSize: 13, color: THEME.accent, bold: true,
        });
      }
      addContentBlocks(slide, chunk.blocks);
    }
  }

  // 结尾页
  const ending = pptx.addSlide();
  ending.background = { color: THEME.primary };
  ending.addText("谢谢", {
    x: 0.6, y: 2.4, w: 8.8, h: 1.2,
    fontSize: 44, bold: true, color: "FFFFFF", align: "center",
  });
  ending.addText("OpenWork · 开放格式 · 自由迁移", {
    x: 0.6, y: 3.7, w: 8.8, h: 0.5,
    fontSize: 13, color: "AAB3D4", align: "center",
  });

  const data = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
  return {
    data: Buffer.from(data),
    extension: "pptx",
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  };
}

interface Section {
  index: number;
  title: string;
  blocks: MdBlock[];
}

function splitIntoSections(blocks: MdBlock[]): Section[] {
  const sections: Section[] = [{ index: 0, title: "", blocks: [] }];
  for (const block of blocks) {
    if (block.kind === "heading" && block.level <= 2) {
      sections.push({ index: sections.length, title: block.text, blocks: [] });
    } else {
      sections[sections.length - 1]?.blocks.push(block);
    }
  }
  // 过滤空节
  return sections.filter((s) => s.title || s.blocks.length > 0);
}

/** 内容分页：要点页超过上限自动换页 */
function chunkContent(blocks: MdBlock[]): SlideChunk[] {
  const chunks: SlideChunk[] = [];
  let current: SlideChunk = { blocks: [], bulletCount: 0 };

  for (const block of blocks) {
    if (block.kind === "heading" && block.level >= 3) {
      // h3 作为新内容页起点
      if (current.blocks.length > 0) {
        chunks.push(current);
        current = { blocks: [], bulletCount: 0 };
      }
      current.blocks.push(block);
      continue;
    }
    if (block.kind === "table") {
      // 表格独占一页
      if (current.blocks.length > 0) chunks.push(current);
      chunks.push({ blocks: [block], bulletCount: 0 });
      current = { blocks: [], bulletCount: 0 };
      continue;
    }
    const bullets =
      block.kind === "list" ? block.items.length : block.kind === "paragraph" ? 1 : 0;
    if (current.bulletCount + bullets > MAX_BULLETS_PER_SLIDE && current.blocks.length > 0) {
      chunks.push(current);
      current = { blocks: [], bulletCount: 0 };
    }
    current.blocks.push(block);
    current.bulletCount += bullets;
  }
  if (current.blocks.length > 0) chunks.push(current);
  return chunks;
}

function addContentBlocks(slide: PptxSlide, blocks: MdBlock[]): void {
  let y = 0.8;
  const contentWidth = 8.9;

  for (const block of blocks) {
    switch (block.kind) {
      case "heading":
        slide.addText(block.text, {
          x: 0.55, y, w: contentWidth, h: 0.55,
          fontSize: 24, bold: true, color: THEME.text,
        });
        y += 0.7;
        break;

      case "paragraph": {
        const text = stripInline(block.text);
        const height = Math.max(0.5, Math.ceil(text.length / 60) * 0.32);
        slide.addText(text, {
          x: 0.55, y, w: contentWidth, h: height,
          fontSize: 14, color: THEME.text, valign: "top",
        });
        y += height + 0.15;
        break;
      }

      case "list": {
        const items = block.items.map((item) => stripInline(item));
        const height = Math.max(0.5, items.length * 0.42);
        slide.addText(
          items.map((item) => ({
            text: block.ordered ? item : `• ${item}`,
            options: { bullet: block.ordered ? { type: "number" } : false, breakLine: true },
          })),
          { x: 0.7, y, w: contentWidth - 0.3, h: height, fontSize: 14, color: THEME.text },
        );
        y += height + 0.2;
        break;
      }

      case "quote":
        slide.addText(stripInline(block.text), {
          x: 0.7, y, w: contentWidth - 0.3, h: 0.8,
          fontSize: 14, italic: true, color: THEME.muted,
          fill: { color: "EEF1FF" },
        });
        y += 1;
        break;

      case "table": {
        const rows = [block.header, ...block.rows].map((row) =>
          row.map((cell) => stripInline(cell)),
        );
        slide.addTable(rows, {
          x: 0.55, y, w: contentWidth,
          fontSize: 11,
          border: { type: "solid", color: "DDE1E8", pt: 1 },
          fill: { color: "FFFFFF" },
          color: THEME.text,
        });
        y += 0.5 + rows.length * 0.36;
        break;
      }

      case "code":
        slide.addText(block.text, {
          x: 0.55, y, w: contentWidth, h: 1.5,
          fontSize: 11, fontFace: "Consolas",
          color: "E6E9F0", fill: { color: THEME.primary },
        });
        y += 1.7;
        break;

      case "hr":
        y += 0.2;
        break;
    }
  }
}
