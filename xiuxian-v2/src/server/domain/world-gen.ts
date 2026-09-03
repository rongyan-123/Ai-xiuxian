/**
 * 世界生成系统（World Genesis）
 *
 * 固定底层规则模板（确定性结构，不交给 LLM 决定）→ LLM 在模板约束下
 * 生成具体内容（地点/宗门/NPC/玩家背景）→ 结果存入 codex。
 * 新存档首次 action 时触发一次（agent-loop 集成）。LLM 失败 → 降级到
 * 固定模板世界（buildFallbackWorld），保证世界永不空洞。
 */
import type { CodexEntry } from '@/types'

/** 大陆固定格局 — LLM 不得更改，只填充具体内容 */
export const WORLD_RULES = {
  continent: '苍元大陆',
  regions: ['北域·冰原', '南域·百越', '东域·沧海', '西域·大漠'],
  forces: '正道七宗、魔道三脉、中立散修盟',
  playerStart: { region: '南域·百越', villageType: '偏远山村' },
} as const

/** Genesis 允许的工具：只生成世界内容，不修改玩家状态 */
export const GENESIS_TOOLS = ['GenerateNpc', 'GenerateLocation', 'GenerateSect', 'AddCodexEntry'] as const

/** 玩家背景 codex 条目的固定 entry_type */
export const BACKGROUND_ENTRY_TYPE = 'background'

/** 世界是否已生成：codex 中存在 location 条目即视为已生成 */
export function needsWorldGenesis(codex: Array<{ entry_type: string }>): boolean {
  return !codex.some((e) => e.entry_type === 'location')
}

/** 从生成的 codex 中选出玩家出生地（第一个 location 条目，与 prompt 约定一致） */
export function pickStartLocation(codex: Array<{ name: string; entry_type: string }>): string {
  return codex.find((e) => e.entry_type === 'location')?.name ?? ''
}

/** 构造世界生成提示词 — 只引导 LLM 调工具，不输出叙事 */
export function buildWorldGenesisPrompt(player: {
  name: string
  gender: string
  realm: string
}): string {
  const { continent, regions, forces, playerStart } = WORLD_RULES
  return `你是${continent}的创世者。这个世界按固定的底层规则运转，你负责填充具体的内容。本回合只允许调用工具生成世界，不要输出任何叙事文本，也不要解释你的工作。

【大陆格局】（固定，不可更改）
- 大陆名：${continent}，共分四域：${regions.join('、')}
- 势力格局：${forces}
- 灵脉分布：各域皆有灵脉，正道大宗多占据灵脉丰沛之处，魔道隐于凶险之地

【你的任务 — 用工具生成初始世界】
1. GenerateLocation × 4~6（第一个必须是玩家的出生地）：
   - 第一个地点：玩家"${player.name}"（${player.gender}，${player.realm}）的出生地。一个位于${playerStart.region}的${playerStart.villageType}，危险等级"安全"，民风淳朴，附近有通往外界坊市的山路
   - 再生成 1 个坊市（${playerStart.region}最大的修仙集市，危险等级"安全"）
   - 1 个灵脉名山或宗门驻地（危险等级"低危"）
   - 1 个妖兽出没的凶险之地（危险等级"中危"或更高）
   - 可选：其他域的代表性地点（如北域雪原上的宗门驻地等），让四域皆有存在感
   - 每个地点必须填全：name、region、danger_level、peace_orno、description、inhabitants
2. GenerateSect × 3~5：覆盖正道、魔道、中立三种阵营。正道大宗驻地在灵脉名山上（与已生成的地点呼应）；魔道隐于凶险之地；散修盟保持中立。填全 name、alignment、power_level、master、master_realm、description
3. GenerateNpc × 3~4：
   - 出生村至少 2 人：1 位知晓外界世事的年长修士（可为玩家引路），1 位村中同龄人
   - 其余散布在其他地点（坊市掌柜、名山守山弟子等），与生成的宗门/地点对应
   - 填全 name、realm、alignment、sect、personality、relationship、description；修为与身份匹配（宗门掌门可金丹期以上，村中凡人无修为）
4. AddCodexEntry × 1：生成玩家背景。entry_type 必须为 "background"，name 为"${player.name}"，description 写清：
   - 出身：${playerStart.region} 某山村（与出生地同名）的贫苦人家或没落修士遗孤（自行设定）
   - 为何踏上修仙之路：一个有说服力的个人契机
   - 灵根资质：五行杂灵根（天生如此，不作更改），气质与性格
   - 与世界的初始关联：是否与某个已生成的 NPC 有旧识

【一致性要求】
- 宗门驻地与地点互相呼应：生成宗门时在 description 中引用对应地点名
- NPC 的 sect 字段与生成的宗门名一致，无门无派则写"散修"
- 所有名称必须是符合中国古典仙侠风格的原创名称，禁止使用"新手村""青云坊市"等通用名
- 生成的顺序：先 GenerateLocation 后 GenerateSect/GenerateNpc，AddCodexEntry 放最后`
}

/** 世界是否还需要补全轮：背景缺失，或宗门/人物不足（LLM 单次调用往往只出地点） */
export function needsGenesisCompletion(
  codex: Array<{ entry_type: string }>,
  npcs: unknown[],
): boolean {
  if (!codex.some((e) => e.entry_type === 'background')) return true
  if (codex.filter((e) => e.entry_type === 'sect').length < 2) return true
  if (npcs.length < 2) return true
  return false
}

/** 构造补全轮提示词 — 告知已生成内容与缺失类型，只调缺失工具 */
export function buildGenesisCompletionPrompt(player: {
  name: string
  gender: string
  realm: string
}, codex: Array<{ name: string; entry_type: string }>, npcs: unknown[]): string {
  const { continent, playerStart } = WORLD_RULES
  const locations = codex.filter((e) => e.entry_type === 'location').map((e) => e.name)
  const sects = codex.filter((e) => e.entry_type === 'sect').map((e) => e.name)
  const missing: string[] = []
  if (sects.length < 2) {
    missing.push(`宗门（GenerateSect）：当前 ${sects.length} 个，需要 2 个以上，覆盖正道/魔道/中立阵营，驻地与已生成的地点呼应`)
  }
  if (npcs.length < 2) {
    missing.push(`人物（GenerateNpc）：当前 ${npcs.length} 个，需要 2 个以上，出生村至少 1 位年长引路修士`)
  }
  if (!codex.some((e) => e.entry_type === 'background')) {
    missing.push(`玩家背景（AddCodexEntry）：缺失，必须生成 1 个。entry_type 为 "background"，name 为"${player.name}"，出身${playerStart.region}山村，与已生成地点/人物呼应`)
  }

  return `你是${continent}的创世者。世界骨架已生成，还缺少以下内容，本回合只允许调用工具补齐缺失部分，不要输出叙事文本，也不要重复生成已存在的内容。

【缺失内容】（只补齐这些）
- ${missing.join('\n- ')}

【已生成内容】（禁止重复生成）
- 地点：${locations.join('、') || '无'}
- 宗门：${sects.join('、') || '无'}

【一致性要求】
- 名称原创，禁止使用"新手村""青云坊市"等通用名
- 宗门/NPC 与已生成的地点呼应（description 中引用对应地点名）`
}

/** 玩家背景条目（genesis 失败时兜底用） */
export function buildFallbackBackground(player: {
  name: string
  gender: string
  realm: string
}): CodexEntry {
  return {
    id: 'codex-background',
    name: player.name,
    entry_type: BACKGROUND_ENTRY_TYPE,
    description:
      `${player.name}（${player.gender}）出身于南域·百越一座偏远山村，家中世代务农，幼时体弱多病。` +
      `十年前一名重伤垂危的游方散修被村人所救，临终前感念恩情，将一部残缺的吐纳法门留给了${player.name}，` +
      `并留下一句遗言："天地不仁，万物刍狗。若不甘心碌碌一生，便去山外寻仙。"` +
      `${player.name}自此修习吐纳，迈入${player.realm}。五行杂灵根，资质平平，却心志坚韧，不甘向命运低头。`,
    metadata: { region: WORLD_RULES.playerStart.region, origin: '山村遗孤' },
    timestamp: Date.now(),
  }
}

/** 兜底世界（genesis 失败时使用）：确定性固定模板，保证世界永不空洞 */
export function buildFallbackWorld(player: {
  name: string
  gender: string
  realm: string
}): { codex: CodexEntry[]; currentLocation: string } {
  const t = Date.now()
  const background = buildFallbackBackground(player)
  const village: CodexEntry = {
    id: 'codex-village',
    name: '青牛村',
    entry_type: 'location',
    description:
      `南域·百越一座宁静的山间村落，村口老槐树下常有老人下棋，村民世代务农，偶有散修路过歇脚。` +
      `村中有一间铁匠铺和一家小药铺，村外山道通往云台坊市。`,
    metadata: { region: WORLD_RULES.playerStart.region, danger_level: '安全', peace_orno: '和平' },
    timestamp: t,
  }
  const market: CodexEntry = {
    id: 'codex-market',
    name: '云台坊市',
    entry_type: 'location',
    description:
      `南域·百越最大的修仙者集市，坐落于云台山脚下。街道两旁店铺林立，丹药铺、法宝阁、任务堂、茶楼应有尽有，` +
      `各色修士往来不绝，是南域散修最重要的交易场所。`,
    metadata: { region: WORLD_RULES.playerStart.region, danger_level: '安全', peace_orno: '和平' },
    timestamp: t,
  }
  const mountain: CodexEntry = {
    id: 'codex-mountain',
    name: '苍澜山',
    entry_type: 'location',
    description:
      `南域灵脉名山，山势巍峨，云雾缭绕，山腰以上常有妖兽出没。传说山中藏有上古修士洞府，` +
      `吸引无数散修前往寻宝，也葬送了不知多少性命。[低危] 位于南域·百越`,
    metadata: { region: WORLD_RULES.playerStart.region, danger_level: '低危', peace_orno: '和平' },
    timestamp: t,
  }
  return {
    codex: [village, market, mountain, background],
    currentLocation: village.name,
  }
}
