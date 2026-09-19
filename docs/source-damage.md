# App740 普通子弹伤害

`game/source-damage.ts` 是独立纯函数；AK/M4 已由主任务接入 Simulation 的原 OBB 命中路径。`scripts/probe-source-damage.py` 已执行当前原 `server.so` 的有界指令块，**1,260 / 1,260** 组与 TypeScript 输出逐项一致，所有浮点中间值最大误差 **0**，整数血量伤害、剩余护甲、原护甲统计值均一致。

2026-09-09 又增加 Glock-18 / USP-S 的原属性配置和 **1,260** 个独立原指令样本，浮点中间值与所有整数结果同样 0 差异。两把手枪的 damage / armorRatio / rangeModifier 分别为 `30 / .94 / .85` 与 `35 / 1.01 / .91`，射线范围均为 `4096u`。原计算代码不变，保留步枪原版本，新增 `SOURCE_PISTOL_DAMAGE_VERSION='csgo-normal-pistol-damage-12426148-r1'` 供后续手枪仿真身份使用；手枪尚未接入可玩装备。

脚本 `scripts/probe-source-pistol-damage.py` 逐 SHA 读取原 items_game 及已验证手枪继承属性，再执行相同原 ELF 的距离、部位、护甲及取整指令。验证覆盖 7 距离、9 hitgroup、5 甲量、两种头盔状态；`tests/source-pistol-damage.test.ts` 对照全部中间值并拒绝超出原射程，另重跑原步枪回归。报告为 `output/tests/source-pistol-damage-native.json` 与 `source-pistol-damage-validation.json`。范围仍不包含重甲、墙体穿透或完整实体伤害副作用。

```ts
const result = computeSourceBulletDamage({
  weapon: 'ak47', // 或 'm4a4'
  hitgroup: hit.group, // 必须是原始编号，head:boolean 无法替代
  distanceMetres: hit.distance,
  armor: target.armor,
  helmet: target.helmet,
});
// result.healthDamage 是原路径的整数伤害，尚未按剩余 HP 裁剪。
// result.armorAfter 是权威剩余护甲，不能只减 reportedArmorDamage。
```

版本：`SOURCE_DAMAGE_VERSION = csgo-normal-bullet-damage-12426148-r1`。函数只接受已证明的 AK/M4A4、hitgroup 0–8、0–100 整数普通护甲、有限非负距离。`heavyArmor:true` 明确拒绝。范围超过原 8,192 Source unit（208.0768m）返回无伤害；原生射线本身也应使用这个距离上限，纯函数的额外边界不能代替 ray range / 地图遮挡。

## 原始字段

原安装 `scripts/items/items_game.txt` SHA256 `510e09b68a01d88edba2342972960025fd6484aaaa58365fcf47d8513de79623`。从已校验该 SHA 的原清单解析 prefab 继承：`statted_item_base → weapon_base → primary → rifle → weapon_*_prefab`。

| 原 item | 基础伤害 | head multiplier | armor ratio | range modifier | range |
| --- | ---: | ---: | ---: | ---: | ---: |
| weapon_ak47 | 36 | 4 | 1.55 | .98 | 8192u |
| weapon_m4a1（M4A4） | 33 | 4 | 1.4 | .97 | 8192u |

AK 未覆盖的 `.98` 与两枪的 `4` 来自 **statted_item_base 原字段**，不是凭记忆补值。M4A4 的原 item_class 叫 `weapon_m4a1`；不能把它当 M4A1-S。

当前二进制 `server.so` SHA256 `7de235c31b2d645c5106cbd7358da3f3ac7964e87f870c4fe6ea31d93a714386`。四项 `mp_damage_scale_{ct,t}_{head,body}` 原构造默认均为 `1.0`，注册地址及实例地址已落原生回执。本函数固定这个普通分支，不声称支持服务器另行修改这些 ConVar。

## 原生指令链

- `CCSPlayer` RTTI `0x12be10c`，vtable `0x12be8d4`：slot `+0x10c` → `0xc2c860` 的 TraceAttack 部位分支；slot `+0x114` → `0xc449b0` 的伤害/护甲路径。
- 原部位 jump table `0x12bdbf8`；weapon-info `+0xf4` 为 head multiplier，`+0xf8` 为 armor ratio。初始化程序 `0xc9a920` 同时含原属性名称、读取调用与相同目标 offset，另留反汇编用于交叉核验。
- `0xc18af0` 完整 IsArmored 执行原 armor `+0xfb8`、helmet `+0x174c`、heavy armor `+0x174d`。普通护甲覆盖 0、2、3、4、5、8，头 1 需 helmet，腿 6/7 不覆盖。这里只对原编号 8 保留实际分支，不额外猜其命名。
- 原 FireBullet `0xc737e0` 来自 `FX_FireBullets` `0xcb4bc0` 的调用；距离块 `0xc74c6b..0xc74cf2` 用 `__pow_finite`。指数为 float32 的 `distanceSource * 0.0020000000949949026`，底数为原 float32 range modifier；乘基础伤害后转回 float32。不是射程以内不衰减、射程外线性掉伤害。
- 普通部位倍率：头为 weapon head multiplier4，腹1.25，腿.75，胸/手臂/其余本次支持的编号1。
- armor ratio 先乘 `.5`，health damage 为 `scaledDamage * ratio`；armor cost 为 `(scaledDamage - healthDamage) * .5`。护甲不足时 health damage 改为 `scaledDamage - armor/.5`。
- **分别截断**：原 `0xc46305` 先求 `armor-cost` 再截断为剩余护甲；原统计字段另截断 cost。例 AK 零距胸：cost约4.05，满甲100变95，原 reportedArmorDamage却是4。两者不能互相替代。
- `0xc4577a..0xc457a9` 再以 `cvttss2si` 将普通 float damage 截断为原整数，后续 entity health / death / events 由 caller 处理。

公开官方 SDK 仅用于 [CTakeDamageInfo 接口与普通伤害管线的背景](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/game/shared/takedamageinfo.h)。SDK HL2 的护甲常量不能代替本 CS:GO 二进制；本次没有采用第三方 cheat/autowall 公式作为真值。

## 可执行对照与数值

Oracle 在 Unicorn x86 中执行原字节；只有标准库 `pow(double,double)` 用 host `math.pow` 返回，微型 ABI trampoline 将该 double 放回原 x87 返回寄存器。hitgroup switch、float32 指令顺序、完整 IsArmored、护甲充足/不足判断、护甲整数和伤害整数转换均执行原机器码。断言整个二进制 SHA、RTTI/vtable、jump table 和关键字节；未启动原游戏进程、注入服务或执行购买/死亡副作用。

2 枪 × 7 距离（0、1、100、500、1000、2000、8192u）× 9 groups × 5 甲量（0、1、5、20、100）× 2 helmet 状态 = 1,260。输出 `output/tests/source-damage-native.json`；TypeScript 对照 `output/tests/source-damage-verification.json`。专项 3/3 通过；另外覆盖无头盔头部、低护甲耗尽、未被护甲覆盖的腿、越程及不支持的重甲输入。

| 零距、满普通甲且有头盔 | 头 | 胸 | 腹 | 腿 |
| --- | ---: | ---: | ---: | ---: |
| AK | 111 | 27 | 34 | 27 |
| M4A4 | 92 | 23 | 28 | 24 |

均为原整数伤害，不是扣除当前剩余 HP 后的统计上限。无头盔 AK 头为144；只有5甲但有头盔时为134并清空护甲。

```sh
.tools/source-binary-venv/bin/python scripts/probe-source-damage.py
npx vitest run tests/source-damage.test.ts
npx tsc --noEmit
```

未覆盖：穿墙/材料穿透、重甲及其模式分支、友伤、团队伤害倍率覆盖、特殊武器、爆炸、完整伤害回调/成就/音效/生命与死亡副作用。helper 接收的是已由服务器与原 hitboxes 判定的命中，不能授权客户端提交伤害或 hitgroup。

## 原防弹衣与头盔升级价格

原 item 50 `item_kevlar` 的 `in game price` 为650（原文件29182起）；item51 `item_assaultsuit` 为1000（29206起）。实际 `0xc711d0` 报价程序先识别 item51，再检查 **armor >99 且没有 helmet**，只有这时减去 item50价格，得到 **350**。

`scripts/probe-source-armor-price.py` 执行原 item-ID/armor/helmet 比较块 `0xc7129a..0xc71338` 及原减法 `0xc71393..0xc71399`；中间 schema 查询仅注入同 SHA 原 item50价格。回执 `output/tests/source-armor-price-native.json` 保存 item50/51 × armor0/1/99/100 × helmetfalse/true 的16项原报价。

- item50：650；原购买入口 `0xc47e20` 在已有100甲时拒绝重复买。
- item51、甲0–99且没头盔：1000，不按残余甲百分比折价。
- item51、甲100且没头盔：350。
- 已有头盔时直接 item51 购买入口 `0xc48080` 拒绝（不能只看价格函数返回1000就扣款）。身体甲受损可通过 item50补甲，保留头盔。

以上是普通报价与已查的重复持有边界，未执行完整 alive/buy-time/buy-zone/funds 限制或购买副作用；主任务在开新购买项前需保持已有服务端购买事务验证。

`game/source-armor.ts` 提供 `sourceArmorPurchase(item:'armor'|'helmet', armor, helmet)`，返回 `{cost,armor:100,helmet}` 或 `null`（重复持有），输入异常时抛错。补甲保留已有头盔；helper 不修改玩家或扣款。原生脚本另实际执行 `0xc47e8c`、`0xc4812a` 的购买入口持有比较分支，16项回执均含 `originalOwnershipAllowed`。`tests/source-armor.test.ts` 对照全部16项报价及原入口分支，并覆盖甲量与输入契约；红阶段因缺少模块而失败，新增纯模块后3/3通过。
