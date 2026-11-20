# 第三方与模板声明

自有源码不因本仓库建立而授予开源许可；第三方代码继续适用原作者许可证，不受自有源码使用限制替代。

- Excel读取：SheetJS CE，见 WORKPAPER_DEPENDENCIES.md 与 dist/workpaper-xlsx-LICENSE.txt；不计算Excel公式。
- PDF读取：见 BIDDER_PDF_TEXT_VENDOR.md 及 dist 内对应许可证。
- ZIP/RAR：见 BIDDER_ARCHIVE_DEPENDENCIES.md；UnRAR另有禁止利用其算法开发RAR压缩器等限制，完整说明在vendor源码头部。
- PDF生成等历史组件：见 QUOTE_ATTACHMENT_STAMPS_VENDOR.md、dist中的许可证。保留历史兼容不代表恢复已被用户取消的盖章功能。
- 旧Office/图像读取器与平台前端组件：保留各vendor文件中的许可与hosting-server/vendor声明。
- 微信支付二维码在服务端使用锁定依赖 `qrcode-generator@2.0.4` 生成，适用 MIT 许可。 [项目与许可证](https://github.com/kazuhikoarase/qrcode-generator)

模板布局和文件索引来自获提供的审计模板，用于当前私有协作。实际底稿原件不在仓库；真实模板的上传、对外发行和商业再利用需确认授权，不把“私有”当成授权证明。
