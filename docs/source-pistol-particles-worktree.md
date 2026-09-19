# 原手枪 main / core 粒子切片

这次交付可替换 `weapon_muzzle_flash_pistol` 主闪光的独立 GPU 模块，包含主闪光及其 core 子系统。原 PCF 图、原 VTF 转换的 PNG、原 sheet 动画均实际进入浏览器。它是已核对若干原算子的有界移植，**不是完整 Source 粒子引擎或完整 CS:GO 粒子一致性验收**。未改 `scene.ts`、runtime、共享资源入口，也未启停主 LAN 服务。

## 接线

```ts
import {loadSourcePistolParticleRenderer} from './source-pistol-particles-renderer';
const fx = await loadSourcePistolParticleRenderer('/source/csgo-12426148/pistol-particles/');
scene.add(fx.group);
// 世界空间枪口位置（米）和原附件 +X forward；可直接使用上一轮附件模块的输出。
fx.fire({position: muzzle.position, forward: muzzle.forward}, performance.now() / 1000);
// 每帧使用相同秒时钟。position、forward 在发射时快照，粒子不会黏着后坐中的枪。
const diagnostic = fx.update(performance.now() / 1000);
// diagnostic.counts / dropped / particles 可读回；原参数不可用时抛错，不换成通用火焰。
fx.dispose();
```

- `group` 加到世界空间，不能再放进已有 `.0254` 缩放的 viewmodel 下。模块对粒子的 Source 单位只转换一次。
- 此 API 只代表 `weapon_muzzle_flash_pistol` 的 main/core。Glock/USP 的原粒子系统选择、消音器权威状态、开火时机仍由 root 接线；不能把本图无条件套在另一个消音粒子系统上。
- `fire` 第三个参数可提供 `[0,1)` 随机数函数。默认 `Math.random` 明确属于浏览器表现适配，不声称复刻原全局随机表/调用顺序。
- 每组最多 128 个实例（可显式配置）。main/core 各一个实例化 draw call。超额计入 `dropped`；`clear` 可清空正在播放的 burst。
- 资源目录已完整生成在本工作树 `.reference-assets/source-exports/pistol-particles/`，共约 3.6 MB，可完整复制到上述静态 URL。运行只请求 `graph.json`、`native-defaults.json`、两张 PNG 和 fire sheet；完整目录还包含原文件及验证数据，方便复核。

## 原参数和材料

| 项目 | main | core |
|---|---|---|
| 原系统 | `weapon_muzzle_flash_pistol_main` | `weapon_muzzle_flash_pistol_core` |
| 发射 | 原 instant emitter，4 粒，出生时间 0 | 原 continuous emitter，1200/s，窗口 7 ms；原首步 15 ms 内共 8 粒 |
| 出生时间 | 0、0、0、0 | 原机器码输出 0.875、1.75、2.625、3.5、4.375、5.25、6.125、7 ms（保留 f32 误差） |
| 寿命 | 25 ms | 20–25 ms |
| 位置与运动 | CP0；沿原附件 +X，80–500 Source 单位/s；重力、阻力均为 0 | 出生时间 0–7 ms 映射为 CP0 本地 X 偏移 0–14；无速度 |
| 半径 | 原定义默认 5；Radius Scale 从 1 到 .25 | 出生时间映射 5 到 2 |
| Alpha | 70–80 / 255；最后 15 ms smoothstep 淡出 | 初始化 remap 字段 7（alpha）从 .2 到 0，覆盖前面的 Alpha Random；淡出保留原倒序范围 25→15 ms |
| 纹理 | `effects/muzzleflash4.vtf`，256×256 | `particle/fire_particle_4/fire_particle_4.vtf`，2048×128 |
| 材料 | `particle/particle_muzzleflash4.vmt`：SpriteCard，additive，depthblend=0 | `particle/fire_particle_4/fire_particle_4.vmt`：SpriteCard，addself=1，overbrightfactor=6，depthblend=1 |
| 图集 | 原纹理没有 sheet，使用整张 | 5 个原序列，每个 16 帧；PCF 5–18 按原缺失序列规则全指向序列 0 |

完整图含 **10 个系统、124 个元素、27 类原算子、5 份 VMT、4 份 VTF**。除 main/core 外，保留 5 种烟雾/火花子系统及两个 fallback 的原参数，未声称已执行。余下纹理为 spark 32×64 和 vistasmokev1_emods 1024×1024；烟雾 sheet 有 34 序列/256 帧，完整解码并验证资源边界。

## 依据和验证

原资源为本地 App 740 build **12426148**，PCF SHA-256：
`b41b47e293c06b8b86848904ac0da18909fbc9716df53a2ace5a97e1b7ac8567`。
原 client SHA-256：
`21d2d652a3b2e07c44fa0a3b638886744af9d24ba0c91e64f97a0d8afc43d4cb`。
`graph.json`、`receipt.json` 保留 VPK CRC、原文件 SHA、转换 PNG 的 RGBA SHA、所有原属性类型和引用，不能仅凭系统名字推断执行逻辑。

`probe-source-pistol-particle-defaults.py` 执行原 ELF 中全部 27 个注册算子的 unpack getter，读取原类型及缺省值；只适配 C++ guard acquire/release。数据位于 `native-defaults.json`。`probe-source-pistol-particle-operators.py` 在 Unicorn 中执行以下原机器码，以独立合成四路 SIMD collection / sheet 记录为输入，没有替换这些函数内部算术：

| 原方法 | 地址 | 输出证据 |
|---|---|---|
| Radius Scale post-unpack / operate | `0xd2c0c0` / `0xd0e3d0` | 9 个年龄 × 4 路不同初始半径 |
| Alpha Fade Out post-unpack / operate | `0xd0b830` / `0xd07450` | 9 个年龄 × 4 路不同初始 alpha；等时长、非比例、ease 分支 |
| Instant init / emit | `0xd04af0` / `0xd037a0` | 原 4 粒数量和出生时间 |
| Continuous init / emit | `0xd04190` / `0xd03490` | 原 8 粒数量和 f32 出生时间 |
| CSheet 缺失序列修复块 | `0xf63d22` 至 `0xf64296` | 64 个槽位；缺失槽位 alias 到首个有效序列，绝非取模 |
| Sprite sheet lookup / 插值 | `0xd31ec0` / `0xca2d00` | 10 个时间、512 样本量化、帧 0/1、混合权重及终点夹持 |

原 sheet 标志 `1` 是夹持，`0` 才是循环；采样公式使用原 `512 × animation rate`，由机器码验证。原默认半径 5 来自 particle definition unpack 表 `0x14cbe40` 的 radius 记录。

GPU 的 additive / addself、alpha test、原贴图 sRGB 读取、动画双帧混合参考 Valve 官方 [SpriteCard C++](https://raw.githubusercontent.com/ValveSoftware/source-sdk-2013/master/src/materialsystem/stdshaders/spritecard.cpp) 和 [SpriteCard pixel shader](https://raw.githubusercontent.com/ValveSoftware/source-sdk-2013/master/src/materialsystem/stdshaders/spritecard_ps2x.fxc)。这些是官方 SDK 参考，不能据此声称等于此 CS:GO build 的所有 shader 组合。字段 0/3/7/8 分别为 position/radius/alpha/creation time，与原二进制目标字段及官方 [particle 属性定义](https://raw.githubusercontent.com/ValveSoftware/source-sdk-2013/master/src/public/particles/particles.h) 对应。

验证命令：

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python-exit-code 1 --python scripts/export-source-pistol-particles.py
.tools/source-binary-venv/bin/python scripts/probe-source-pistol-particle-defaults.py
.tools/source-binary-venv/bin/python scripts/probe-source-pistol-particle-operators.py
npx vitest run tests/source-pistol-particles.test.ts
npm run typecheck
node scripts/serve-source-pistol-particles.mjs
```

独立浏览器 `http://127.0.0.1:27024` 支持 main/core 分开观察、时间滑杆和附件方向旋转。实际 Chromium / WebGL 读回：10 ms 为 4 main + 8 core；转动 +90° 后全部位移沿新 forward；40 ms 全部消亡，控制台 0 errors / 0 warnings。7 个专属测试通过，包括原资源 SHA、完整图、原二进制 emitter/radius/alpha/sheet oracle。

证据输出：`output/source-pistol-particles-browser-readback.log`、`output/source-pistol-particle-operators.log`，以及 `output/playwright/source-pistol-main-core-10ms.png`、`source-pistol-main-core-90deg.png`、`source-pistol-core-22ms.png`。

## 尚未恢复的部分

1. 原 collection 随机表、每个初始化算子的随机调用顺序、精确首步调度相位与 minimum-rendered-frames。已执行 emitter 的固定原首步和默认参数；完整 collection 调度没有执行。
2. 零重力、零阻力下的 Movement Basic 用原 Verlet 分支的线性形式求值；完整 force/constraint 路径没有移植。core 随机淡出分支及随机 initializer 尚未逐函数执行；不能把 main 等时长 fade 的证明外推为整个原 RNG 链一致。
3. core 原 SpriteCard depth feathering、原 HDR/tone-map 标定及所有屏幕尺寸淡出组合。当前保留透明度、原图、颜色/加法关系与普通深度测试；没有额外生成火焰或 cone 充当这些缺口。
4. sparks4、smoke_small、三个 shell-eject smoke、两级 fallback。完整参数、材料、原贴图已交付，运行尚未实现。
5. 最终游戏相机、场景曝光、USP 消音模式分发及 LAN 开火事件的集成验收由 root 进行。本工作树的 WebGL 证据不替代最终玩法验收。
