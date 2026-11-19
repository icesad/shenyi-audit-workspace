# 审易团队服务 Linux 单机部署候选

部署目标为经授权的单台国内 Linux 主机。Nginx 在 443 接入桌面请求，向 `127.0.0.1:9443` 发起独立 TLS 连接。Node 以专用系统账号运行，SQLite 和配置放在应用发布目录之外。域名、云资源、证书和生产账号由实际开通流程提供。[国内上线时点](COMMERCIALIZATION_ROADMAP.md#4-国内上线手续与时点)

## 构件和目录

在私有工作区以已审定的 Git 提交生成服务构件。保留 `dist/` 中的原有解析器、首位负责人初始化入口、离线备份演练工具和上线检查工具。先选定仓库外且仅发布人员可写的 `$release_dir`。交接时提供归档、独立签名和对应的完整提交，通过独立可信渠道提供验签公钥。 [Git 归档说明](https://git-scm.com/docs/git-archive)

```sh
release=$(git rev-parse --verify HEAD)
git archive --format=tar --output="$release_dir/shenyi-team-${release}.tar" "$release" -- \
  package.json package-lock.json dist shared server/team deploy/linux \
  scripts/start-team-service.mjs scripts/bootstrap-managed-team.mjs scripts/team-database-backup.mjs \
  scripts/check-team-service.mjs \
  docs/LINUX_TEAM_DEPLOYMENT.md docs/MANAGED_TEAM_SERVICE.md docs/TEAM_OFFLINE_BACKUP.md
sha256sum "$release_dir/shenyi-team-${release}.tar"
```

### 发布归档签发与部署验签

发布人员使用独立保存的服务归档 Ed25519 私钥。签发命令核对未压缩 Git TAR 首部的 40 位完整提交标记，并签署发行类型、完整提交、字节数和整包 SHA-256。签名为独立的 64 字节文件。目标路径已存在时保留原文件。 [Git 提交标记](https://git-scm.com/docs/git-get-tar-commit-id) · [Node.js 签名接口](https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptosignalgorithm-data-key-callback)

```sh
node scripts/linux-release-signature.mjs sign \
  --archive "$release_dir/shenyi-team-${release}.tar" --revision "$release" \
  --private-key "$release_private_key" --output "$release_dir/shenyi-team-${release}.ed25519"
```

在 Linux 部署机上，通过已审定渠道把 `scripts/stage-linux-release.py`、`scripts/linux-release-signature.mjs` 和 `scripts/detached-release-signature.mjs` 预置在同一目录。使用 Python 3.11 或更新版及配有 npm 的受信 Node 24.15 或更新的 24.x。按获准的发行记录设置 `$release`，将独立取得的公钥放在归档目录之外。npm 内容缓存放在发布树之外。归档和缓存各限 256 MiB、8,192 个条目，发布卷须为输入副本、解包目录和依赖预留空间。发布人员拥有 `/opt/shenyi-team`，普通用户对该目录和父目录没有写权限。

```sh
/usr/bin/python3 -I /opt/shenyi-team/release-tools/scripts/stage-linux-release.py \
  --node /opt/shenyi-team/node/bin/node --release-root /opt/shenyi-team \
  --archive "$release_dir/shenyi-team-${release}.tar" --revision "$release" \
  --public-key "$release_public_key" --signature "$release_dir/shenyi-team-${release}.ed25519" \
  --npm-cache "$npm_cache"
```

工具将归档复制到权限受控的私有目录，验签后解包同一副本。用独立复制的 `_cacache` 执行离线 `npm ci --omit=dev --ignore-scripts`，回读已安装生产依赖和源文件摘要。所有步骤完成后，才发布只读的 `/opt/shenyi-team/staged-$release`，保留已有同名目录。单独核对标准输出和目录内的 `.shenyi-stage-receipt.json`，回执包含提交、整包和锁文件摘要、公钥指纹及文件数量。失败时无新的候选目录，按错误修正后可重试。进程被强制终止时可能留下 `.shenyi-preparation-*` 工作目录，发布人员可在确认没有暂存任务运行后检查。 [npm 锁定依赖安装](https://docs.npmjs.com/cli/v11/commands/npm-ci/) · [npm 离线模式](https://docs.npmjs.com/cli/v11/using-npm/config/#offline)

发布人员在获准的切换窗口，按下文流程单独停止服务、保留上一版并切换到已核对的候选目录。`current` 及服务配置的各级路径使用实际目录和文件。暂存回执与双路 HTTPS、业务读取和回滚的结果分别归档。 [受管启动约束](MANAGED_TEAM_SERVICE.md)

隔离 Ubuntu 已验证暂存工具拒绝已改动的包、空缓存和重复暂存。补齐缓存后可重试，成功候选的 581 个源文件和 36 个生产依赖一致。输入缓存、SQLite 及运行中的 systemd 和 Nginx 保持，五次双路 HTTPS 检查通过。

先前的独立切换演练用同一签名包启动新的 systemd 进程，后端和 Nginx 边缘 HTTPS 检查通过。原设备继续登录并签名读取同一 2 KiB 原件，SQLite 文件和 21 张业务表摘要保持。两项演练均使用临时签名密钥及合成资料。

| 位置 | 用途与权限 |
| --- | --- |
| `/opt/shenyi-team/node/bin/node` | 由运维固定并校验的 Node 可执行文件 |
| `/opt/shenyi-team/current` | 归 root 管理的当前发布目录，`shenyi-team` 只读 |
| `/etc/shenyi-team` | 仅 root 和 `shenyi-team` 可访问。配置及后端密钥建议 `0640 root:shenyi-team`，目录 `0750` |
| `/var/lib/shenyi-team` | `shenyi-team:shenyi-team` 私有状态目录，模式 `0700`，数据库 `0600`，允许 SQLite 创建附属文件 |
| `/etc/nginx/shenyi-team` | 对外 TLS 证书和私钥、专用于后端的 CA 信任文件。私钥由运维和 Nginx 主进程持有 |

## 受管配置与启动

1. 建立无交互登录的系统账号和同名组 `shenyi-team`。已有受管库按获准的迁移或备份恢复流程单独准备。新环境按受管初始化说明，以 `shenyi-team` 运行离线初始化 CLI，经标准输入传入核验后的数据。使用实际数据库回执中的 `serverId`，将库放到示例指定的文件路径。 [首位产品负责人](MANAGED_TEAM_SERVICE.md#首位产品负责人)
2. 复制 [服务配置示例](../deploy/linux/service.json.example)到 `/etc/shenyi-team/service.json`，替换示例域名和 UUID。将后端证书链和私钥放在示例指定的实际文件。后端叶子证书的 DNS SAN 必须匹配公共域名，Nginx 配置中的后端 CA 必须能验证该链。边缘证书与后端证书使用各自的私钥。短信与恢复按已批准范围另行配置。 [TLS 与短信配置](MANAGED_TEAM_SERVICE.md)
3. 将 [systemd 单元](../deploy/linux/shenyi-team.service)装到 `/etc/systemd/system/shenyi-team.service`。在目标主机先运行 `systemd-analyze verify /etc/systemd/system/shenyi-team.service`，再运行 `systemctl daemon-reload` 和 `systemctl start shenyi-team`。就绪核对通过后，用 `systemctl enable shenyi-team.service` 设置开机启动。下次开机后先观察自动启动状态，再核对 HTTPS 和实例标识。 [systemd 服务与停止](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html) · [systemd 私有状态目录](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html)
4. 使用支持 `ssl_reject_handshake` 和 TLS 1.3 的受支持 Nginx 构建。将 [Nginx 配置](../deploy/linux/nginx-shenyi-team.conf)纳入目标主机的 `http` 配置，统一替换保留示例域名和证书路径。已有默认 443 虚拟主机时，先核对并合并其未知域名拒绝行为，确保同一监听地址只有一个默认虚拟主机。运行 `nginx -t`，通过后按已授权的环境流程加载。安全组及主机防火墙仅开放所需边缘端口，管理入口限授权来源，`9443` 保持仅回环。 [Nginx TLS](https://nginx.org/en/docs/http/ngx_http_ssl_module.html) · [阿里云安全组](https://help.aliyun.com/en/ecs/user-guide/security-groups-for-different-use-cases)

## 端到端验收

从主机直连后端就绪探针。使用实际域名和后端 CA 验证名称及信任链，预期 HTTP 200 和 `{"status":"ready"}`。

```sh
api_host=team.shenyi.example
curl --fail-with-body --silent --show-error \
  --cacert /etc/nginx/shenyi-team/backend-ca.pem \
  --connect-to "${api_host}:443:127.0.0.1:9443" "https://${api_host}/ready"
curl --fail-with-body --silent --show-error --include "https://${api_host}/api/auth/methods"
```

- 公共探针应返回受管实例对应的 `X-Shenyi-Server-Id`，并声明设备绑定必需。公共 `/ready`、`/health` 返回 404，未知域名和非规范 Host 被拒绝。桌面配置须填写同一 HTTPS origin 及 UUID。
- 合成低权限账户经公共入口登录、完成设备证明并读取指派任务，验证其他项目拒绝。覆盖包含百分号编码的查询及有正文的持钥请求。Nginx `proxy_pass` 无 URI 部分，原始路径和查询、应用凭证、请求正文以及服务端签名相关响应头直接通过。 [Nginx 转发语义](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)
- 代理请求上限为 67,125,248 字节，为账表快照的外层 JSON 请求预留编码空间。账表快照原文上限为 32 MiB。底稿导出继续走流式响应，核对下载长度、SHA-256 和中途终止；上传和下载均关闭代理缓冲。运行层按目标主机再验证大文件和并发。
- 使用本机探针和对外诊断分别监测可用性，观察受管进程重启次数、代理 5xx、磁盘空间和证书到期时间。访问日志仅记录时间、请求编号、方法、状态、响应长度和耗时。错误日志可能附带请求上下文，限制读取权限和保留时间。

### 一次性上线检查

在受管主机上使用已部署的配置和 Nginx 验证后端所用的 CA 文件运行以下命令。磁盘阈值和证书到期阈值可省略，默认分别为 10 GiB 和 30 天。

```sh
/opt/shenyi-team/node/bin/node /opt/shenyi-team/current/scripts/check-team-service.mjs \
  --config /etc/shenyi-team/service.json \
  --backend-ca /etc/nginx/shenyi-team/backend-ca.pem \
  --disk-warning-bytes 10737418240 \
  --certificate-warning-days 30
```

探针直连后端回环地址，以配置中的公共主机名和指定后端 CA 校验 TLS，再读取 `/ready` 及 `/api/auth/methods`。它通过运行主机的名称解析和 Node 默认 TLS 信任连接配置中的边缘入口。两侧的 `/api/auth/methods` 均须返回配置的实例 ID 和受管设备登录声明。公共 `/ready` 和 `/health` 均须返回 404。探针分别检查两侧在线叶证书的有效期，确认两侧使用不同的公钥，并从文件系统元数据取得数据库所在卷的可用字节数。每个网络检查最长等待 5 秒。另从实际办公网络验收客户端访问。

| JSON `status` | 退出码 | 含义 |
| --- | --- | --- |
| `healthy` | `0` | 必需检查通过，剩余磁盘和证书有效期均未触发告警。 |
| `warning` | `2` | 必需检查通过，剩余磁盘或证书有效期触发阈值。 |
| `failed` | `1` | 配置、连接、服务实例、路由或其他必要检查失败。 |

输出的 `checks` 可定位具体检查和度量。参数、配置或后端 CA 在检查开始前被拒绝时，输出顶层 `code`。

该命令只对固定路径发出无凭据的只读 GET，读取配置、后端 CA 和文件系统元数据。SQLite 内容和 TLS 私钥字节不在读取范围内，命令不写入文件。该探针可在上线、变更或回滚后手动运行。

## 定时健康检查

使用同一探针的 [检查服务单元](../deploy/linux/shenyi-team-monitor.service) 和 [定时器](../deploy/linux/shenyi-team-monitor.timer)。定时器每五分钟触发一个单次检查，诊断写入 journal。告警退出码 2 保留在日志和进程结果中，systemd 将其作为本次完成处理。必需检查失败时退出码为 1，下一个周期继续观察。监控单元与业务服务分别管理。 [systemd 定时器](https://www.freedesktop.org/software/systemd/man/latest/systemd.timer.html) · [临时用户及运行目录](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html)

按示例部署路径安装两个文件。数据库保持 `0600 shenyi-team:shenyi-team`，由独立于监控的业务账号持有。检查进程通过私有配置与 CA 副本读取所需输入。调整数据库、配置或 CA 路径时，对照正式部署调整监控单元的路径，保留原文件权限。私有证书链通过受控 drop-in 配置公开信任根。

```sh
install -m 0644 /opt/shenyi-team/current/deploy/linux/shenyi-team-monitor.service /etc/systemd/system/
install -m 0644 /opt/shenyi-team/current/deploy/linux/shenyi-team-monitor.timer /etc/systemd/system/
systemd-analyze verify /etc/systemd/system/shenyi-team-monitor.service /etc/systemd/system/shenyi-team-monitor.timer
systemctl daemon-reload
systemctl enable --now shenyi-team-monitor.timer
systemctl list-timers shenyi-team-monitor.timer
journalctl -u shenyi-team-monitor.service -n 30 --no-pager
```

通过服务单元的 drop-in 覆盖 `SHENYI_MONITOR_DISK_WARNING_BYTES` 和 `SHENYI_MONITOR_CERTIFICATE_WARNING_DAYS`。默认分别为 10 GiB 和 30 天。生产监控验收应核对实际阈值、journal 保留和授权告警接收渠道。

## Linux 虚拟机演练

2026-11-19 从提交 `600d603` 生成本页白名单归档，在隔离的 QEMU Ubuntu 24.04.5 LTS 虚拟机运行 Node 24.22.1。原 systemd 单元和 Nginx 配置逐字节部署。16 项检查覆盖配置解析、专用账号及文件权限、回环就绪、边缘 HTTPS 实例标识、健康路由 404、部署自检、手动重启、下线与复启。 [QEMU 下载来源](https://www.qemu.org/download/) · [Ubuntu 云镜像校验](https://ubuntu.com/docs/public-images/public-images-how-to/verify-image-checksum/)

另从演练磁盘的只读父层启动独立副本，读取服务进程的真实、有效、保存及文件系统 UID，核对四者均对应专用账号，`CapEff` 为零且 `NoNewPrivs` 为 1。两个虚拟机均完成正常关机并保持各自父盘摘要一致。

在独立磁盘副本中进一步用现有客户端传输代码完成 Linux HTTPS 持钥采集。单件 12 MiB 达到采集文件上限，另有两个独立账号各上传 2 MiB，实际请求重叠。原有正文格式和客户端超时保持，三次上传均返回 201。上传回执、下载字节及服务重启后 SQLite 原件的 SHA-256 一致，每个任务各保留一条提交和相应的授权、活动记录。演练采用合成设备密钥，测试环境和父盘可独立保留核对。

原桌面客户端使用 15 秒全程期限时，Linux 合成大件演练在收到导入响应前结束连接。Nginx 记为 499，关机后只读检查确认该操作未入库。候选客户端为已验证的账表导入及快照下载使用 90 秒，身份探针、授权、分页和回执等仍用 15 秒。在独立 Ubuntu 副本使用原 systemd 与 Nginx 配置复验，合成账表包含 20,000 行序时账，达到该表行数上限，原文 30,973,981 字节，请求 JSON 32,976,190 字节。两次显式导入均返回 201，其中大件在 Nginx 记录 30.834 秒。分页、原始下载字节、回执和重启后 SQLite 摘要核对一致。

在独立 Ubuntu 副本沿用原 systemd 和 Nginx 配置。用原包校验器审核合成完整包，并在该副本的 SQLite 内准备已保存底稿版本。项目负责人经 HTTPS 持钥验证密码，获得明确查阅和导出权。首次导出在临时文件写入 8,398,028 字节后取消，代理侧也记录到不完整响应。取消未产生最终文件或遗留临时文件。同账号随后正常导出，保存 50,364,569 字节的 ZIP，含 7 件原件。完整请求在该虚拟机约 73.4 秒收到响应头。正常客户端和独立 ZIP 读取器分别核对最终文件大小、SHA-256、成员 CRC 及原件摘要。重启后只读核对底稿业务表保持一致。

在独立 Ubuntu 副本沿用原 systemd 和 Nginx 配置。合成账号正常登录、绑机并提交一件 2 KiB 原件。在首次开机的已就绪实例中，核实服务主进程身份后仅向其发送一次 SIGKILL。systemd 日志记录异常退出和计划自动重启，重启计数增加一次，主进程和调用 ID 更换。从同一磁盘正常关机后冷启动，得到不同的开机 ID，受管服务和 Nginx 由开机流程启动。故障前后及冷启动后的双路 HTTPS 自检均通过。两次恢复后使用原已绑定密钥重新登录并读取提交和原件，服务实例、设备绑定、21 张业务表和原件摘要保持。

新增独立 systemd 定时器和单次检查单元，复用现有双路 HTTPS 探针。探针以临时系统用户运行，读取隔离配置副本和公开后端 CA。数据库路径保留卷元数据检查，原文件权限仍拒绝读取正文。默认每五分钟检查，结果写入 journal。隔离 Ubuntu 用 15 秒周期、合成告警阈值及仅验收使用的退出观察，核对健康、低空间告警、后端停服和恢复。实测记录 6 次不同的定时调用，业务服务由独立操作控制。检查过程中未自动启动业务服务。

在目标云主机上仍需实测防火墙和对外访问、正式证书及 DNS、持钥业务操作、大文件与并发、开机自启及崩溃重启、定时监控。

### Windows 客户端连接 Linux 的验收

在 Windows 本机运行实际 x64 候选客户端，通过仅绑定本机回环地址的端口连接隔离 Ubuntu。Nginx 和后端使用各自的测试证书，客户端仅在自身测试进程加载公开边缘 CA，校验配置中的实例标识。合成实习生首次绑机，只见获指派的任务，并提交 2 KiB 原件。连续两个客户端进程用同一设备和公钥指纹完成登录和下载，两份原件均与源字节一致。两次正常注销后，停服读取 SQLite，确认一次绑定、一次提交和相关会话均已撤销，并检查数据库完整性和外键。文件选取及保存由验收驱动提供合成路径。 [QEMU 回环端口映射说明](https://www.qemu.org/docs/master/system/invocation.html)

首次登录轮次的认证能力探针出现 8 次响应头前的连接拒绝，随后观察到四次额外的同设备持钥验证成功。被标为错误的其余 47 条探针已收到 HTTP 200 和预期实例头。持钥提交、两次下载和两次注销均收到了成功响应。此次覆盖单台 Windows 主机和本机 Linux 虚拟机之间的连接，实际办公网络仍需单独验证。

新版 Windows 候选随后通过可切断的本机回环 TCP 中继连接同一类隔离 Ubuntu 服务。合成提交确认后关闭中继，真实请求未收到响应头而中止，客户端心跳将业务置为暂停并拒绝查阅。恢复中继后通过原设备密钥自动复核，再读回同一提交和原件。两次启动各正常注销，服务停机时核对一个绑定、一次提交、三条已撤销业务租约和两个已撤销的登录会话。本次断链约 3.9 秒后显示暂停，恢复网络约 6.0 秒后恢复业务。本轮覆盖已确认提交后的断链和续接。办公网络、正式签名发行以及响应丢失时的写入核对仍需相应验收。

### 小团队并发实测基线

隔离 Ubuntu 使用 4 vCPU 和 3,072 MiB 客机内存。四笔各 2 MiB 的持钥上传共同在途 0.82 秒，从发送请求到收到响应头为 0.93 至 2.79 秒。使用两名实习生和两名助理的合成身份，保留现有客户端 15 秒采集期限。各账号只读取获指派任务和本人原件。Nginx 记录四次对应的大体积响应，客户端解码后核对四件原件的大小和 SHA-256。八次读取其他账号任务及原件均返回 404。重启停服后，原件 SHA-256 与 SQLite 的持久记录一致。

200 毫秒采样的 Node 峰值 RSS 为 240.2 MiB，正常重启和关闭后 SQLite 文件净增长 8.04 MiB。内存采样范围包含登录、绑机、上传、下载和退出。在试点资源核算时，补入实际团队数和同时在线人数、平均与高位附件大小、月新增资料量、保留周期及备份副本，再按目标主机和办公网络复验。本次原始报告见 `D:/codex-temp/shenyi-m7-linux-capacity-20261119/verification.json`。

## 变更与回滚

停机变更前先停止接入新业务并等待进行中的上传和导出完成。备份代码版本、配置和数据库，核对候选与上一版本均兼容当前库。候选已签名并完成暂存后，在获准窗口用同一可信渠道预置 `scripts/activate-linux-release.py`，以发布管理员身份执行。使用支持 `renameat2` 原子目录交换的 Linux 文件系统，`current` 和候选均使用同一文件系统上的实际目录。 [Linux 目录交换](https://man7.org/linux/man-pages/man2/rename.2.html)

```sh
/usr/bin/python3 -I /opt/shenyi-team/release-tools/scripts/activate-linux-release.py \
  --revision "$release" --archive-sha256 "$approved_archive_sha256" --same-schema
```

`--same-schema` 确认本次切换已核对数据库兼容性。命令沿用暂存锁，核对审批归档摘要、候选回执和只读权限。启动候选后，使用上一版的探针检查两路 HTTPS、实例和进程。原有磁盘和证书临近阈值的提示可保留，新增提示或必要检查失败会停止变更。隔离环境可显式提供 `--edge-ca` 读取受信的边缘 CA，生产公有证书通常使用系统信任。 [systemd 服务状态与重启计数](https://www.freedesktop.org/software/systemd/man/latest/systemctl.html)

返回 `0` 时，旧版保存在 `previous-$release`。候选启动或探针失败且旧版已恢复时返回 `2`，候选保留在 `failed-$release`。两种结果均写入 `activation-$release.json`。返回 `1` 或进程意外退出时，在发布根核对结案回执及 `/opt/shenyi-team/.shenyi-activation.json`。未结案记录及其中的目录设备号和 inode 用于定位当前落位。遇到存储故障或无法证明已安全停服时，核对受管单元、进程、目录和实际库后再处置。SQLite 与配置保留在各自的原路径。

核对一条获准的正常业务操作后再恢复接入。证书更新后重启受管服务以加载后端密钥，重新校验并按目标环境流程加载 Nginx。

隔离 Ubuntu 验证了错误审批摘要在停服前被拒绝。模拟 systemd 启动失败后，原目录恢复，旧版重新启动并通过双路 HTTPS，故障候选留存。另一份测试密钥签名的候选随后成功启用，旧版目录保留。三个 systemd 调用标识各异，Nginx、配置和 SQLite 文件身份及字节保持。

在隔离 Ubuntu 中使用真实 `current` 目录演练 `705b159 → 0b7e1c8 → 705b159`。每次先停受管服务，确认边缘接口返回 502，移动实体目录后重新启动并复核两路 HTTPS。三个服务进程的启动标识各异，两版发布文件按各自归档逐一比对。已有技术管理员以同一设备绑定读取订阅，分别收到无提醒字段、7 天、无提醒字段。已有采集账号以原设备绑定读回 2 KiB 合成原件，原件 SHA-256、SQLite 文件标识和架构、21 张业务表摘要保持一致。最终离线检查通过，虚拟机正常关机。此轮保留现有数据库，覆盖同库架构的应用版本回滚。涉及架构或数据迁移时，先证明上一版本能读取并正确处理迁移后的库。

受管库可通过离线 CLI 加密封存，并在新目录演练恢复。演练副本仅供核对，受管服务会拒绝启动。若回滚应用，切回上一个已验的发布目录，再测服务实例、设备登录与业务持久状态。若需要回滚数据，停服后对当前权威库和拟恢复归档运行 `compare-managed-sealed`。返回 `2` 时先核对已发生变化，返回 `1` 时先查明核验失败原因。任何正式恢复仍须依据可信记录检查快照之后的凭据、设备、撤权、支付和业务状态，并按批准的切换流程处理。 [恢复前核对变化](TEAM_OFFLINE_BACKUP.md#恢复前核对变化)
