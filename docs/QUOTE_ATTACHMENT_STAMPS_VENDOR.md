# 报价附件章签副本：第三方组件与适用范围

- **pdf-lib 1.17.1**, MIT，来源：[上游 tag](https://github.com/Hopding/pdf-lib/tree/v1.17.1)、[npm 原始 tarball](https://registry.npmjs.org/pdf-lib/-/pdf-lib-1.17.1.tgz)。
- tarball SHA256：a7cc1eaf12e41e612a7be581162a63b18118aefc01e90f6a1f35347b1f324a1c；npm SRI：sha512-V/mpyJAoTsN4cnP31vc0wfNA1+p20evqqnap0KLoRUN0Yk/p3wN52DOEsL4oBFcLdb76hlpKPtzJIgo67j/XLw==。
- 原始 package/dist/pdf-lib.min.js SHA256：0f9a5cad07941f0826586c94e089d89b918c46e5c17cf2d5a3c6f666e3bc694f。浏览器构建移除可选 source-map 注释，添加原 MIT 许可与打包运行依赖许可；最终 dist/vendor-quote-pdf-lib.js SHA256：359f87c84f66a51c3b264e95a456731efcb2f21d1419e738f6c1b1532805f395。
- pdf-lib 上游 [v1.17.1 yarn.lock](https://raw.githubusercontent.com/Hopding/pdf-lib/v1.17.1/yarn.lock) 锁定的 tslib 1.11.1、@pdf-lib/upng 1.0.1、@pdf-lib/standard-fonts 1.0.0、pako 1.0.10 与 1.0.11 的授权文本均内联在 vendor 文件顶部；浏览器或单 HTML 构建不会发起 CDN、source-map 或依赖下载请求。

## 副本，不是电子签名

- 只有对具体附件、对应章签种类、页码和位置都明确确认后，才会生成加图副本；原件字节不变。
- 兼容普通 PDF、PNG 和正向 JPEG；图片副本用 PNG。Word、Excel、异常页尺寸、旋转／裁切 PDF、带交互／表单／电子签名的 PDF，不能可靠套用，需人工处理。
- 图样只嵌入选定页面；页角与自定义选框均不能代替人对文字和原图覆盖风险的检查。不把章签原图单独打包。
- 处理限于现有附件输入和副本 3 MiB、页数、对象数量与像素上限；不把技术检查当成文档安全或签章权验证。
