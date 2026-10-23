**edsionc.top/teachdemo 部署**

本服务器使用已安装的 `/opt/node-v24.19.0/bin/node`，与其他站点使用的系统默认 Node.js 隔离。依赖中包含要求 Node.js 22.12 以上版本的工具，因此此处固定为 Node.js 24。域名已有 Nginx/TLS，应用独立监听 `127.0.0.1:3327`，由 `teachdemo.service` 守护。服务器安装运行依赖；生产构建在本机完成，避免占用服务器有限内存。

构建前设置 `NEXT_PUBLIC_BASE_PATH=/teachdemo`。该值会写入浏览器产物，运行时也需保持一致。根路径开发可以留空。

生产包只包含 `.next`（排除缓存）、public、教材内容、依赖清单、运行配置及开源字体。不要复制 Windows node_modules 到 Linux。服务器执行 `npm ci --omit=dev --no-audit --no-fund` 安装对应平台运行依赖。

目录：

- `/srv/teachdemo/releases/<release>`：各次发布，保留以便回滚。
- `/srv/teachdemo/current`：当前发布的软链接。
- `/srv/teachdemo/shared/cache`：跨发布的 PDF 缓存。
- `/srv/teachdemo/shared/fonts`：Noto Sans SC TrueType 字体及 OFL 许可。
- `/srv/teachdemo/shared/classroom/classroom.sqlite`：跨发布保留的课堂数据库（包括旁边的 WAL / SHM）。
- `/etc/teachdemo/teachdemo.env`：服务器环境配置，仅 root 可读，不提交密钥。

环境配置中的模型通道为 `MODEL_PROVIDER=agnes`，其余名称见 `.env.example`。字体需要带有 `glyf` 表的 TrueType 文件；服务器已有的 CFF 格式 Noto CJK TTC 无法用于当前 PDF 子集器。Google Fonts 的 Noto Sans SC 可用于此处，许可随包提供。

把 `teachdemo-limits.conf` 安装到 `/etc/nginx/conf.d/`；两个代理片段安装到 `/etc/nginx/snippets/`，只在 `edsionc.top` 对应的 server 块中 include `teachdemo.conf`。代理保留 `/teachdemo` 前缀，关闭缓冲以支持 SSE，接口单独限制速率和并发。上线前备份原配置并运行 `nginx -t`，通过后 reload。

检查与日志：

```bash
curl --fail http://127.0.0.1:3327/teachdemo/api/health
systemctl status teachdemo
journalctl -u teachdemo -n 50 --no-pager
```

更新时先解包、安装依赖并检查新发布，再切换 current；回滚时将 current 指回上一发布并 `systemctl restart teachdemo`。本项目的配置片段不包含现有其他站点配置。

实时课堂的环境、SQLite 迁移、权限、在线备份和恢复步骤见 [classroom.md](classroom.md)。本功能 PR 不执行生产发布。
