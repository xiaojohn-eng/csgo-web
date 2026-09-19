# 原 T / CT 第一人称资源 owner

新增 `game/source-t-viewmodel.ts` 与 `game/source-ct-viewmodel.ts` 提供相同生命周期入口。原 T GLB、材质、四段动画和九张原 PNG 没有改动；CT 的来源与完整骨骼/材质验收见 `source-ct-viewmodel.md`。

```ts
const t = await loadSourceTViewmodel({ signal });
const ct = await loadSourceCTViewmodel({ signal });
const owner = player.team === 'blue' ? ct : t; // 实际队伍枚举由 GameAssets 决定
const viewmodel = owner.createViewmodel();
// 共用原 updateSourceViewmodel / sourceAttachment / inspection API
owner.disposeViewmodel(viewmodel); // 只销毁一个副本
owner.dispose(); // 销毁其余副本、共享模型与纹理，可重复调用
```

API 均返回 `{gltf,manifest,hashVerified:true,profile,createViewmodel,disposeViewmodel,dispose}`，可选参数 `{baseUrl,signal,loadingManager}`。T 默认 `/source/csgo-12426148/ak47`，读现有 `provenance.json`；CT 默认 `/source/csgo-12426148/ak47-ct`，读新 `manifest.json`。队伍选择属于调用方，loader 不猜队伍、不复用另一个手臂 profile。

T 的 GLB SHA 固定 `e29d4e64a7a204a8d80bd9c338f12078609f2d4cb38feadadffe04dd93833ee7`，T48/AK58 skin 名和骨数必须匹配。下载一个 GLB + 9 个 PNG（AK2、原裸臂3+warp1、原露指手套3），每个 payload 先长度/SHA 校验，再解码；不在本 owner 加载同目录五条音效，声音仍由既有音频资源合同消费。T 不挂 CT 的 runtime 骨合并 hook。

两个 owner 都用 shared `sourceSha256`，HTTP LAN 缺 WebCrypto 走已有 noble fallback，`hashVerified` 不降级。PNG `flipY=false`；base 为 sRGB，normal/exponent/warp 为 NoColorSpace；skin_gradient 独用 ClampToEdge，其余 Repeat。Promise.allSettled 等全部并发分支结束后统一处理失败，避免某一路失败早退但其他纹理稍后继续入内存。每个已返回 Texture/GLTF 的资源被去重回收；Blob URL 在 finally 回收，abort 在下载、hash、图像解码后检查。GLTFLoader 内部在其自身抛错之前尚未返回的内部资源，不属于本 owner 可直接获取的对象；未声称覆盖浏览器所有解码器内部行为。

`tests/source-viewmodel-owner.test.ts` 用原 staged 模型和 PNG bytes，在 CPU 仅替换图像解码器与 GLTF 的材质图片读取；源几何/骨架/动作仍真实。5项覆盖 T/CT 的 HTTP SHA fallback、双实例隔离/一次释放/重复dispose、一个 PNG 末字节篡改后的 allSettled 清理，以及解码后 abort。与 `tests/source-ct-viewmodel.test.ts` 共10/10通过，日志 `output/source-viewmodel-owner-tests.log`。这证明资源/动画/材质参数合同，真实 GPU 编译和输入操作由主任务另验收。

未直接修改 GameAssets/Scene/runtime；主任务按 owner 接入。旧 `createSourceViewmodel(gltf,base,exp,arms)` 默认 T 四参 API 保持；新第五参 CT profile 仅增加材质身份和 after-sample 精确骨合并。

最终检查：2026-09-09 03:46 本机两组专项 10/10、全仓 `tsc --noEmit` 通过；CT staged 10 文件逐字节长度/SHA 回读通过。
