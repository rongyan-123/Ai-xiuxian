/**
 * World Seed Data — 预种子世界基础设施
 *
 * 这些是手动编写的高质量世界数据，供 AI 在开局时选择而非从零生成。
 * 规则：选择优于生成。AI 先从种子数据中匹配，找不到匹配时才调用 Generate 工具。
 */

// ── 宗门（6个）──────────────────────────────────────────────────────────────

export interface SeedSect {
  name: string
  alignment: '正道' | '魔道' | '中立'
  power_level: string
  master: string
  master_realm: string
  description: string
  specialties: string
  reputation: string
}

export const SEED_SECTS: SeedSect[] = [
  {
    name: '金剑门',
    alignment: '正道',
    power_level: '二流宗门',
    master: '金剑真人',
    master_realm: '金丹后期',
    description:
      '以剑修为主的宗门，位于青云山脉金顶峰。门规森严，弟子多为剑修，崇尚"一剑破万法"。山门由七十二把飞剑组成的剑阵守护。',
    specialties: '剑道、金系功法、炼器（剑类）',
    reputation: '南域有名的剑修门派，以战力强悍著称，与其他正道宗门关系良好',
  },
  {
    name: '青云门',
    alignment: '正道',
    power_level: '一流宗门',
    master: '青云子',
    master_realm: '元婴中期',
    description:
      '南域第一正道大派，坐落于青云山脉主峰。门人弟子数千，以道法自然为宗旨，兼容并蓄。内设丹药堂、法宝阁、剑阁、经楼四院。',
    specialties: '道法、炼丹、阵法',
    reputation: '南域正道领袖，与各大势力均有往来，威望极高',
  },
  {
    name: '药王谷',
    alignment: '中立',
    power_level: '二流宗门',
    master: '药王老人',
    master_realm: '金丹中期',
    description:
      '隐于苍澜山深处的炼丹宗门。谷中药田千顷，奇花异草遍地。弟子稀少但个个精通炼丹之术，不参与宗门争斗，但各大势力都欠其人情。',
    specialties: '炼丹、灵植培育、医术',
    reputation: '修仙界的"药铺"，正魔两道都不愿得罪的中立势力',
  },
  {
    name: '天魔教',
    alignment: '魔道',
    power_level: '一流宗门',
    master: '天魔老祖',
    master_realm: '元婴后期',
    description:
      '魔道第一势力，总坛位于黑木林深处的天魔峰。教众遍布南域，行事诡秘狠辣。修炼功法多为掠夺他人修为的邪功，被正道视为大敌。',
    specialties: '魔功、采补、御兽（妖兽）',
    reputation: '令正道闻风丧胆的魔道巨擘，但教内等级森严，底层教众日子并不好过',
  },
  {
    name: '万宝楼',
    alignment: '中立',
    power_level: '二流势力',
    master: '金满堂',
    master_realm: '金丹初期',
    description:
      '遍布各大坊市的商会组织，总部设在天机城。以"有钱能使鬼推磨"为信条，不参与任何宗门争斗，只做生意。情报网络遍布南域。',
    specialties: '商业、情报、法宝交易',
    reputation: '修仙界的"财神爷"，只要你出得起灵石，什么都能买到',
  },
  {
    name: '太虚观',
    alignment: '正道',
    power_level: '二流宗门',
    master: '太虚真人',
    master_realm: '元婴初期',
    description:
      '位于落凤坡的道门隐修之地。观中弟子不多但个个修为精深，修习太虚经，擅长阵法与符箓。观中藏有大量上古文献，是南域修仙界的重要知识库。',
    specialties: '阵法、符箓、古籍研究',
    reputation: '低调但有实力的隐修门派，被其他宗门视为"活图书馆"',
  },
]

// ── 地点（6个）──────────────────────────────────────────────────────────────

export interface SeedLocation {
  name: string
  region: string
  danger_level: '安全' | '低危' | '中危' | '高危' | '绝地'
  peace_orno: '和平' | '冲突' | '战争' | '混乱'
  description: string
  features: string[]
  connected_to: string[]
  level_range: string
}

export const SEED_LOCATIONS: SeedLocation[] = [
  {
    name: '新手村',
    region: '南域',
    danger_level: '安全',
    peace_orno: '和平',
    description:
      '一个宁静的山间小村，村口老槐树下常有老人下棋。村中有铁匠铺、药铺和茶馆，偶尔有散修路过歇脚。村外是通往青云坊市的大道，背靠苍澜山。',
    features: ['铁匠铺', '药铺', '茶馆', '村口老槐树'],
    connected_to: ['青云坊市', '苍澜山'],
    level_range: '凡人到练气',
  },
  {
    name: '青云坊市',
    region: '南域',
    danger_level: '安全',
    peace_orno: '和平',
    description:
      '青云山脉脚下最大的修仙者集市。街道两旁店铺林立，丹药铺、法宝阁、任务堂、茶楼应有尽有。各色修士往来不绝，是南域修仙者最重要的交易和交流场所。坊市中心有一块巨大的"青云公告板"，张贴着各种任务和消息。',
    features: ['丹药铺', '法宝阁', '任务堂', '茶楼', '公告板', '客栈'],
    connected_to: ['新手村', '金顶峰', '苍澜山', '天机城'],
    level_range: '练气到金丹',
  },
  {
    name: '苍澜山',
    region: '南域',
    danger_level: '中危',
    peace_orno: '冲突',
    description:
      '连绵数百里的苍翠山脉，外围是采药人和散修常去的区域，灵草妖兽皆有。深处据说有上古遗迹和妖兽巢穴，寻常修士不敢深入。山中还有药王谷的入口，但极少有人知道具体位置。',
    features: ['外围采药区', '中围妖兽区', '深处古遗迹', '药王谷入口（隐藏）'],
    connected_to: ['新手村', '青云坊市', '黑木林'],
    level_range: '练气到金丹',
  },
  {
    name: '黑木林',
    region: '南域',
    danger_level: '高危',
    peace_orno: '混乱',
    description:
      '终年不见阳光的黑色森林，树木扭曲如鬼爪。林中瘴气弥漫，妖兽横行，是魔修的天堂。深处为天魔教总坛所在，外人闯入九死一生。但也有散修冒险进入寻找稀有的黑灵草和妖兽材料。',
    features: ['瘴气区', '妖兽巢穴', '黑灵草生长地', '天魔教总坛'],
    connected_to: ['苍澜山', '落凤坡'],
    level_range: '筑基到元婴',
  },
  {
    name: '落凤坡',
    region: '南域',
    danger_level: '低危',
    peace_orno: '和平',
    description:
      '传说古时有凤凰坠落于此，坡上常年开着一种名为"凤羽花"的红色灵花。太虚观坐落于坡顶，观前的"太虚碑"上刻着上古道文。修士常来此参悟道法或采撷凤羽花入药。',
    features: ['凤羽花田', '太虚观', '太虚碑', '参悟台'],
    connected_to: ['黑木林', '天机城'],
    level_range: '练气到金丹',
  },
  {
    name: '天机城',
    region: '南域',
    danger_level: '低危',
    peace_orno: '和平',
    description:
      '南域最大的修仙城市，由万宝楼主导的商会联盟管理。城中高楼林立，阵法护城，是散修聚集的中心。城中设有斗法台、拍卖行、万宝楼总部和散修联盟驻地。城市上空常年有飞舟往来，热闹非凡。',
    features: ['斗法台', '拍卖行', '万宝楼总部', '散修联盟', '飞舟码头', '客栈'],
    connected_to: ['青云坊市', '落凤坡'],
    level_range: '练气到元婴',
  },
]

// ── 物品模板（15件）─────────────────────────────────────────────────────────

export interface SeedItem {
  name: string
  type: string
  grade: string
  description: string
  effects: string
  value: number
}

export const SEED_ITEMS: SeedItem[] = [
  {
    name: '回灵丹',
    type: '丹药',
    grade: '黄阶中品',
    description: '修仙界最常见的灵力恢复丹药，一枚可回复少量灵力。坊市药铺皆有售卖。',
    effects: '回复灵力30点',
    value: 30,
  },
  {
    name: '筑基丹',
    type: '丹药',
    grade: '玄阶下品',
    description: '练气期修士突破至筑基期的关键丹药，药力猛烈，需要一定修为才能承受。各大宗门均有炼制秘方，但市面流通极少。',
    effects: '大幅提升突破筑基期的成功率',
    value: 500,
  },
  {
    name: '凝气草',
    type: '材料',
    grade: '黄阶下品',
    description: '常见的灵草，生长于灵气充沛的山野之间。是炼制回灵丹的基础材料，坊市中常有人收购。',
    effects: '炼丹材料（回灵丹主材）',
    value: 5,
  },
  {
    name: '灵石',
    type: '货币',
    grade: '无',
    description: '修仙界的通用货币，蕴含天地灵气。可用于修炼、布阵、驱动法宝。按灵气纯度分下品、中品、上品、极品四等。',
    effects: '货币，也可直接吸收修炼',
    value: 1,
  },
  {
    name: '青釭剑',
    type: '法宝',
    grade: '玄阶下品',
    description: '以青釭石铸造的飞剑，剑身泛着青芒，锋利无匹。是筑基期剑修的标配法宝，金剑门弟子的入门佩剑。',
    effects: '装备后攻击力+15',
    value: 200,
  },
  {
    name: '护体法衣',
    type: '防具',
    grade: '黄阶上品',
    description: '以灵蚕丝织就的护体法衣，可抵御一定程度的物理和法术攻击。散修的标准防护装备。',
    effects: '装备后防御力+10',
    value: 80,
  },
  {
    name: '黑灵草',
    type: '材料',
    grade: '玄阶中品',
    description: '只生长在黑木林深处的稀有灵草，通体漆黑，蕴含浓烈的阴属性灵力。是炼制破境丹和某些魔道丹药的关键材料。采集时需防备周围妖兽。',
    effects: '炼丹材料（破境丹、魔道丹药）',
    value: 150,
  },
  {
    name: '凤羽花',
    type: '材料',
    grade: '黄阶上品',
    description: '只在落凤坡生长的红色灵花，传说沾染了古凤凰的精血。花开时如火焰绽放，可入药炼制火属性丹药。',
    effects: '炼丹材料（火属性丹药）',
    value: 40,
  },
  {
    name: '储物袋',
    type: '杂物',
    grade: '黄阶下品',
    description: '修仙者人手一个的空间法器，以空间阵法炼制，可存放远超外表体积的物品。最廉价的那种只能放几样东西。',
    effects: '增加背包容量',
    value: 50,
  },
  {
    name: '辟谷丹',
    type: '丹药',
    grade: '黄阶下品',
    description: '凡人食之可数日不饥，修仙者服用则毫无意义。但对刚入道途、尚未辟谷的练气初期修士来说还算实用。',
    effects: '七日不饥',
    value: 5,
  },
  {
    name: '破境丹',
    type: '丹药',
    grade: '地阶下品',
    description: '金丹期以下修士突破瓶颈的极品丹药。以黑灵草为主材，辅以数十种珍贵灵药炼制而成。有价无市的宝物。',
    effects: '金丹期以下突破瓶颈成功率+30%',
    value: 2000,
  },
  {
    name: '妖兽内丹',
    type: '材料',
    grade: '玄阶中品',
    description: '击杀妖兽后从其体内取出的内丹，蕴含妖兽毕生修为。可直接吸收（有一定风险），也可入药或炼器。品级取决于妖兽等级。',
    effects: '炼丹/炼器材料，可直接吸收（风险）',
    value: 300,
  },
  {
    name: '飞剑',
    type: '法宝',
    grade: '黄阶上品',
    description: '最基础的飞行法宝，以灵铁铸成。练气期修士即可御剑飞行，但速度不快，消耗灵力也大。坊市中最畅销的法宝之一。',
    effects: '装备后可御剑飞行',
    value: 100,
  },
  {
    name: '聚灵阵盘',
    type: '杂物',
    grade: '玄阶下品',
    description: '便携式阵法装置，注入灵力后可在周身三丈内形成聚灵阵，加速修炼速度。是散修居家修炼的必备之物。',
    effects: '修炼效率+20%',
    value: 250,
  },
  {
    name: '疗伤散',
    type: '丹药',
    grade: '黄阶下品',
    description: '最常见的外伤药散，敷在伤口上可快速止血愈伤。但不能回复灵力，重伤无效。',
    effects: '回复生命值20点',
    value: 10,
  },
]

// ── 功法（8本）──────────────────────────────────────────────────────────────

export interface SeedTechnique {
  name: string
  category: 'main' | 'combat' | 'movement' | 'support'
  grade: string
  description: string
  suitable_for: string
}

export const SEED_TECHNIQUES: SeedTechnique[] = [
  {
    name: '太玄经',
    category: 'main',
    grade: '地阶下品',
    description: '太虚观镇派功法，修炼至深处可感悟天道。功法中正平和，适合道心坚定者修炼。进展不快但根基扎实，不易走火入魔。',
    suitable_for: '道修、正道修士',
  },
  {
    name: '金剑诀',
    category: 'main',
    grade: '玄阶上品',
    description: '金剑门核心功法，以金系灵气淬炼飞剑。修炼者剑气凌厉，攻击力在同阶中名列前茅。但防御偏弱，需辅以其他功法。',
    suitable_for: '剑修',
  },
  {
    name: '天魔功',
    category: 'main',
    grade: '地阶中品',
    description: '天魔教不传之秘，以掠夺他人修为为修炼手段。进展极快但极易走火入魔，修炼者性情也会逐渐变得暴戾。',
    suitable_for: '魔修',
  },
  {
    name: '天外飞仙',
    category: 'combat',
    grade: '玄阶中品',
    description: '金剑门最强剑招，一剑既出如天外飞仙，剑气纵横十丈。消耗灵力极大，练气期修士最多使出一剑。',
    suitable_for: '剑修、金丹期以上',
  },
  {
    name: '凌波微步',
    category: 'movement',
    grade: '玄阶下品',
    description: '高深的身法，施展时如凌波而行，身形飘忽不定。战斗中可大幅提升闪避能力，日常赶路也比御剑飞行省力。',
    suitable_for: '所有流派',
  },
  {
    name: '炼丹术',
    category: 'support',
    grade: '黄阶上品',
    description: '基础的炼丹术法，可炼制常见的丹药如回灵丹、疗伤散等。高级丹药需要更高深的炼丹术和稀有材料。',
    suitable_for: '所有流派',
  },
  {
    name: '万剑归宗',
    category: 'combat',
    grade: '地阶下品',
    description: '剑修至高剑诀之一，将万千剑气收归一念。修炼至大成，一念可化万剑。金丹期以下只能发挥皮毛。',
    suitable_for: '剑修、元婴期以上',
  },
  {
    name: '药王经',
    category: 'support',
    grade: '玄阶中品',
    description: '药王谷不传之秘，记载了数百种灵药的培育方法和上千种丹方。修炼者可辨识几乎所有灵草，炼丹成功率大幅提升。',
    suitable_for: '丹修、药师',
  },
]
