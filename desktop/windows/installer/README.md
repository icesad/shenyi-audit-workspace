# 审易工作台内测安装程序

供两位负责人用虚构资料核对六个业务模块。双击 Setup.exe，用当前 Windows 用户完成安装，再从开始菜单打开「审易工作台（内测）」。本候选包尚未签名，官网正式下载另走发布审核。

## 交给开发人员复建

在 Windows x64 上用仓库指定的 Node 24。下载并保留两份原版 ZIP。

| 构建输入 | SHA-256 |
| --- | --- |
| [Electron 45.3.2 Windows x64](https://github.com/electron/electron/releases/download/v45.3.2/electron-v45.3.2-win32-x64.zip) | `cd1ab0d49c2f76838c0c9ff75afefb4d9d85ca59036691932bf35be8eceba98b` |
| [NSIS 3.13 便携编译器](https://sourceforge.net/projects/nsis/files/NSIS%203/3.13/nsis-3.13.zip/download) | `ba63dffc4410ee89193e1cb5a41989991bd77c61068da17e3156d136b7b0b3d8` |

在仓库根目录执行以下命令，最后一个参数使用仓库外尚不存在的文件。构建脚本先验证两份归档，重用工作台构建入口从当前 Git HEAD 提取六模块页面，并写出安装文件与包含版本、构建号、文件数、SHA-256 的 JSON 结果。

```powershell
node desktop/windows/installer/build.mjs D:\build\electron-v45.3.2-win32-x64.zip D:\build\nsis-3.13.zip D:\build\Shenyi-Internal-Setup.exe
```

## 升级与卸载

每个构建安装到 `%LOCALAPPDATA%\Programs\ShenyiWorkbenchPreview\<构建号>`。构建号由应用版本与载荷摘要组成。重复安装同一构建可补回缺失文件。安装另一构建会更新开始菜单的常用入口，旧版仍可从「审易工作台内测版本」打开。两版共用当前用户的内测工作区。

从 Windows 的「已安装的应用」选择对应构建卸载。卸载只移除该构建随附的文件及快捷方式。卸载当前版后，可从版本菜单打开仍安装的其他构建。测试业务数据保存在 `%APPDATA%\Shenyi-Workbench-LocalReview`，如需清空请另行备份和处理。

一次性 Windows 测试机可运行 `Setup.exe /S` 静默安装，运行 `<安装目录>\Uninstall.exe /S` 静默卸载。升级验收需在旧版创建一份虚构业务记录，再安装新版、运行新版、卸载旧版，以实际界面核对该记录。仅解包检查无法替代这一项。
