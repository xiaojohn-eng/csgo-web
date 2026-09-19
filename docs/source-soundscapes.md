# 原作的声场（Dust2 的 57 个 `env_soundscape`）

**现状：端口一条环境音都没接。** 地图用 57 个 `env_soundscape` 把整张图的"底噪"挂在自己身上——风声、远处的城市、隧道里的回响、A/B 包点附近的鸟叫。这是 "特效一样" 里最明显的一块空缺：现在除了枪声和撞击，地图是安静的。

读了什么、没读什么一次说清：**地图的实体、它们指向的定义、引擎判"人在哪个声场里"的那条门、每个听众收到的那个音频块、提交前的那两道比较、它们各自住在哪张表里、以及构建自己那张声级表（30 条 `{int dB; char* name;}`）都读完了；但"同时包含听众的多个声场之间怎么分"和"把声级变成可听半径的算式"没读**。第一道比较读的那个栈槽**没有任何指令写它**（四种独立扫描 + 全二进制 60282 个函数扫描都为负），所以上一轮把它读成"分数到 1.0 者胜"的写法**已撤回**；清单注释里那列 `attenuation` 也**没有任何表装它**，属文档而非数据。本轮只把这些数与这些门入库并校验，**不播任何东西**。

## 地图自己声明了什么

`scripts/probe-source-soundscapes.py` 从冻结的 BSP 自己的 entity lump（lump 0）读一遍，再与既有的 SourceIO 导出逐条对齐（hammerId、origin、radius、名字、`StartDisabled`）：

| 项 | 值 |
| --- | --- |
| 条数 | **57**（全部 `env_soundscape`） |
| 名字 | **18** 个不同（`dust2_new.*`） |
| 半径 | **40** 个不同值，**76 ~ 478**（单位） |
| `StartDisabled` | 全部 **0**（全都开着） |

半径不一致这一点要紧：因为门就是"人在不在球里"，半径不同意味着**同一个点可能落在好几个球里**，选哪个就成了必须回答的问题（而它还没读）。

## 定义从哪来：`.vsc` 其实是文本

`scripts/soundscapes_dust2_new.vsc` 在仓库里被当作"编译格式"很久了，其实它**是纯文本 KeyValues**，只是扩展名不同（探针逐字节断言整份文件都是可打印字符与换行）。21019 字节里是 **20 个顶层块**：

| 项 | 值 |
| --- | --- |
| 顶层块 | **20**（地图用到 **18**，另 2 个只作继承用） |
| 重名 | **`dust2_new.MidDoors` 写了两次**（引擎按键**顺序取第一个**匹配，故第一块生效） |
| 名字大小写 | 地图**全小写**，文件里 **15 个是混合大小写**（`dust2_new.TStart`），所以查找**大小写无关** |
| 继承 | 18 个里 **15 个**用 `playsoundscape` 继承 `dust2_new.outdoors` / `dust2_new.indoors`；**3 个独立**（`LongTunnel` / `lowertunnel` / `topmidtunnel`） |
| `dsp` | 用到 **0, 5, 6, 7, 9, 17, 18, 20, 21, 22** 十个预设 |
| 波表 | **66 处引用 / 55 个不同文件**（11 个文件既被直接写、又被 `~` soundscript 写） |

每个块里是两类条目：

| 条目 | 字段 |
| --- | --- |
| `playlooping` | `volume`、`pitch`、`soundlevel`、`origin`（世界坐标，可省 = 非定位）、`wave` |
| `playrandom` | `time`（间隔区间）、`volume`、`pitch`、`soundlevel`、`origin` 或 `position random`、`rndwave{ wave × N }` |

两个写法细节都当成数据保留：**区间只有一个数就是两端相同**；**`origin` 有时用逗号、有时用空格分隔**；`dust2_new.OutsideTunnel` 有一条 `volume "1,0.5"`——**低端写在高位端之上**，引擎的随机是两端之间插值、不假定顺序，所以端口照原样保留并标 `statedBackwards`（全图仅此一条）。

## 客户端加载哪几份定义

不是按地图名找文件，而是读**引擎自己的一张清单**：`C_SoundscapeSystem::Init`（客户端虚表 `0x20c0f18` 的第 1 项，`0x86edf0`）打开 `scripts/soundscapes_manifest.txt`（走 `GAME` 文件接口），然后遍历它下面每一个 `"file"` 键逐个加载。清单因此是**引擎的**，不是地图的——Dust2 的定义只是恰好在清单里的其中一份。

清单本身也读出三条：

| 项 | 值 |
| --- | --- |
| 根键名 | **`soundscaples_manifest`**（发货文件自己拼错，客户端就问这个拼法，照实记） |
| 条目 | **42** 条生效；**1 条被注释掉**（`soundscapes_nuke.vsc`） |
| 缺件 | 清单里 **`soundscapes_general.vsc` / `soundscapes_tides.vsc` 本机没有**（装了也不存在，端口只知道这件事） |

它的注释里还写着两张表，探针逐行读出（**按行匹配**，否则正则会长过行尾、把下一行的 `//` 吃掉）：**DSP 预设名**（0 `Normal (off)`、5 `Tunnel Small`、9 `Chamber Medium`、22 `Big 3` …共 29 条）与 **`SNDLVL_*` ↔ 衰减**（75dB↔0.8、70dB↔1.0、85dB↔0.6…共 21 条）以及 6 条 `ATTN_*`。

## 定义怎么变成声音

客户端的解析是**两段遍历**，都是键名比较（`stricmp`，故大小写无关）：

- `0x86dcc0`：逐个走子键，名字等于 **`playlooping`** 或 **`playrandom`** 的交给对应的收集器；
- `0x86dc00`：在 `playrandom` 里找 **`rndwave`**，再遍历它的子键取 **`"wave"`** 字符串。

三处都在探针里按地址断言字节，读错位置就失败。

## 门：人得在球里

服务端 `CSoundscapeSystem` 的更新（虚表 `0x19cea38` 第 5 项，`0xa19fe0`）里，对每个声场实体做的是：

```
0xa1a247  movss xmm0, [rax + m_flRadius]     ; 半径
0xa1a256  movaps xmm2, xmm0 / mulss xmm2,xmm0 ; 半径²（不开方）
0xa1a2ed  call 距离平方
0xa1a2fa  comiss xmm1, xmm0                   ; 半径² ? 距离²
0xa1a2fd  jbe 跳过这个玩家                     ; 半径² <= 距离² 就不算
0xa1a314  add word [rax + rbx*4], 1            ; 否则这个玩家多一个候选
0xa1a326  call 0xa1ad00                        ; 把这个声场放进该玩家的列表
```

也就是**严格在球内**（比较的是平方，所以不开方；正好在球面上不算）。这一步就是端口现在能拿出来的全部：`SOURCE_SOUNDSCAPES.candidatesAt(point)`。

字段位置也是从**类自己的 datamap** 里读的（与绳索同一套读法：名字、偏移、类型码、能设它的键）：

| 字段 | 偏移 | 地图键 |
| --- | --- | --- |
| `m_flRadius` | `0x4f8` | `radius` |
| `m_soundscapeName` | `0x500` | （无） |
| `m_positionNames[0..7]` | `0x510`…`0x548` | `position0`…`position7` |
| `m_bDisabled` | `0x554` | `StartDisabled` |
| `m_hProxySoundscape` | `0x550` | （无） |

Dust2 只写 `soundscape`／`radius`／`StartDisabled`／`origin`，`position0..7` 一个都没用。

## 选中的声场怎么送到听众（以及"谁被选中"读到哪一步）

**每个玩家收到一个"音频块"**：引擎把它放在 `DT_Local` 里、按名字是 `m_audio.*`——**八个世界坐标**、然后是**声场号**、一个**位掩码**、一个**实体号**。客户端为本地玩家保留着这一组 prop 名（在它的发送表数据里就是连着的 `m_audio.localSound[7]`／`m_audio.soundscapeIndex`／`m_audio.localBits`／`m_audio.entIndex`／`DT_Local`），服务端在自己那份类表里也注册同一个字段：**偏移 `0x68`、类型 `0x00020001`**，而它周围正是 `localSound`（`0x8`）、`localBits`（`0x6c`）、`entIndex`（`0x70`）。

**写这个块的函数是 `0xa16ca0`（声场实体，听众的音频块）**：

| 它写什么 | 在哪 |
| --- | --- |
| `soundscapeIndex`（`+0x68`） | 取**实体自己的**声场号（`[entity+0x508]`），与块里已有的不同才写（`0xa16d16`／`0xa16d2a`） |
| `entIndex`（`+0x70`） | 取 `[entity+0x50c]`（`0xa16cf0`／`0xa16d0b`） |
| `localSound[0..7]`（`+8+i*12`） | 由实体的 **`m_positionNames[0..7]`**（`0x510…0x548`）解析出位置；名字为空的那一格跳过（`0xa16dbe`），解析到的坐标写进那一格（`0xa16d7d` 起三条 `movss`） |
| 号码不在系统里时 | 打印 **`Setting invalid soundscape, %s, as the active soundscape…`**，名字取 `m_soundscapeName`（`0xa16cdb`） |

**三条路都汇到它**，而且**三条都由表成员资格定身份**（不靠地址相邻）：系统自己的函数 `0xa16eb0`（由 `CSoundscapeSystem` 表第 15 槽的 `0xa190c0` 调起，两次）、`trigger_soundscape` 的触碰处理 `0xa18050`（`CTriggerSoundscape` 表**第 105 槽**）、以及同表的**第 103 槽** `0xa18400`（第二条触发路径）。系统表 `0x19cea38`（18 槽）里**第 5 槽是那条门**（`0xa19fe0`）；`0xa16eb0` 与 `0xa16ca0` **不在任何表里**——它们是系统自己的私有函数。类名本身由构建注册（`0xa166a4`→`CEnvSoundscape`、`0xa16580`→`CEnvSoundscapeProxy`、`0xa17db0`→`CEnvSoundscapeTriggerable`、`0xa181d4`→`CTriggerSoundscape`，逐个断言）。

**遍历的第二个参数（听众记录）是可读的**，因为它由调用方**在自己栈上**搭出来：玩家实体在 `+0`、当前生效的声场在 `+8`、两个浮点在 `+0x10` 与 `+0x1c`、一个计数在 `+0x20`、**而在 `+0x24` 的那个字节由调用方先清零、遍历命中时置 1，调用方回来再据此动作**（`0xa19261` 清零／`0xa17406` 置 1／`0xa173f4` 的调用）。也就是说：**遍历是"每个（声场，玩家）问一次"，调用方消费的是"这个声场有没有成为那个玩家的当前声场"。**

**"谁被选中"读到哪一步——以及上一轮那条结论被撤回**：提交 (commit) 前面有**两道比较**：`movss xmm0, [0x139fc14]`（`.rodata` 里的字就是 **1.0**）→ `comiss xmm0, [rbp - 0x74]` → **还要** `cmp byte [rbp - 0x69], 0`，两道都过才 `call 0xa16ca0`（`0xa173ca`／`0xa173d2`／`0xa173dc`／`0xa173f4`，字节逐个断言）。**但 `[rbp - 0x74]` 这个槽没有任何指令写它。** 这不是"读到一半放弃"，而是**用四种互相独立的方式量出来的**：该函数整个 `0xe9e` 字节线性解码为 **772** 条指令、**首尾严丝合缝**（无空隙也无多解）；这些指令里**没有任何一条存储**落在 `[rbp-0x74, rbp-0x70)` 这四字节上（按各自的操作数宽度算、并跟随帧指针别名 `lea reg, [rbp+k]`）；这两个槽**从未被取地址**；**没有任何分支从函数外跳进它的函数体**；而在全二进制**60282 个函数**上做的同一扫描同样找不到任何一处写它。探针把这四条**全部写成断言**，并且**紧挨着断言两个非空答案**（该函数确实写了四次 `[rbp-0x128]`；调用方确实写了一次它自己的 `[rbp-0x74]`）——**证明扫描是"会答"，而不是"沉默"**。

因此**上一轮记下的那条结论已撤回**——"遍历提交的是**分数恰好等于 1.0** 的那个实体"建立在一个**没有任何指令写过**的栈槽之上，推不出来。站得住的是**形状**：提交在那两道比较之后，而对一张声场全是普通 `env_soundscape` 的地图来说，能到那里的只有这条遍历。引擎自己的调试说明仍印证"同时只有一个生效"：`soundscape_debug` 的说明写着 "Green lines show the active soundscape, red lines show soundscapes that aren't in range, and white lines show soundscapes that are in range, **but not the active soundscape**"。

所以端口这一轮把"**材料**（定义）＋**门**（在球内）＋**提交的两道比较**"入库，**仍不播任何东西**：**同时包含听众的两个声场之间怎么分，没读**。

## 构建自己那张声级表（以及清单注释与它不一致的那一格）

清单的注释是**文档**；构建自己有一张表，两者不是一回事，这一节把两张都读出来并对上。

**表就在 `.data.rel.ro` 的 `0x19ce6c0`**：**30 条**、每条 `0x10` 字节，形状是 `{ int dB; const char* name; }`（`+0` 是 dB、`+8` 是名字指针，每个名字走自己的重定位）。**其中 24 条的名字自带数字**（`SNDLVL_20dB` → 20、…、`SNDLVL_180dB` → 180），所以这张表**能自己校验自己**（探针逐条断言 `名字里的数字 == +0 的 dB`）。所以**一个声级就是一个分贝数，不是某个调音表的索引**：名字查表返回的正是 dB，查不到就落回 **75**。

**全二进制里只有三个读者**（`lea` 目标只有三处，逐个断言）：`0xa14c40` 是**名字→dB**（也接受 `SNDLVL_<数字>dB` 这种文本形式，`0xa14cb0` 起那段），`0xa14dd0` 与 `0xa157f0` 是**dB→名字**——三个都只做名字与 dB 的互转。**没有任何一处读它算音量或距离。**

**两份清单在那一个等级上不一致**（这是本轮的发现，不是噪声）：注释写 `SNDLVL_TALKING = 60`（与 `SNDLVL_IDLE` 同档），**构建自己的表写 80**。21 个被注释提到的等级**全部**在表里找得到（`missingFromBuild` 为空），**只有这一格的数字不同**，探针把这条差异断言成 `{'SNDLVL_TALKING': {'manifestComment': 60, 'build': 80}}`。注释还印了一列 **attenuation**（75dB↔0.8、70dB↔1.0…）——**两个二进制里都没有任何表装它**，所以那一列同样是**文档**，不是数据；端口**不拿它当表用**。

## 没有读到的（因此不能据此播）

| 项 | 为什么不能猜 |
| --- | --- |
| 同时包含听众的多个声场之间怎么分 | 只读到"提交前有两道比较"与"同时只有一个生效"（后者有 `soundscape_debug` 的说明）。**第一道比较读的那个槽（`[rbp-0x74]`）没有任何指令写**（四种独立扫描 + 全二进制 60282 函数扫描都为负），所以**那道比较测的是什么没有建立**——上一轮"分数到 1.0 者胜"的写法已撤回 |
| `soundlevel` 怎么变成可听距离 | **构建自己那张表已读出**（`.data.rel.ro` 的 `0x19ce6c0`，30 条 `{int dB; char* name;}`、24 条名字自带数字、全二进制只有三个读取者且只做 dB↔名字互转），并且**清单注释与它恰好在一个等级上不一致**（`SNDLVL_TALKING`：注释 60、构建 80）；注释里那列 `attenuation` **在任何二进制里都没有对应表**，属文档而非数据。**把等级变成半径的算式仍未读**，故不施加任何衰减曲线 |
| `dsp` 做什么 | 只读到预设号与预设名；引擎的混响没读，所以声场的混响不复现 |

`game/source-soundscapes.ts` 把这三条以 `SOURCE_SOUNDSCAPE_LIMITATIONS` 交给运行时可查，单测钉住条数与内容；装载器只把地图自己的数与定义自己的数搬进来并逐项校验，**不推导任何声音**。

## 入库件与复现

- `scripts/probe-source-soundscapes.py` → `research/source-soundscapes.json`（57 条实体、20 个块与 18 个"地图点到的东西"（含继承合并后的内容）、66 处波引用与它们的 CRC、清单与两张注释表、客户端的加载与解析、服务端的门与 datamap、`boundary`；一路上每条指令的字节都按地址断言）
- `scripts/stage-source-soundscapes.py` → `game/source-soundscape-data.ts`（运行时读的表，含报告与 BSP/客户端/服务端/定义/清单的 SHA 回执）
- `game/source-soundscapes.ts`：装载即校验（格式、定义链、每个地图名字都能解析到一个定义、区间与坐标能解析、每个波都在"已核对过的文件"里、radius 为正、hammerId 唯一），并给出 `candidatesAt()`
- `tests/source-soundscapes.test.ts`：10 条（表与报告逐项比较、57 条实体与 40 个半径、继承与重名、块内数字的两种写法与那条反向区间、门的严格性、波表、清单与两张表、音频块与提交/选择读到哪一步、13 种自相矛盾的表装载即拒绝、`limitations` 条数）

复现：`PYTHONPATH=.tools/source-binary-venv/lib/python3.9/site-packages python3 scripts/probe-source-soundscapes.py`
