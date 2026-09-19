# Source AK 运行时独立审阅

日期：2026-09-08；R3复核更新至2026-09-09（北京时间）。只读审阅 `game/source-viewmodel.ts` 与 `game/source-materials.ts`，必要时沿实际调用点读取 `assets.ts`、`scene.ts` 和 `skins.ts`；未修改这些源码。输入是冻结的原 AK47 + Dust2 T 手臂 GLB，见 [原资源审计](../research/source-weapon-audit.md)。

## 当前发现

**P2已关闭：旧皮肤入口可能显示“已装备”，原AK材质却没有生效。** 原因是Source AK的Phong材质不属于旧coating适用范围，而空bindings仍写选定skin。R3逐行复核确认 `skins.ts` 现在把空bindings结果写为default；`SkinSelector`对 `vandal` 仅列出原版默认并使用default作为装备状态。实际R3七个状态均读回skin=default/paintedMeshes=0，结果与当前原素材显示一致。原paintkit尚未接入，不能把此关闭误解为Aurora或Redline已实现。

**P3已关闭：瞄准取消检视比动画采样晚一帧。** R3 `scene.ts` 先按aim/死亡调用 `cancelSourceInspection`，随后才 `assets.animateWeapon`，消除了该顺序缺陷。GPU回执中inspect1.7999s随后interrupted读回idle/inspect=null；开火和reload原有取消路径保留。

## 已通过的证据

只读 CPU 实际创建当前 SourceViewmodel，对 4 段、25 时点、58 武器骨重新播放，根变换后的骨位置与 `Source(x,y,z) → (−.0254*y,.0254*z,−.0254*x)` 期望最大误差 **4.651×10⁻⁷ 米**。启动检视、开火打断、reload 打断、显式取消均进入预期姿态。reload 首时点仅有 GLB float32 时长误差 **6.358×10⁻⁸ 秒**。[回执](../output/source-runtime-review.json)

使用 SkeletonUtils.clone，没有把武器与手臂的 inverse bind 混成同一套；两个实例的 Skeleton 对象独立。GLB 有 48/58 两个 skin，Three 因手臂两个材质 primitive 实际创建两个 48-bone Skeleton 对象共享该手臂骨树；加上58武器共3个 Skeleton 对象，当前 Set 收集/析构能覆盖它们。这不表示多出一套第三种源骨架。

附件按 `userData.source_attachment.bone` 找原武器 `AK47_flash`、`AK47_shelleject`，不会误取同名手骨。组合 GLB 骨父级已通过独立动态验证，`sourceAttachment(relativeTo)` 的 inverse(parentWorld)×attachmentWorld 坐标关系与调用方一致。

材质参数对照固定 Valve SDK `skin_ps20b.fxc` 和 `common_vertexlitgeneric_dx9.h`：R→`1+149*R` 指数、G→白色与albedo的插值、base alpha→AK `$basemapalphaphongmask`、boost2、Fresnel `[.83,.83,1]`，当前代码对应所引用分支。保持 N·L 因子正确，SDK 的 `SpecularAndRimTerms` 本身也以 N·L 遮罩高光。`controls` 独立 clone 并设 NoColorSpace，释放时不销毁 GameAssets 共享 base/exponent；替换材质仅命中原 AK，未污染手臂材质。

## 仍属已声明限制

- `.0254` 是当前运行时显式米制选择；源 GLB 保 source-unit，没有把工具默认 `.01905` 隐藏烘入骨架。没有原客户端 FOV/尺寸视角校准回执。
- 只播放选定 fire1 和 lookat01 单片段；源 fire2/3、inspect prepare/loop、过渡/取消混合没有重建。没有crossfade会让切换瞬时跳姿，属于当前明确实现边界。
- SDK shader 是公开 Source 2013 参考，不能称此 CS:GO build 的完整 shader。原 `$phongalbedoboost`、局部 env_cubemap、原光照/曝光/tone mapping 仍缺。手臂最初保留SourceIO PBR近似；下述arms修正已增加有据的Phong/lightwarp/direct rim部分，仍不是完整Source环境光重建。
- CPU probe本身不能证明GPU编译或视觉；R3下述实际GPU证据已补充当前AK shader可用。未来Three升级仍需检查ShaderChunk字符串替换成功，不能沿用这次GPU回执。
- 原动画 complete-reload 事件位于1.166667s，完整clip2.433333s；运行时当前把玩法 reload 与完整clip对齐，不能仅凭这点宣称原作补弹逻辑一致。

## R3 实际GPU独立观察

已用本机图像查看工具逐张查看 [idle](../output/playwright/source-ak-before-arms-fix/source-ak-idle-r3.png)、[reload0.7833s](../output/playwright/source-ak-before-arms-fix/source-ak-reload-mid-r3.png)、[inspect1.7999s](../output/playwright/source-ak-before-arms-fix/source-ak-inspect-mid-r3.png)，以及先前reload0.133s和inspect0.2666s。原AK机匣、木件和真实手臂均清晰呈现；中段姿态没有可见的枪与手臂明显分离，原先误用exponent RGB造成的绿色高光已经消失。它们是5张离散姿态证据，不能单独证明整段动作无穿插或与原客户端一致。

独立读取 [source-ak-r3-gpu.json](../output/playwright/source-ak-r3-gpu.json)：errors为空；idle30/90 → fire28/90 → reload0.783333s → 完成30/88 → inspect1.7999s → aim中断idle → Esc后locked=false。该组与较早30→27→30/87的输入脚本是不同一轮，不混用数字。

这组旧图的手指和手套明显湿亮，右拇指与左手套过强高光使当时的手臂材质未通过该局部问题验收；修正结果见下一节。

## R3 arms 修正复核

已独立并排查看相同inspect约1.8s的[修正前](../output/playwright/source-ak-before-arms-fix/source-ak-inspect-mid-r3.png)和[修正后](../output/playwright/source-ak-inspect-mid-r3.png)。左手套恢复黑色织物/皮革细节，右拇指的湿白高光消失，皮肤明暗和颜色与原底图一致性明显改善。没有因材质替换出现枪、手、骨架错位。**过强塑料高光这一局部问题已改善；未据此宣布完整原作材质一致。**

重新只读核对 `source-materials.ts`、`source-viewmodel.ts`、实际原手臂/手套VMT与固定官方SDK：

- normal alpha作为默认Phong mask、AK base alpha作为显式mask，与 `skin_ps20b.fxc` 对应；explicit `$phongtint` 覆盖指数图G的albedo tint分支，skin/glove boost2/.8、Fresnel范围、rim exponent14/10均与本地原VMT相符。
- 两段HalfLambert符合该公开skin shader对 `PixelShaderDoLighting` 的true参数；有lightwarp时使用 `2*warp(.5+.5*NdotL)`，无warp时再平方，与 `DiffuseTerm` 一致。lightwarp保持NoColorSpace符合所引helper的sampler2路径；base为sRGB、normal/exponent为data。
- normal绿色翻转由runtime `normalScale.y=-1` 执行，输入是原VTF PNG；SourceIO的同类导入也在 `convert_normalmap` 翻G，未重复使用已翻绿的导出normal图。
- direct rim先逐灯累加，再与总specular取max，使用指数图A和四次Fresnel，与公开SDK顺序一致。原 `$rimlightboost` 在该SDK用于ambient-cube rim项；当前没有伪造ambient cube，因此未把此boost错误乘进direct rim。
- `replaceRequired` 对ShaderChunk入口失配抛错；三个材质精确按原name匹配并检查替换数量。实例只释放自身material/exponent clone，base/normal/warp的共享生命周期仍由GameAssets管理。双skin、附件寻找、源单位与动作采样逻辑未被材质替换改写。

独立读回 [arms GPU回执](../output/playwright/source-ak-r3-arms-gpu.json)：七个状态均具有3个正确材质身份；fire28/90、完成reload30/88、inspect1.8s、aim后idle、Esc解锁，errors=[]。上述有限分支未发现新的P1/P2。仍保留原ambient/env cubemap、CSGO-specific albedo boost、实际光源与曝光标定，以及inspect循环/过渡等已声明差异。
