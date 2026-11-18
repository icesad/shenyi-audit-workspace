# 审易团队服务 Linux 单机部署候选

部署目标为经授权的单台国内 Linux 主机。Nginx 在 443 接入桌面请求，向 `127.0.0.1:9443` 发起独立 TLS 连接。Node 以专用系统账号运行，SQLite 和配置放在应用发布目录之外。域名、云资源、证书和生产账号由实际开通流程提供。[国内上线时点](COMMERCIALIZATION_ROADMAP.md#4-国内上线手续与时点)

## 构件和目录

在私有工作区以已审定的 Git 提交生成服务构件。保留 `dist/` 中的原有解析器、首位负责人初始化入口、离线备份演练工具和上线检查工具。文件校验值通过有权限的发布渠道交接。

```sh
release=$(git rev-parse --verify HEAD)
git archive --format=tar --output="shenyi-team-${release}.tar" "$release" -- \
  package.json package-lock.json dist shared server/team deploy/linux \
  scripts/start-team-service.mjs scripts/bootstrap-managed-team.mjs scripts/team-database-backup.mjs \
  scripts/check-team-service.mjs \
  docs/LINUX_TEAM_DEPLOYMENT.md docs/MANAGED_TEAM_SERVICE.md docs/TEAM_OFFLINE_BACKUP.md
sha256sum "shenyi-team-${release}.tar"
```

在暂存发布目录以经过校验的 Node 24.15 或更高版本的 24.x 运行 `npm ci --omit=dev --ignore-scripts`。验收后交由发布人员把代码和依赖置于 root 持有的只读目录。首次配置须使用真实目录，`current` 及服务配置中的文件路径各级均使用实际路径。 [npm 锁定依赖安装](https://docs.npmjs.com/cli/v11/commands/npm-ci/) · [受管启动约束](MANAGED_TEAM_SERVICE.md)

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
3. 将 [systemd 单元](../deploy/linux/shenyi-team.service)装到 `/etc/systemd/system/shenyi-team.service`。在目标主机先运行 `systemd-analyze verify /etc/systemd/system/shenyi-team.service`，再运行 `systemctl daemon-reload` 和 `systemctl start shenyi-team`。就绪核对通过后再设置开机启动。 [systemd 服务与停止](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html) · [systemd 私有状态目录](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html)
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
- 代理请求上限为 67,125,248 字节，对应账表快照的最大请求。底稿导出继续走流式响应，核对下载长度、SHA-256 和中途终止；上传和下载均关闭代理缓冲。运行层按目标主机再验证大文件和并发。
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

该命令只对固定路径发出无凭据的只读 GET，读取配置、后端 CA 和文件系统元数据。SQLite 内容和 TLS 私钥字节不在读取范围内，命令不写入文件。该探针可在上线、变更或回滚后手动运行，定时监控和实际生产环境验收仍待部署时完成。

## Linux 虚拟机演练

2026-11-19 从提交 `600d603` 生成本页白名单归档，在隔离的 QEMU Ubuntu 24.04.5 LTS 虚拟机运行 Node 24.22.1。原 systemd 单元和 Nginx 配置逐字节部署。16 项检查覆盖配置解析、专用账号及文件权限、回环就绪、边缘 HTTPS 实例标识、健康路由 404、部署自检、手动重启、下线与复启。 [QEMU 下载来源](https://www.qemu.org/download/) · [Ubuntu 云镜像校验](https://ubuntu.com/docs/public-images/public-images-how-to/verify-image-checksum/)

另从演练磁盘的只读父层启动独立副本，读取服务进程的真实、有效、保存及文件系统 UID，核对四者均对应专用账号，`CapEff` 为零且 `NoNewPrivs` 为 1。两个虚拟机均完成正常关机并保持各自父盘摘要一致。

在独立磁盘副本中进一步用现有客户端传输代码完成 Linux HTTPS 持钥采集。单件 12 MiB 达到采集文件上限，另有两个独立账号各上传 2 MiB，实际请求重叠。原有正文格式和客户端超时保持，三次上传均返回 201。上传回执、下载字节及服务重启后 SQLite 原件的 SHA-256 一致，每个任务各保留一条提交和相应的授权、活动记录。演练采用合成设备密钥，测试环境和父盘可独立保留核对。

在目标云主机上仍需实测防火墙和对外访问、正式证书及 DNS、持钥业务操作、大文件与并发、开机自启及崩溃重启、定时监控。

## 变更与回滚

停机变更前先停止接入新业务并等待进行中的上传和导出完成。备份代码版本、配置和数据库，确认上一版本可读取当前库。启用新版本时先停受管服务，再在同一文件系统中移动实际发布目录到 `current`，先测本机 TLS 就绪，再测代理和一条正常业务操作。证书更新后重启受管服务以加载后端密钥，重新校验并按目标环境流程加载 Nginx。

受管库可通过离线 CLI 加密封存，并在新目录演练恢复。演练副本仅供核对，受管服务会拒绝启动。若回滚应用，切回上一个已验的发布目录，再测服务实例、设备登录与业务持久状态。若需要回滚数据，停服后对当前权威库和拟恢复归档运行 `compare-managed-sealed`。返回 `2` 时先核对已发生变化，返回 `1` 时先查明核验失败原因。任何正式恢复仍须依据可信记录检查快照之后的凭据、设备、撤权、支付和业务状态，并按批准的切换流程处理。 [恢复前核对变化](TEAM_OFFLINE_BACKUP.md#恢复前核对变化)
