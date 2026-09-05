import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import type { GenerateInput, GenerateOutput } from "../index.js";
import { parseInline, parseMarkdown } from "../markdown.js";

const HEADING_MAP = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
];

/** docx 生成器 —— 开放 OOXML 格式，Word/WPS/LibreOffice 皆可打开 */
export async function generateDocx(input: GenerateInput): Promise<GenerateOutput> {
  const blocks = parseMarkdown(input.markdown);
  const children: (Paragraph | Table)[] = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: input.title, bold: true, size: 44 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: `由 OpenWork 生成 · ${new Date().toLocaleString("zh-CN")}`,
          color: "8A90A5",
          size: 20,
        }),
      ],
    }),
  ];

  for (const block of blocks) {
    switch (block.kind) {
      case "heading":
        children.push(
          new Paragraph({
            heading: HEADING_MAP[Math.min(block.level, 5)],
            children: [new TextRun({ text: block.text, bold: true })],
          }),
        );
        break;

      case "paragraph":
        children.push(
          new Paragraph({ children: block.text ? toTextRuns(block.text) : [new TextRun("")] }),
        );
        break;

      case "list":
        for (const [index, item] of block.items.entries()) {
          const children_runs = [
            ...(block.ordered ? [new TextRun({ text: `${index + 1}. `, bold: true })] : []),
            ...toTextRuns(item),
          ];
          children.push(
            block.ordered
              ? new Paragraph({ children: children_runs, indent: { left: 360 } })
              : new Paragraph({ bullet: { level: 0 }, children: children_runs }),
          );
        }
        break;

      case "quote":
        children.push(
          new Paragraph({
            children: parseInline(block.text).map(
              (token) =>
                new TextRun({
                  text: token.text,
                  bold: token.bold,
                  italics: true,
                  font: token.code ? "Consolas" : undefined,
                }),
            ),
            indent: { left: 480 },
            spacing: { before: 120, after: 120 },
          }),
        );
        break;

      case "code":
        for (const line of block.text.split("\n")) {
          children.push(
            new Paragraph({
              children: [
                new TextRun({ text: line || " ", font: "Consolas", size: 18, color: "333333" }),
              ],
              shading: { fill: "F2F4F8" },
            }),
          );
        }
        break;

      case "table": {
        const headerRow = new TableRow({
          tableHeader: true,
          children: block.header.map(
            (cell) =>
              new TableCell({
                shading: { fill: "3B5BDB" },
                children: [
                  new Paragraph({
                    children: [new TextRun({ text: cell, bold: true, color: "FFFFFF" })],
                  }),
                ],
              }),
          ),
        });
        const bodyRows = block.rows.map(
          (row) =>
            new TableRow({
              children: row.map(
                (cell) =>
                  new TableCell({ children: [new Paragraph({ children: toTextRuns(cell) })] }),
              ),
            }),
        );
        children.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [headerRow, ...bodyRows],
          }),
        );
        children.push(new Paragraph({ text: "" }));
        break;
      }

      case "hr":
        children.push(new Paragraph({ border: { bottom: { style: "single", size: 6, color: "DDE1E8" } } }));
        break;
    }
  }

  const doc = new Document({
    creator: "OpenWork",
    title: input.title,
    description: "OpenWork deliverable (docx, open format)",
    sections: [{ children }],
  });

  const data = await Packer.toBuffer(doc);
  return {
    data: Buffer.from(data),
    extension: "docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };
}

function toTextRuns(text: string): TextRun[] {
  return parseInline(text).map(
    (token) =>
      new TextRun({
        text: token.text,
        bold: token.bold,
        italics: token.italic,
        font: token.code ? "Consolas" : undefined,
      }),
  );
}
