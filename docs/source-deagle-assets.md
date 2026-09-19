# 沙漠之鹰原资产增量

来源为本机已核对的 App740、build 12426148：`models/weapons/v_pist_deagle.mdl`、`w_pist_deagle.mdl`、原 `t_arms` / `ct_arms_idf`。沿用原 PISTOL 人物动画族与 T/CT 身体模型，原始 VMT、纹理、声音、动画事件、逆绑定矩阵和 Source 单位均保留。没有创建替代模型或改动已有装备入口。

| 资产 | 内容 |
| --- | --- |
| T/CT 第一人称 | 每套 57 枪骨、48 手骨、47 同名骨绑定、34 加权手骨；9 条原序列，共 639 原帧 |
| 世界枪 | 93 骨、13 序列，包含 5 个原九向瞄准层，原弹匣及附件 |
| T/CT 人物 | 71 / 74 身体骨与独立 93 骨世界枪，通过 3 个原同名骨进行世界矩阵绑定 |
| 声音 | 22 个事件别名、21 个原 WAV；两条检视动作的全部音效时间线；原增益及 pitch 范围 |

第一人称序列为 `idle1`、`shoot1`、`shoot2`、`shoot3`、`shoot_empty`、`reload`、`draw`、`lookat01`、`lookat02`。`shoot_empty` 原 activity 为 `ACT_VM_DRYFIRE`；换弹包含 `AE_WPN_COMPLETE_RELOAD`，cycle 为 `0.39393940567970276`，序列时长 2.2 秒。原数据中的未注册 event / activity 编号没有被猜测替换，正式运行由主任务的原注册与命令模块处理。

接线 API：

```ts
import {loadSourceDeagleViewmodel} from './source-deagle-viewmodel';
import {loadSourceDeagleCharacter} from './source-deagle-character';
import {loadSourceDeagleAudio} from './source-deagle-audio';

const fp = await loadSourceDeagleViewmodel({team: 't', signal});
const viewmodel = fp.createViewmodel();
fp.sampleViewmodel(viewmodel, {sequence: 'reload', timeSeconds: .8});
// fp.manifest / profile / hashVerified / disposeViewmodel / dispose

const character = await loadSourceDeagleCharacter({team: 'ct', signal});
const actor = character.createActor();
character.updateActor(actor, authoritativePlayer);
// authoritativePlayer 仍使用 sourcePistolPose，须匹配 manifest.poseVersion。
// character.poseIndex / attachment / disposeActor / dispose

const sounds = await loadSourceDeagleAudio(audioEngine, {signal});
sounds.event('Weapon_DEagle.Single', .9);
// sounds.timeline[sequence] 交给调用方原动作游标派发；不在每帧重复播放。
// sounds.hashVerified / records / dispose
```

两个模型 owner 支持 `baseUrl`、`signal`、`loadingManager`。默认地址为 `/source/csgo-12426148/deagle-{team}` 和 `/source/csgo-12426148/character-{team}-deagle`。音频 owner 使用清单中的本机服务地址，加载阶段核对每个 WAV 的 SHA 后解码相同文件一次；销毁时仅删除自己仍持有的缓冲别名。调用方负责已接受射击、预测去重和音效时间游标。

`game/source-deagle-character-pose.ts` 提供独立的原 Deagle world / character prepare 和 sample 方法。结构与现有手枪 pose 输入一致，但数据身份严格为 Deagle，不把 Deagle 数据伪装成 Glock 或 USP。为避免并行工作树冲突，本批没有改动公共类型和现有 owner；后续可在统一集成时抽取经验证的公共部分。

验证记录：

- 两套第一人称独立 Three.js 回读各 639 帧、36,423 枪骨矩阵、30,672 手骨矩阵、1,278 附件矩阵；最大矩阵分量误差 `0.0000453882` Source 单位，所有原 float32 逆绑定矩阵逐值一致。
- 世界图与独立 Python / mathutils 参考比较 77 组输入及 45 个原九向角点；T/CT 合计 120 组完整人物 / 世界枪 pose，并用实际 Three skin 顶点验证。
- `npm test -- tests/source-deagle-owner.test.ts tests/source-deagle-world-pose.test.ts tests/source-deagle-character-pose.test.ts tests/source-deagle-character-owner.test.ts tests/source-deagle-audio.test.ts`：5 文件、18 项通过，覆盖原文件哈希、独立克隆、损坏文件拒绝、取消和释放。
- `npm run typecheck` 通过。4 个已暂存 GLB 与独立 world GLB 均通过 Khronos 检验，0 errors；原材质转换仍有 2–3 个 warnings，详见 `output/deagle-gltf-validation.json`。

交接清单 `docs/source-deagle-asset-files.json` 列出所有未纳入 Git 的目标文件、字节数、SHA256：104 个 public 文件，加上独立私有参考与证据，共 220 文件，306,968,895 字节。只复制清单所列文件，复制后逐 SHA 核对。公共路径均为本批独立 `deagle-*` / `character-*-deagle` 目录；`.reference-assets/source-exports/deagle-candidates` 供测试读取。原 archive、工具和共享依赖不在交接范围内。

生成流程：先运行 `inventory-source-deagle.py`，再分别以 Blender 工厂进程运行 `import-source-deagle-viewmodel.py -- --weapon deagle --team t/ct`；`finalize-source-deagle.py` 只移除未使用的零 tangent 语义，不改变任何 BIN 字节；复用 `validate-source-pistol.mjs <candidate>` 做独立数值回读，之后运行 `stage-source-deagle.py`、`stage-source-deagle-audio.py`。第三人称依次运行 world import、finalize、world pose export / reference、character assembly / reference、专属 pose tests、character stage。所有专属脚本通过带 token 检查的适配器复用现有已审计导入程序，不修改其源码。

本次是可接线的原资产增量。尚未完成主运行时装备接线、真人检视 / 听音和 WebGL 画面验收。原引擎完整 AnimState、IK、随机检视与射击变体选择由主任务继续处理。材质已使用原 Deagle boost 1、Fresnel `[.8,.8,1]`，`phongalbedoboost 40`、原环境 cubemap 和完整声场仍是现有材质 / 声音管线的未完成部分，不声称已达到原客户端画面等价。
