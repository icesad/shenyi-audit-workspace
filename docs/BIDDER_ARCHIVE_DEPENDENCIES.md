# 投标资料压缩包：本机读取与第三方组件声明

- `dist/bidder-archive.js` 是本项目实现。RAR 5 的结构预检按 [RARLAB 官方格式规范](https://www.rarlab.com/technote.htm) 编写；ZIP 目录与本地头一致性、路径、条目数、展开体积和 CRC 由本项目检查，deflate 使用浏览器 DecompressionStream。
- `dist/bidder-archive-vendor.js` 从 [node-unrar-js v2.0.2](https://github.com/YuJianrong/node-unrar.js/tree/v2.0.2) 的官方 npm 发布包取 ESM 源和 WebAssembly。将 ESM 依赖按序合并为独立 Worker 源字符串，将 wasm 原字节转换成 Base64，移除 sourcemap 注释，限制 JS 出口的累计单文件写入为 32 MiB、Emscripten JS 堆增长为 256 MiB。未加入任何 RAR 压缩或创建功能。MIT 与 RARLAB UnRAR 6.1.7 的完整许可文本均在该文件顶部，内联 HTML 也保留。
- 上游来源：`https://registry.npmjs.org/node-unrar-js/-/node-unrar-js-2.0.2.tgz`。完整包 SHA-512（npm SRI）`sha512-hLNmoJzqaKJnod8yiTVGe9hnlNRHotUi0CreSv/8HtfRi/3JnRC8DvsmKfeGGguRjTEulhZK6zXX5PXoVuDZ2w==`；包 SHA-256 `1b51694eaab2f883b294171e0ef5a9bfd88100db528b0773121ec85c3dfaa2a1`。包内 `esm/js/unrar.wasm` SHA-256 `c7d79f869196e3c79c053ba74a8f629116de8293a94f60cc851bbcd7977d0c2b`。
- UnRAR 6.1.7 源包由包内构建清单指定 [RARLAB 官方来源](https://www.rarlab.com/rar/unrarsrc-6.1.7.tar.gz)，下载件 SHA-256 `de75b6136958173fdfc530d38a0145b72342cf0d3842bf7bb120d336602d88ed`，其中 `unrar/license.txt` 用于上述内联许可。并未声称重编或审计了上游 wasm。
- 生成资产 SHA-256：`5df6a3f14d0292e4c50ec564c326d538be8e4f68470f037aa5a2566f32f46985`。

## 边界

仅支持单卷、未加密的普通 RAR 5（算法版本 0、字典不超过 64 MiB）与 UTF-8 文件名 ZIP（Store / Deflate）。不支持自解压、旧 RAR 4、加密、分卷、ZIP64、其他算法、目录遍历路径、路径冲突和链接。RAR Quick Open Locator 在解码前仅在内存副本中停用，避免第二份头部缓存遮蔽已核对的原始头部；用户原文件未被写入。

先解析清单，只读取经调用方选中的文件。压缩包最大 160 MiB、声明展开总量不超过 512 MiB、最多 512 条；每次选读最多 64 项，单项不超过 32 MiB、合计不超过 64 MiB。Worker 每次打开/读取限时 45 秒，可取消，关闭即销毁 Worker。没有数据传到远程服务、没有将压缩包或展开件写到文件系统，也不执行归档内容。浏览器自身内存和资源仍有上限；请使用获授权来源，不将这些检查当作恶意文件检测。

网页若另设 CSP，Worker 需要 `worker-src blob:`，RAR 的 WebAssembly 需要 `script-src` 的 `'wasm-unsafe-eval'`；不要求启用 JavaScript 的 `'unsafe-eval'`。离线单 HTML 只需按先 vendor、后读取器的顺序内联，不需要安装、发请求或附加 wasm 文件。

