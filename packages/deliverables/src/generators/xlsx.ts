import ExcelJS from "exceljs";
import type { GenerateInput, GenerateOutput } from "../index.js";
import { parseMarkdown, stripInline } from "../markdown.js";

/**
 * xlsx 生成器 —— 双工作表结构：
 * 1. "报告"：Markdown 结构化正文（标题层级/段落/列表）
 * 2. "数据"：提取正文中的所有表格（便于二次计算）
 */
export async function generateXlsx(input: GenerateInput): Promise<GenerateOutput> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "OpenWork";
  workbook.created = new Date();
  workbook.title = input.title;

  const report = workbook.addWorksheet("报告", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  report.columns = [{ width: 14 }, { width: 100 }];
  report.mergeCells("A1:B1");
  const titleCell = report.getCell("A1");
  titleCell.value = input.title;
  titleCell.font = { bold: true, size: 16, color: { argb: "FF16213E" } };
  titleCell.alignment = { vertical: "middle" };
  report.getRow(1).height = 32;

  let rowIndex = 3;
  const blocks = parseMarkdown(input.markdown);
  for (const block of blocks) {
    switch (block.kind) {
      case "heading": {
        const row = report.getRow(rowIndex);
        row.getCell(2).value = block.text;
        row.getCell(2).font = {
          bold: true,
          size: Math.max(11, 15 - block.level),
          color: { argb: "FF3B5BDB" },
        };
        rowIndex += 2;
        break;
      }
      case "paragraph": {
        const cell = report.getRow(rowIndex).getCell(2);
        cell.value = stripInline(block.text);
        cell.alignment = { wrapText: true, vertical: "top" };
        report.getRow(rowIndex).height = Math.ceil(stripInline(block.text).length / 90) * 18;
        rowIndex += 1;
        break;
      }
      case "list": {
        for (const [index, item] of block.items.entries()) {
          const row = report.getRow(rowIndex);
          row.getCell(1).value = block.ordered ? `${index + 1}.` : "•";
          row.getCell(2).value = stripInline(item);
          rowIndex += 1;
        }
        rowIndex += 1;
        break;
      }
      case "quote": {
        const cell = report.getRow(rowIndex).getCell(2);
        cell.value = stripInline(block.text);
        cell.font = { italic: true, color: { argb: "FF40466A" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF1FF" } };
        rowIndex += 2;
        break;
      }
      case "table": {
        // 表格写入报告页
        const headerRow = report.getRow(rowIndex);
        block.header.forEach((cell, colIndex) => {
          const c = headerRow.getCell(colIndex + 1);
          c.value = stripInline(cell);
          c.font = { bold: true, color: { argb: "FFFFFFFF" } };
          c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF3B5BDB" } };
        });
        rowIndex += 1;
        for (const row of block.rows) {
          const r = report.getRow(rowIndex);
          row.forEach((cell, colIndex) => {
            r.getCell(colIndex + 1).value = stripInline(cell);
          });
          rowIndex += 1;
        }
        rowIndex += 1;
        break;
      }
      case "code": {
        const cell = report.getRow(rowIndex).getCell(2);
        cell.value = block.text;
        cell.font = { name: "Consolas", size: 10, color: { argb: "FF333333" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F4F8" } };
        rowIndex += 2;
        break;
      }
      case "hr":
        rowIndex += 1;
        break;
    }
  }

  // 数据页：提取全部表格
  const tables = blocks.filter((b) => b.kind === "table");
  if (tables.length > 0) {
    const data = workbook.addWorksheet("数据");
    let cursor = 1;
    tables.forEach((block, tableIndex) => {
      if (block.kind !== "table") return;
      const label = data.getRow(cursor);
      label.getCell(1).value = `表 ${tableIndex + 1}`;
      label.getCell(1).font = { bold: true, color: { argb: "FF3B5BDB" } };
      cursor += 1;

      const header = data.getRow(cursor);
      block.header.forEach((cell, colIndex) => {
        const c = header.getCell(colIndex + 1);
        c.value = stripInline(cell);
        c.font = { bold: true };
        c.border = { bottom: { style: "thin" } };
      });
      cursor += 1;

      for (const row of block.rows) {
        const r = data.getRow(cursor);
        row.forEach((cell, colIndex) => {
          const numeric = Number(stripInline(cell).replace(/[,%\s]/g, ""));
          r.getCell(colIndex + 1).value = Number.isFinite(numeric) && stripInline(cell) !== ""
            ? numeric
            : stripInline(cell);
        });
        cursor += 1;
      }
      cursor += 2;
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return {
    data: Buffer.from(buffer),
    extension: "xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
}
