# 实时课堂部署

仅支持单个 Next.js Node.js 24 实例；多个 route bundle 分别连接同一个 SQLite 文件。
不使用内存 Map 作为课堂事实来源，也不需要 Redis / WebSocket 服务。

在 `/etc/teachdemo/teachdemo.env` 配置（文件 root:root，0600）：

```dotenv
NEXT_PUBLIC_BASE_PATH=/teachdemo
CLASSROOM_PUBLIC_ORIGIN=https://edsionc.top
CLASSROOM_DB_PATH=/srv/teachdemo/shared/classroom/classroom.sqlite
CLASSROOM_TEACHER_ACCESS_CODE=<管理员生成的高强度随机访问码>
```

访问码只在服务端验证，不写入 NEXT_PUBLIC、二维码、前端产物或日志。
会话使用服务端生成的 256 位随机 token，数据库只保存 SHA-256 摘要；无需额外签名密钥。
教师有效期 30 天，学生 7 天。刷新保留身份；有效会话内重新验证教师访问码会续期并保留所有权。
更换设备或教师会话过期不提供自动找回（首版无账号系统）。共享教师访问码不会共享课堂所有权。

学生先通过 `/api/classroom-participation/session` 确认设备 HttpOnly Cookie 已建立，再请求 `/join`。
首次加入响应丢失后，重试仍使用同一设备 cookie，不能再次计入人数；设备会话本身不授予课堂权限。

`CLASSROOM_PUBLIC_ORIGIN` 仅包含协议、域名和可选端口，不含 `/teachdemo`。
生产要求 HTTPS，拒绝 localhost / 127.0.0.1；开发使用手机可访问的 LAN IP。
basePath 在构建时确定，构建与运行必须一致。

## 目录与权限

安装脚本创建 `shared/classroom`，属主 teachdemo:teachdemo、权限 0750。
数据库不放进 release/current，发布和回滚不复制、不清空数据库。

```bash
install -d -o teachdemo -g teachdemo -m 750 /srv/teachdemo/shared/classroom
runuser -u teachdemo -- test -w /srv/teachdemo/shared/classroom
```

服务首次访问课堂接口时事务创建 schema v1；SQLite 开启 WAL、外键与 5 秒 busy timeout。
systemd `UMask=0027` 使 SQLite/WAL/SHM 仅服务用户与组可读。验证：

```bash
ls -la /srv/teachdemo/shared/classroom/
runuser -u teachdemo -- /opt/node-v24.19.0/bin/node /srv/teachdemo/current/deploy/classroom-db.mjs check /srv/teachdemo/shared/classroom/classroom.sqlite
```

修改 schema 必须递增 user_version，并在短事务里迁移；迁移前做在线备份。
高于当前程序支持的 schema 会拒绝写入，不能把不兼容的旧程序指向新库。
当前版本重复启动不会重建或覆盖表。

## 备份与恢复

在线备份通过 SQLite backup API，包含已提交 WAL 内容，不能只复制运行中的主文件：

```bash
runuser -u teachdemo -- /opt/node-v24.19.0/bin/node /srv/teachdemo/current/deploy/classroom-db.mjs backup /srv/teachdemo/shared/classroom/classroom.sqlite /srv/teachdemo/shared/classroom/backups/classroom-20261020.sqlite
```

恢复时停止服务，先将当前主文件和同名 `-wal` / `-shm` 移到单独的救援目录（保留三者，不混用）。
检查备份 quick_check=ok、foreign_key_check 为空、schema 与待运行程序兼容，然后将备份复制为配置的主文件，
属主 teachdemo:teachdemo、权限 0640，再启动服务。从教师本人有效 cookie 验证名单、轮次与答案。
恢复会回退备份之后的提交；先与授课教师确认。课堂备份包含姓名、学号和作答，按教学数据权限保管。

## Nginx、限额与恢复

沿用代理片段的 `proxy_buffering off`、150 秒超时、X-Real-IP 覆盖。
只有受信的本机 Nginx 可以访问生产监听端口和设置 X-Real-IP，不能直接对公网开放 Node 端口。
现有 AI 的每 IP 3 连接仅限 `/api/chat`、`/api/digest`；课堂路径走通用代理，无该限制。
课堂内部采用会话配额：每学生最多 2 条 SSE、教师 4 条、进程共用数据库租约最多 256 条。
超过配额时客户端退回 4 秒快照拉取；每 IP 入课最多 600 次/分钟，登录 20 次/15 分钟；
每会话修改操作 120 次/分钟。上限为每课 200 人、100 轮、每教师 20 堂未结束课堂，避免无限增长的活跃快照。

每 500 ms 从数据库读取版本变化，变更后读取完整权限快照；约 20 秒心跳。
SSE 的 id 是课堂版本；任何 Last-Event-ID 重连都直接发送最新快照，不依赖无限历史事件。
客户端拒绝旧版本，页面隐藏/卸载/切换视图时关闭连接；恢复时先拉快照。
断开释放定时器和数据库租约，进程异常退出的租约 45 秒后过期。
后台页面恢复和断线时显示连接状态；失败命令不会显示提交成功。

数据库没有自动删除教学记录的定时任务；结束的课堂只读。长期保存策略由部署管理员按教学要求决定。
