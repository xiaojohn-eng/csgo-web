# CS:GO legacy 原版武器、涂装与音效来源目录

本报告由 `scripts/inventory-source-items.py` 从已完成安装的 App740 原文件生成。数值属于固定 build 12426148，不代表当前 CS2 规则。

## 已验证的输入与读取边界

- AppID 740；StateFlags=4、UpdateResult=0、下载字节相等。Depot731 manifest=1224088799001669801；Depot740 manifest=6998097922547485721。
- SourceIO commit `cfc2591d096628a35f570aa830ab75cc8665108b`，Blender 5.2.1 LTS；仅进程内 import，没有 register 或保存偏好。
- pak01_dir.vpk 索引 133,676 条。只读取约 15 MB 目录，未用 `glob('*')` 展开全部内容。
- 累计读取必要原始文本 18,534,463 bytes；VPK 文本通过真实 SourceIO `find_file(TinyPath)` 读取并校验 CRC/字节数。源 SHA 在 JSON 的 sourceFilesRead。
- 输出 JSON 保留全部武器 resolvedDefinition、rawItem、prefabChain、完整 prefabs、attributeDefinitions、paintKits、具名音效定义与文件索引。没有修改游戏资产、game 或 public。

## 数据规模

| 项目 | 数量 |
| --- | ---: |
| weaponItemDefinitions | 81 |
| paintKits | 1,149 |
| weaponFinishRelations | 1,641 |
| weaponSoundEvents | 498 |
| distinctWaveSpecifications | 527 |
| weaponAudioFiles | 590 |
| paintResourceFiles | 1,203 |
| baseWeaponMaterialFiles | 1,012 |

`weaponItemDefinitions` 包括原文件中的枪械、刀具、投掷物和其他 weapon_ 类装备，不把它宣传成同样数量的枪。paintKits 包含 default、workshop 和手套等条目；配对只依据原集合/掉落表或明确生成图标记录。

## 全部武器定义的主要数值

原值保持字符串；空白表示该解析定义没有给出，不用经验值补齐。完整字段见 JSON。M4A4 的内部名为 weapon_m4a1，M4A1-S 是 weapon_m4a1_silencer；二者不能按 item_class 合并。

| ID | 名称 | 内部 name | 类型 | 价格 | 弹匣 | 备用弹 | damage | cycletime | max speed |
| ---: | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 沙漠之鹰 | weapon_deagle | Pistol | 700 | 7 | 35 | 53 | ['0.225000', '0.225000'] | 230 |
| 2 | 双持贝瑞塔 | weapon_elite | Pistol | 300 | 30 | 120 | 38 | 0.120000 | 240 |
| 3 | FN57 | weapon_fiveseven | Pistol | 500 | 20 | 100 | 32 | 0.150000 | 240 |
| 4 | 格洛克 18 型 | weapon_glock | Pistol | 200 | 20 | 120 | 30 | 0.150000 | 240 |
| 7 | AK-47 | weapon_ak47 | Rifle | 2700 | 30 | 90 | 36 | 0.100000 | 215 |
| 8 | AUG | weapon_aug | Rifle | 3300 | 30 | 90 | 28 | 0.100000 | 220 |
| 9 | AWP | weapon_awp | SniperRifle | 4750 | 5 | 30 | 115 | 1.455000 | 200 |
| 10 | 法玛斯 | weapon_famas | Rifle | 2050 | 25 | 90 | 30 | 0.090000 | 220 |
| 11 | G3SG1 | weapon_g3sg1 | SniperRifle | 5000 | 20 | 90 | 80 | 0.250000 | 215 |
| 13 | 加利尔 AR | weapon_galilar | Rifle | 1800 | 35 | 90 | 30 | 0.090000 | 215 |
| 14 | M249 | weapon_m249 | Machinegun | 5200 | 100 | 200 | 32 | 0.080000 | 195 |
| 16 | M4A4 | weapon_m4a1 | Rifle | 3100 | 30 | 90 | 33 | 0.090000 | 225 |
| 17 | MAC-10 | weapon_mac10 | SubMachinegun | 1050 | 30 | 100 | 29 | 0.075000 | 240 |
| 19 | P90 | weapon_p90 | SubMachinegun | 2350 | 50 | 100 | 26 | 0.070000 | 230 |
| 20 | 排斥装置 | weapon_zone_repulsor | ZoneRepulsor | 0 | 0 | 0 | 42 | 0.150000 | 180 |
| 23 | MP5-SD | weapon_mp5sd | SubMachinegun | 1500 | 30 | 120 | 27 | 0.080000 | 235 |
| 24 | UMP-45 | weapon_ump45 | SubMachinegun | 1200 | 25 | 100 | 35 | 0.090000 | 230 |
| 25 | XM1014 | weapon_xm1014 | Shotgun | 2000 | 7 | 32 | 20 | 0.350000 | 215 |
| 26 | PP-野牛 | weapon_bizon | SubMachinegun | 1400 | 64 | 120 | 27 | 0.080000 | 240 |
| 27 | MAG-7 | weapon_mag7 | Shotgun | 1300 | 5 | 32 | 30 | 0.850000 | 225 |
| 28 | 内格夫 | weapon_negev | Machinegun | 1700 | 150 | 300 | 35 | 0.075000 | 150 |
| 29 | 截短霰弹枪 | weapon_sawedoff | Shotgun | 1100 | 7 | 32 | 32 | 0.850000 | 210 |
| 30 | Tec-9 | weapon_tec9 | Pistol | 500 | 18 | 90 | 33 | 0.120000 | 240 |
| 31 | 宙斯 X27 电击枪 | weapon_taser | Knife | 200 | 1 | 0 | 500 | 0.150000 | 220 |
| 32 | P2000 | weapon_hkp2000 | Pistol | 200 | 13 | 52 | 35 | 0.170000 | 240 |
| 33 | MP7 | weapon_mp7 | SubMachinegun | 1500 | 30 | 120 | 29 | 0.080000 | 220 |
| 34 | MP9 | weapon_mp9 | SubMachinegun | 1250 | 30 | 120 | 26 | 0.070000 | 240 |
| 35 | 新星 | weapon_nova | Shotgun | 1050 | 8 | 32 | 26 | 0.880000 | 220 |
| 36 | P250 | weapon_p250 | Pistol | 300 | 13 | 26 | 38 | 0.150000 | 240 |
| 37 | 防暴盾牌 | weapon_shield | Shield | 1100 | 0 | 0 | 42 | 0.150000 | 200 |
| 38 | SCAR-20 | weapon_scar20 | SniperRifle | 5000 | 20 | 90 | 80 | 0.250000 | 215 |
| 39 | SG 553 | weapon_sg556 | Rifle | 3000 | 30 | 90 | 30 | 0.110000 | 210 |
| 40 | SSG 08 | weapon_ssg08 | SniperRifle | 1700 | 10 | 90 | 88 | 1.250000 | 230 |
| 41 | 匕首 | weapon_knifegg | Knife | 0 | 0 | 0 | 50 | 0.150000 | 250 |
| 42 | 匕首 | weapon_knife | Knife | 0 | 0 | 0 | 50 | 0.150000 | 250 |
| 43 | 闪光震撼弹 | weapon_flashbang | Grenade | 200 | 0 | 0 | 50 | 0.150000 | 245 |
| 44 | 高爆手雷 | weapon_hegrenade | Grenade | 300 | 0 | 0 | 99 | 0.150000 | 245 |
| 45 | 烟雾弹 | weapon_smokegrenade | Grenade | 300 | 0 | 0 | 50 | 0.150000 | 245 |
| 46 | 燃烧瓶 | weapon_molotov | Grenade | 400 | 0 | 0 | 40 | 0.150000 | 245 |
| 47 | 诱饵弹 | weapon_decoy | Grenade | 50 | 0 | 0 | 50 | 0.150000 | 245 |
| 48 | 燃烧弹 | weapon_incgrenade | Grenade | 600 | 0 | 0 | 40 | 0.150000 | 245 |
| 49 | C4 炸弹 | weapon_c4 | C4 | 0 | 0 | 0 | 50 | 0.150000 | 250 |
| 57 | 医疗针 | weapon_healthshot | StackableItem | 0 | 0 | 0 | 50 | 0.150000 | 250 |
| 59 | 匕首 | weapon_knife_t | Knife | 0 | 0 | 0 | 50 | 0.150000 | 250 |
| 60 | M4A1 消音型 | weapon_m4a1_silencer | Rifle | 2900 | 20 | 80 | 38 | 0.100000 | 225 |
| 61 | USP 消音版 | weapon_usp_silencer | Pistol | 200 | 12 | 24 | 35 | 0.170000 | 240 |
| 63 | CZ75 | weapon_cz75a | Pistol | 500 | 12 | 12 | 31 | 0.100000 | 240 |
| 64 | R8 左轮手枪 | weapon_revolver | Pistol | 600 | 8 | 8 | 86 | 0.500000 | 180 |
| 68 | 战术探测手雷 | weapon_tagrenade | Grenade | 100 | 0 | 0 | 1 | 0.150000 | 245 |
| 69 | 徒手 | weapon_fists | Fists | 0 | 0 | 0 | 50 | 0.150000 | 275 |
| 70 | 遥控炸弹 | weapon_breachcharge | Breach Charge | 300 | 3 | 0 | 500 | 0.150000 | 245 |
| 72 | 特训助手 | weapon_tablet | Tablet | 300 | 1 | 0 | 500 | 0.150000 | 220 |
| 74 | 匕首 | weapon_melee | Melee | 0 | 0 | 0 | 50 | 0.150000 | 250 |
| 75 | 斧头 | weapon_axe | Melee | 0 | 0 | 0 | 20 | 0.150000 | 250 |
| 76 | 锤子 | weapon_hammer | Melee | 0 | 0 | 0 | 16 | 0.150000 | 250 |
| 78 | 扳手 | weapon_spanner | Melee | 0 | 0 | 0 | 7 | 0.150000 | 250 |
| 80 | 幽灵之刃 | weapon_knife_ghost | Knife | 0 | 0 | 0 | 50 | 0.150000 | 250 |
| 81 | 燃烧弹/瓶 | weapon_firebomb | Grenade | 400 | 0 | 0 | 40 | 0.150000 | 245 |
| 82 | 干扰型武器 | weapon_diversion | Grenade | 50 | 0 | 0 | 50 | 0.150000 | 245 |
| 83 | 破片手雷 | weapon_frag_grenade | Grenade | 300 | 0 | 0 | 99 | 0.150000 | 245 |
| 84 | 雪球 | weapon_snowball | Grenade | 100 | 0 | 0 | 1 | 0.150000 | 245 |
| 85 | 弹射地雷 | weapon_bumpmine | Bump Mine | 300 | 3 | 0 | 5 | 0.150000 | 245 |
| 500 | 刺刀 | weapon_bayonet | Knife | 0 | 0 | 0 | 50 | 0.150000 | 250 |
| 503 | 海豹短刀 | weapon_knife_css | Knife | 0 | 0 | 0 | 50 | 0.150000 | 250 |
| 505 | 折叠刀 | weapon_knife_flip | Knife | 0 | 0 | 0 | 50 | 0.150000 | 250 |
| 506 | 穿肠刀 | weapon_knife_gut | Knife | 0 | 0 | 0 | 50 | 0.150000 | 250 |
| 507 | 爪子刀 | weapon_knife_karambit | Knife | 0 | 0 | 0 | 50 | 0.150000 | 250 |
| 508 | M9 刺刀 | weapon_knife_m9_bayonet | Knife | 0 | 0 | 0 | 50 | 0.150000 | 250 |
| 509 | 猎杀者匕首 | weapon_knife_tactical | Knife | 0 | 0 | 0 | 50 | 0.150000 | 250 |
| 512 | 弯刀 | weapon_knife_falchion | Knife | 0 | 0 | 0 | 50 | 0.150000 | 250 |
| 514 | 鲍伊猎刀 | weapon_knife_survival_bowie | Knife | 0 | 0 | 0 | 50 | 0.150000 | 250 |
| 515 | 蝴蝶刀 | weapon_knife_butterfly | Knife | 0 | 0 | 0 | 50 | 0.150000 | 250 |
| 516 | 暗影双匕 | weapon_knife_push | Knife | 0 | 0 | 0 | 50 | 0.150000 | 250 |
| 517 | 系绳匕首 | weapon_knife_cord | Knife | 0 | 0 | 0 | 50 | 0.150000 | 250 |
| 518 | 求生匕首 | weapon_knife_canis | Knife | 0 | 0 | 0 | 50 | 0.150000 | 250 |
| 519 | 熊刀 | weapon_knife_ursus | Knife | 0 | 0 | 0 | 50 | 0.150000 | 250 |
| 520 | 折刀 | weapon_knife_gypsy_jackknife | Knife | 0 | 0 | 0 | 50 | 0.150000 | 250 |
| 521 | 流浪者匕首 | weapon_knife_outdoor | Knife | 0 | 0 | 0 | 50 | 0.150000 | 250 |
| 522 | 短剑 | weapon_knife_stiletto | Knife | 0 | 0 | 0 | 50 | 0.150000 | 250 |
| 523 | 锯齿爪刀 | weapon_knife_widowmaker | Knife | 0 | 0 | 0 | 50 | 0.150000 | 250 |
| 525 | 骷髅匕首 | weapon_knife_skeleton | Knife | 0 | 0 | 0 | 50 | 0.150000 | 250 |

## 参数和同名区块处理

核心来源是 loose `scripts/items/items_game.txt`。本安装的 VPK/loose scripts 中没有独立 weapon_*.txt 参数表；武器属性位于 item → weapon prefab → 分类 prefab 继承链。保留原始 prefabs 与 item 覆盖，派生预览按父项再子项深合并。

该文件会重复出现同名顶层区块，不能用普通字典直接覆盖，也不能只读取第一个。脚本合并的是没有重复 ID 的分块记录：

- items: 107 块、1715 条、0 冲突；原样相同重复键 0 个。
- prefabs: 14 块、185 条、0 冲突；原样相同重复键 0 个。
- paint_kits: 38 块、1149 条、0 冲突；原样相同重复键 0 个。
- paint_kits_rarity: 39 块、1148 条、0 冲突；原样相同重复键 1 个。
- item_sets: 38 块、80 条、0 冲突；原样相同重复键 0 个。

FAMAS 的两个 attributes 区块在派生视图中合并，rawItem/prefabs 仍保留原区块。重复标量另行保留为数组，例如 M4A1-S 的 addon scale；不能擅自声称某个值就是引擎最终行为。所有武器继承均已解析，另有 76 个非武器经济条目引用本文件未定义的内建 valve prefab，明确记录并跳过。多个父 prefab 的情况和源条件保存在 JSON；本目录不替代 Source 引擎加载规则。

本地化仅作名称标签：原文本存在合法的内嵌聊天颜色控制字节，当前 SourceIO KV lexer 不接受。因此标签单独读取每行带引号的 token/value 对，保留 Unicode，只反转义引号与反斜杠；不改原文本，不用该简化解析器读取经济规则。

## 涂装到原文件

每个 paintKit 保存原 style、pattern、颜色、wear、phong 等字段，默认条目另存。textureReferences 给出原字段与真实 VPK 路径候选；仅一个匹配时标 unique，多个标 ambiguous，没有标 unresolved。不会按现代 CS2 材质规则拼造目录。

当前纹理引用解析计数：`{'unresolved': 2, 'ambiguous': 154, 'unique': 1170}`。paintResources/baseWeaponMaterialResources 保留 VPK 中路径、字节数、CRC、分卷与偏移。这里没有解码 VTF 或宣称已还原原 shader。

weaponFinishRelations 每一配对都有 items_game 的路径证据，来自 item_sets/client_loot_lists 等 `[paintkit]weapon_name` 条目或 alternate_icons2 的明确组合图标。定义存在不等于当前可购买/可掉落；本目录没有补造皮肤。

## 具名音效到实际路径

`scripts/game_sounds_weapons.txt` 的每个事件完整保存在 soundEvents；wave/rndwave 中每条原规格都保留前缀，并匹配真实 `sound/` 文件。源事件的 channel、volume、pitch、soundlevel、operator 等字段未丢弃。每把武器另列 visuals/zoom 引用的事件名；直接 WAV 引用另列 directSoundFileReferences，避免误当缺失事件。VPK 大小写匹配保留真实路径和原始拼写。

- 额外从共同事件表解析 2 个武器引用事件；仍未解析的具名事件：`[]`。
- 未找到实际文件的 wave 路径数量：0；完整清单见 JSON review.missingWavePaths。
- 武器定义直接 WAV 引用中未找到：`['sound/weapons/m4a1/m4a1_clipint.wav']`。保留原引用，不自动纠正拼写。
- 原定义引用、但当前 loose/pak01 没找到的模型/材质路径数量：13；保留原引用，不生成替代路径。这些旧 inventory icon VTF 引用不能等同于角色/枪械 MDL 缺失；实际清单见 JSON。省略 materials/ 和扩展名的贴图引用只在单一真实文件匹配时解析。

## 验收边界与使用入口

本次交付是可复核的数据目录，不是游戏内武器实现。recoil seed/幅度/方差、spread/inaccuracy、damage/range 等原参数已经保留，但原始算法、单位解释、穿透/命中、动画事件与音频调度仍需独立对接。武器几何/动画和地图转换由其他任务处理。

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python-exit-code 1 --python scripts/inventory-source-items.py
```

其他任务可直接 import 本脚本的 `directory_index(Path(...pak01_dir.vpk))`，无需启动 Blender 或加载 SourceIO；它只读目录元数据。禁止使用 VPK glob('*') 来枚举，因为那个 API 同时读取每条 payload。
