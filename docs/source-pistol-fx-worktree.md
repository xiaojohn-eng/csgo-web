# 原手枪特效附件修正

新增独立 `sourcePistolFxAttachments(root, relativeTo, {silencerAttached})`，版本 `csgo-pistol-fx-attachments-12426148-r1`。调用前完成当前 viewmodel 动画采样。返回枪口及抛壳口的完整相对矩阵、位置、forward/up/right 三方向，不重复加偏移、单位换算或世界变换。

```ts
const fx = sourcePistolFxAttachments(model, gun, {
  silencerAttached: player.sourceUSP?.command.silencerAttached,
});
// fx.muzzle.matrix 是相对 gun 的完整附件矩阵。
// 局部 +X = 枪口向前，+Y = 向上，+Z = 向右。
// 若特效网格沿本地 +Z 建模，接线方先做该网格到附件 +X 的基变换。
// 抛壳传入 gunScene 作为 relativeTo，避免再次套用 camera/gun 变换。
```

| 武器/权威状态 | 枪口附件原名 | 抛壳原名 |
| --- | --- | --- |
| Glock，普通或 burst | `1` | `2` |
| USP，silencerAttached=false | `1` | `2` |
| USP，silencerAttached=true | `muzzle_flash2` | `2` |

USP 两个枪口同属原 muzzle 骨，`muzzle_flash2` 向前偏移 8.700000762939453 Source 单位（约 0.22098 米）。当前固定使用 `1` 会把消音器模式的枪口留在枪管端。不得根据 bodygroup 当前可见性、`draw` 英文名字或替代皮肤判断已经装上消音器。

本次独立原客户端执行证据：`client_client.so` SHA256 `21d2d652a3b2e07c44fa0a3b638886744af9d24ba0c91e64f97a0d8afc43d4cb`。原函数 `0x5e0fb0` 先调用 vtable `+0x840`，其目标 `0x5db8f0` 经 `0x5c9700` 查询原 `has silencer` 属性；为真后再调用 `+0x83c`，原 `0x5db720` 读取 `m_bSilencerOn`（对象 `+0x329d`）。两者为真选择 `muzzle_flash2`，否则选 `1`；没有 viewmodel 返回 -1。

Unicorn 直接执行以上枪口选择函数及原 attached getter：hasSilencer × attached × viewmodel 有无，共 8 个组合；可用 VM 的四个输出依次 `1/1/1/muzzle_flash2`，四个空 VM 输出均 -1。属性 getter 适配成原 items 数据的布尔值，LookupAttachment 适配成记录名字并返回原 MDL 索引；并未声称运行完整原客户端。收据位于本工作树 `output/source-pistol-fx-native.json`。该证据独立于 TypeScript 选择函数。

矩阵验证从已校验原 T/CT Glock/USP 的 `rig.json` 原附件 3×4 矩阵、`original-frames.json` 原骨位置/四元数逐级构造期待值：`inverse(relativeWorld) * rootWorld * C * SourceBoneWorld * SourceAttachment * inverse(C)`，其中 `C=(x,z,-y)`。原 owner 返回值与之比较；使用额外平移/旋转的父物体与参考物体，避免仅在 identity 父节点上通过。四套共 102 个首/中/尾动画采样，每帧核对两种权威模式的枪口和抛壳矩阵及方向。位置/矩阵误差门限 2e-6，方向门限 2e-5；单位取决于输出：位置已在浏览器米制参考空间，方向为单位向量。

验证命令：`npm test -- tests/source-pistol-fx.test.ts`（5 项通过），`npm run typecheck`。此工作树不改 scene/assets/runtime，不启停服务。实际枪口朝向及粒子视觉仍需主目录接线后的浏览器验收。

原粒子资源边界：本地 VPK 目录确认 `particles/weapons/cs_weapon_fx.pcf`（245331 字节）及原 muzzle VMT/VTF 存在。原 items 两枪均引用 `weapon_muzzle_flash_pistol` 与 `weapon_shell_casing_9mm`；USP prefab 没有独立 alt muzzle effect 字段。此模块仅返回这些经过核对的资源名字，`rendererStatus` 明确为 `not-implemented`。原 PCF 算子、控制点、随机种子、材质、粒子寿命、动态光、烟、消音器特殊视觉、弹壳模型及初速度尚未移植；没有加入任意火焰，也没有把既有通用特效称为原效果。完整矩阵纠正的是出生位置与基方向，不等于已复刻抛壳速度或弹道。
