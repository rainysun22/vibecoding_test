import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { SkillDefinition } from "@openwork/types";

/**
 * Skills 加载器 —— YAML 开放格式定义（N6 真需求：技能资产跨平台可移植）。
 * 内置技能随发行版提供；用户技能放 data/skills/ 下热加载。
 */
export class SkillRegistry {
  private readonly skills = new Map<string, SkillDefinition>();

  constructor(builtinDir: string, userDir?: string) {
    this.loadDir(builtinDir, true);
    if (userDir) this.loadDir(userDir, false);
  }

  private loadDir(dir: string, builtin: boolean): void {
    let files: string[];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
    } catch {
      return; // 目录不存在时静默跳过
    }
    for (const file of files) {
      try {
        const content = readFileSync(join(dir, file), "utf-8");
        const parsed = parseYaml(content) as Partial<SkillDefinition>;
        if (!parsed.id || !parsed.name || !parsed.outputFormat) continue;
        this.skills.set(parsed.id, { ...parsed, builtin } as SkillDefinition);
      } catch {
        // 单个技能解析失败不影响整体
      }
    }
  }

  /**
   * 安装技能：校验 YAML → 落盘用户技能目录 → 注册生效（热加载）。
   * 技能市场的最小实现：任何能给出合法 YAML 的 URL 都是技能源。
   */
  install(content: string, userDir: string): SkillDefinition {
    const parsed = parseYaml(content) as Partial<SkillDefinition>;
    if (!parsed.id || !parsed.name || !parsed.description || !parsed.outputFormat) {
      throw new Error("技能定义不完整：需要 id / name / description / outputFormat");
    }
    const validFormats = new Set(["markdown", "html", "docx", "xlsx", "pptx"]);
    if (!validFormats.has(parsed.outputFormat)) {
      throw new Error(`outputFormat 非法：${String(parsed.outputFormat)}`);
    }

    mkdirSync(userDir, { recursive: true });
    writeFileSync(join(userDir, `${parsed.id}.yml`), content, "utf-8");
    const definition = { ...parsed, builtin: false } as SkillDefinition;
    this.skills.set(definition.id, definition);
    return definition;
  }

  list(): SkillDefinition[] {
    return [...this.skills.values()];
  }

  get(id: string): SkillDefinition | undefined {
    return this.skills.get(id);
  }
}
