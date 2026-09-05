import { readFileSync, readdirSync } from "node:fs";
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

  list(): SkillDefinition[] {
    return [...this.skills.values()];
  }

  get(id: string): SkillDefinition | undefined {
    return this.skills.get(id);
  }
}
