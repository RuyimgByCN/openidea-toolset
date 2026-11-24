import { useMemo, useState } from "react";
import { copyToClipboard } from "../bridge";
import { tx } from "../i18n";
import type { ToolProps } from "../types";

type SheetId =
  | "git"
  | "docker"
  | "k8s"
  | "linux"
  | "sql"
  | "jvm"
  | "network"
  | "http"
  | "mime"
  | "ascii"
  | "regex"
  | "cron"
  | "chmod";

export interface CheatEntry {
  cmd: string;
  descEn: string;
  descZh: string;
}

export const COMMAND_SHEETS: Record<Exclude<SheetId, "http" | "ascii" | "chmod">, CheatEntry[]> = {
  git: [
    {
      cmd: "git status -sb",
      descEn: "Compact working tree & branch status",
      descZh: "精简查看工作区变更与当前分支状态",
    },
    {
      cmd: "git switch -c feat/name",
      descEn: "Create and switch to new branch",
      descZh: "创建并切换到新分支",
    },
    {
      cmd: "git rebase -i HEAD~5",
      descEn: "Interactive rebase / squash last 5 commits",
      descZh: "交互式变基或合并压缩最近 5 次提交",
    },
    {
      cmd: "git reset --soft HEAD~1",
      descEn: "Undo last commit keeping staged changes",
      descZh: "撤销最近一次提交并保留暂存区改动",
    },
    {
      cmd: "git cherry-pick <sha>",
      descEn: "Apply specific commit onto current branch",
      descZh: "将指定提交挑选并应用到当前分支",
    },
    {
      cmd: "git stash push -m \"wip\" -u",
      descEn: "Stash tracked and untracked files",
      descZh: "暂存已跟踪及未跟踪文件并附加备注",
    },
    {
      cmd: "git log --oneline --graph -20",
      descEn: "Compact commit DAG graph",
      descZh: "以精简图形化方式查看最近 20 条提交历史",
    },
    {
      cmd: "git bisect start HEAD v1.0",
      descEn: "Binary search commit that introduced a bug",
      descZh: "通过二分查找定位引入缺陷的提交",
    },
    {
      cmd: "git worktree add ../wt branch",
      descEn: "Checkout branch in parallel folder",
      descZh: "在相邻目录同时检出另一分支进行并行开发",
    },
    {
      cmd: "git clean -fd",
      descEn: "Remove untracked files and directories",
      descZh: "强制清理工作区未跟踪的文件与目录",
    },
  ],
  docker: [
    {
      cmd: "docker ps -a --format \"table {{.Names}}\\t{{.Status}}\\t{{.Ports}}\"",
      descEn: "List containers with formatted columns",
      descZh: "按指定列格式化列出所有容器（名称/状态/端口）",
    },
    {
      cmd: "docker exec -it <container> sh",
      descEn: "Open shell inside running container",
      descZh: "进入正在运行的容器打开交互式终端",
    },
    {
      cmd: "docker logs -f --tail 200 <container>",
      descEn: "Tail live container logs",
      descZh: "实时追踪容器最近 200 行日志输出",
    },
    {
      cmd: "docker compose up -d --build",
      descEn: "Rebuild and detach compose services",
      descZh: "重新构建镜像并在后台启动 Compose 服务",
    },
    {
      cmd: "docker buildx build --platform linux/amd64,linux/arm64 -t img:tag .",
      descEn: "Multi-arch image build",
      descZh: "跨平台构建多架构（amd64/arm64）镜像",
    },
    {
      cmd: "docker system df",
      descEn: "Inspect images, containers & volumes disk usage",
      descZh: "查看镜像、容器与数据卷磁盘占用情况",
    },
    {
      cmd: "docker system prune -af --volumes",
      descEn: "Clean unused images, containers & volumes",
      descZh: "彻底清理未使用的镜像、容器及挂载卷",
    },
    {
      cmd: "docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' <id>",
      descEn: "Print container IP",
      descZh: "输出指定容器的网络 IP 地址",
    },
  ],
  k8s: [
    {
      cmd: "kubectl get pods -A -o wide",
      descEn: "List pods across all namespaces with nodes & IPs",
      descZh: "列出所有命名空间下的 Pod 及其所在节点与 IP",
    },
    {
      cmd: "kubectl logs -f -n <ns> deploy/<name> --tail=100",
      descEn: "Follow Deployment logs",
      descZh: "实时追踪指定命名空间 Deployment 最近 100 行日志",
    },
    {
      cmd: "kubectl exec -it -n <ns> pod/<name> -- sh",
      descEn: "Shell into Pod container",
      descZh: "进入指定 Pod 容器内执行交互式 Shell",
    },
    {
      cmd: "kubectl port-forward -n <ns> svc/<name> 8080:80",
      descEn: "Forward local 8080 to service port 80",
      descZh: "将本地 8080 端口转发至集群 Service 的 80 端口",
    },
    {
      cmd: "kubectl rollout restart deployment/<name> -n <ns>",
      descEn: "Trigger rolling restart",
      descZh: "触发 Deployment 滚动重启所有副本",
    },
    {
      cmd: "kubectl top pods -A --sort-by=memory",
      descEn: "Show highest memory pods",
      descZh: "按内存占用从高到低展示所有 Pod 资源消耗",
    },
    {
      cmd: "kubectl describe pod <name> -n <ns>",
      descEn: "Inspect pod events and scheduling errors",
      descZh: "查看 Pod 详情、事件记录及调度异常原因",
    },
    {
      cmd: "kubectl get events -A --sort-by='.lastTimestamp'",
      descEn: "Chronological cluster events",
      descZh: "按时间顺序列出集群全局事件",
    },
  ],
  linux: [
    {
      cmd: "lsof -i :8080 -P -n",
      descEn: "Find process listening on TCP/UDP port 8080",
      descZh: "排查占用 TCP/UDP 8080 端口的进程",
    },
    {
      cmd: "ps aux --sort=-%mem | head -20",
      descEn: "Top 20 processes by RSS memory (Linux)",
      descZh: "列出物理内存占用最高的前 20 个进程（Linux）",
    },
    {
      cmd: "rg -n \"pattern\" src/",
      descEn: "Fast recursive search with ripgrep",
      descZh: "使用 ripgrep 高速递归检索源码并显示行号",
    },
    {
      cmd: "tar -czvf archive.tar.gz dir/",
      descEn: "Create gzip archive",
      descZh: "将目录打包并压缩为 .tar.gz 归档文件",
    },
    {
      cmd: "tar -xzvf archive.tar.gz -C dest/",
      descEn: "Extract gzip archive",
      descZh: "解压 .tar.gz 归档文件到目标目录",
    },
    {
      cmd: "du -sh * | sort -hr | head -20",
      descEn: "Largest directories/files in current folder",
      descZh: "统计并降序显示当前目录体积最大的前 20 项",
    },
    {
      cmd: "rsync -avz --progress src/ user@host:/dest/",
      descEn: "Incremental sync over SSH",
      descZh: "通过 SSH 增量压缩同步目录并显示传输进度",
    },
    {
      cmd: "ssh -L 5432:127.0.0.1:5432 bastion -N",
      descEn: "Local SSH port-forward tunnel",
      descZh: "通过跳板机建立本地端口转发 SSH 隧道",
    },
    {
      cmd: "systemd-analyze blame",
      descEn: "Inspect systemd boot service times",
      descZh: "分析 Linux 系统启动时各 systemd 服务耗时",
    },
  ],
  sql: [
    {
      cmd: "EXPLAIN ANALYZE SELECT ...",
      descEn: "Inspect real execution plan & timing",
      descZh: "查看 SQL 实际执行计划与各阶段耗时统计",
    },
    {
      cmd: "SELECT id, ROW_NUMBER() OVER (PARTITION BY dept ORDER BY salary DESC) AS rn FROM emp;",
      descEn: "Window function ranking",
      descZh: "窗口函数分组排序生成组内排名序号",
    },
    {
      cmd: "INSERT INTO t(id, val) VALUES (1, 'a') ON CONFLICT (id) DO UPDATE SET val = EXCLUDED.val;",
      descEn: "PostgreSQL Upsert",
      descZh: "PostgreSQL 冲突更新（存在则更新，否则插入）",
    },
    {
      cmd: "INSERT INTO t(id, val) VALUES (1, 'a') ON DUPLICATE KEY UPDATE val = VALUES(val);",
      descEn: "MySQL Upsert",
      descZh: "MySQL 主键/唯一键冲突更新（Upsert）",
    },
    {
      cmd: "WITH cte AS (SELECT ...) SELECT * FROM cte;",
      descEn: "Common Table Expression (CTE)",
      descZh: "公用表表达式 (CTE) 拆分复用复杂查询",
    },
    {
      cmd: "SHOW FULL PROCESSLIST;",
      descEn: "List active MySQL threads & queries",
      descZh: "查看 MySQL 当前活跃连接线程及正在执行的语句",
    },
    {
      cmd: "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state = 'idle in transaction';",
      descEn: "Terminate stuck PostgreSQL idle tx",
      descZh: "终止 PostgreSQL 中长期处于空闲事务状态的阻塞会话",
    },
  ],
  jvm: [
    {
      cmd: "./mvnw clean verify -DskipTests=false",
      descEn: "Maven wrapper build and verify",
      descZh: "使用 Maven Wrapper 执行清理构建与完整测试校验",
    },
    {
      cmd: "mvn dependency:tree -Dverbose",
      descEn: "Print Maven dependency resolution & conflicts",
      descZh: "打印 Maven 详细依赖树并排查版本冲突",
    },
    {
      cmd: "./gradlew dependencies --configuration runtimeClasspath",
      descEn: "Print Gradle runtime dependencies",
      descZh: "查看 Gradle 运行时类路径（runtimeClasspath）依赖树",
    },
    {
      cmd: "jcmd <pid> Thread.print",
      descEn: "Dump JVM thread stacks",
      descZh: "导出指定 JVM 进程的全部线程调用栈以排查死锁",
    },
    {
      cmd: "jmap -dump:live,format=b,file=heap.hprof <pid>",
      descEn: "Capture live heap dump",
      descZh: "仅针对存活对象生成 JVM 堆内存快照（.hprof）",
    },
    {
      cmd: "jstat -gcutil <pid> 1000",
      descEn: "Monitor GC utilization every 1s",
      descZh: "每 1 秒输出一次各代内存占用率与 GC 统计",
    },
    {
      cmd: "javap -c -p MyClass.class",
      descEn: "Disassemble class bytecode",
      descZh: "反汇编查看 .class 字节码指令（含私有成员）",
    },
  ],
  network: [
    {
      cmd: "openssl s_client -connect example.com:443 -servername example.com </dev/null | openssl x509 -noout -dates -subject",
      descEn: "Inspect TLS cert expiry & subject",
      descZh: "在线探测远端 TLS 证书有效期及主体信息（支持 SNI）",
    },
    {
      cmd: "openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 365",
      descEn: "Generate self-signed TLS certificate",
      descZh: "生成 2048 位 RSA 无密码私钥与自签名 X.509 测试证书",
    },
    {
      cmd: "curl -sS -o /dev/null -w \"dns:%{time_namelookup} conn:%{time_connect} tls:%{time_appconnect} ttfb:%{time_starttransfer} total:%{time_total}\\n\" https://example.com",
      descEn: "Measure HTTP phase timings",
      descZh: "分阶段测量 DNS、TCP 建连、TLS 握手、首字节与总耗时",
    },
    {
      cmd: "dig +short AAAA example.com @1.1.1.1",
      descEn: "Query DNS record against 1.1.1.1",
      descZh: "向 1.1.1.1 DNS 服务器精简查询指定域名的 IPv6 (AAAA) 记录",
    },
    {
      cmd: "nc -zv 127.0.0.1 6379",
      descEn: "Test TCP port reachability",
      descZh: "检测目标主机 TCP 端口（如 Redis 6379）连通性",
    },
  ],
  mime: [
    {
      cmd: "application/json",
      descEn: ".json — JSON data",
      descZh: ".json — JSON 数据格式",
    },
    {
      cmd: "application/x-www-form-urlencoded",
      descEn: "HTML form key=value body",
      descZh: "HTML 标准表单键值对编码请求体",
    },
    {
      cmd: "multipart/form-data",
      descEn: "Binary file upload form body",
      descZh: "支持二进制文件上传的多段表单请求体",
    },
    {
      cmd: "application/octet-stream",
      descEn: "Arbitrary binary stream",
      descZh: "通用未知或任意二进制字节流",
    },
    {
      cmd: "text/event-stream",
      descEn: "Server-Sent Events (SSE)",
      descZh: "服务端单向流式事件推送 (SSE)",
    },
    {
      cmd: "application/pdf",
      descEn: ".pdf — Portable Document",
      descZh: ".pdf — PDF 便携式文档",
    },
    {
      cmd: "application/wasm",
      descEn: ".wasm — WebAssembly module",
      descZh: ".wasm — WebAssembly 二进制模块",
    },
    {
      cmd: "image/svg+xml",
      descEn: ".svg — Scalable Vector Graphics",
      descZh: ".svg — 可缩放矢量图形",
    },
    {
      cmd: "image/webp",
      descEn: ".webp — WebP image",
      descZh: ".webp — WebP 图像格式",
    },
    {
      cmd: "application/yaml",
      descEn: ".yaml / .yml — YAML document",
      descZh: ".yaml / .yml — YAML 配置文件格式",
    },
  ],
  regex: [
    {
      cmd: ". / \\d / \\w / \\s",
      descEn: "Any char / Digit [0-9] / Word [a-zA-Z0-9_] / Whitespace",
      descZh: "任意字符 / 数字 [0-9] / 单词字符 [a-zA-Z0-9_] / 空白符",
    },
    {
      cmd: "^ / $ / \\b",
      descEn: "Start / End of line or string / Word boundary",
      descZh: "行首或字符串开头 / 行尾或结尾 / 单词边界",
    },
    {
      cmd: "* / + / ? / {m,n}",
      descEn: "0+ / 1+ / 0-1 / m..n repetitions (append ? for lazy)",
      descZh: "0次以上 / 1次以上 / 0或1次 / m到n次重复（后加 ? 为懒惰匹配）",
    },
    {
      cmd: "(?<name>abc)",
      descEn: "Named capturing group ($name)",
      descZh: "命名捕获组（替换时可用 $name 引用）",
    },
    {
      cmd: "(?:abc)",
      descEn: "Non-capturing group",
      descZh: "非捕获分组（仅分组不记录捕获结果）",
    },
    {
      cmd: "[abc] / [^abc]",
      descEn: "Character class / Negated class",
      descZh: "字符集合匹配 / 排除型字符集合",
    },
    {
      cmd: "(?i) / (?m) / (?s)",
      descEn: "Inline flags: ignore case / multiline / dotall",
      descZh: "内联修饰符：忽略大小写 / 多行模式 / 单行模式(.匹配换行)",
    },
  ],
  cron: [
    {
      cmd: "* * * * *",
      descEn: "Every minute (5-field Unix)",
      descZh: "每分钟执行一次（5 字段标准 Unix）",
    },
    {
      cmd: "*/5 * * * *",
      descEn: "Every 5 minutes (Unix)",
      descZh: "每 5 分钟执行一次（Unix）",
    },
    {
      cmd: "0 2 * * *",
      descEn: "Every day at 02:00 (Unix)",
      descZh: "每天凌晨 02:00 执行（Unix）",
    },
    {
      cmd: "0 0 * * 1-5",
      descEn: "Midnight Mon-Fri (Unix)",
      descZh: "每周一至周五 00:00 执行（Unix）",
    },
    {
      cmd: "0 */15 9-18 ? * MON-FRI",
      descEn: "Every 15 min 09:00-18:59 weekdays (Spring/Quartz)",
      descZh: "工作日 09:00-18:59 每 15 分钟执行一次（Spring/Quartz）",
    },
    {
      cmd: "0 0 0 L * ?",
      descEn: "Last day of every month at 00:00 (Quartz)",
      descZh: "每月最后一天 00:00 执行（Quartz）",
    },
  ],
};

export const HTTP_CODES: Array<[string, string, string, string]> = [
  ["100", "Continue", "Client may continue sending request body", "客户端可继续发送剩余请求体"],
  ["101", "Switching Protocols", "Server upgrades protocol (e.g. WebSocket)", "服务器同意切换协议（例如升级到 WebSocket）"],
  ["200", "OK", "Request succeeded", "请求成功并正常返回"],
  ["201", "Created", "Resource created successfully", "请求成功且已创建新资源"],
  ["204", "No Content", "Succeeded with no response body", "处理成功，响应体为空"],
  ["206", "Partial Content", "Range request fulfilled", "已成功返回断点续传/分片 Range 请求内容"],
  ["301", "Moved Permanently", "Permanent redirect (cacheable)", "永久重定向（浏览器/CDN 可缓存）"],
  ["302", "Found", "Temporary redirect", "临时重定向"],
  ["304", "Not Modified", "Cached representation is still valid", "资源未修改，可使用本地缓存版本"],
  ["307", "Temporary Redirect", "Temporary redirect preserving HTTP method", "临时重定向且保持原 HTTP 请求方法与请求体"],
  ["308", "Permanent Redirect", "Permanent redirect preserving HTTP method", "永久重定向且保持原 HTTP 请求方法与请求体"],
  ["400", "Bad Request", "Malformed syntax or invalid parameters", "请求语法错误或参数校验失败"],
  ["401", "Unauthorized", "Missing or invalid authentication credentials", "未认证或认证凭据缺失/已失效"],
  ["403", "Forbidden", "Authenticated but lacks permission", "已认证但无权访问目标资源"],
  ["404", "Not Found", "Requested resource does not exist", "请求的资源或接口路径不存在"],
  ["405", "Method Not Allowed", "HTTP method unsupported on this endpoint", "目标接口不支持当前使用的 HTTP 方法"],
  ["408", "Request Timeout", "Server timed out waiting for client", "服务器等待客户端请求超时"],
  ["409", "Conflict", "Request conflicts with current resource state", "请求与资源当前状态存在冲突"],
  ["413", "Payload Too Large", "Request body exceeds server limit", "请求体大小超出服务端限制"],
  ["415", "Unsupported Media Type", "Content-Type not accepted", "服务端不支持当前请求的 Content-Type"],
  ["422", "Unprocessable Content", "Semantically invalid request body", "请求格式合法但语义/业务字段校验未通过"],
  ["429", "Too Many Requests", "Rate limit exceeded", "请求过于频繁，触发限流策略"],
  ["500", "Internal Server Error", "Unexpected server failure", "服务端内部发生未预期异常"],
  ["502", "Bad Gateway", "Invalid response from upstream server", "网关或代理从上游服务器收到无效响应"],
  ["503", "Service Unavailable", "Server overloaded or under maintenance", "服务暂不可用（过载或正在维护）"],
  ["504", "Gateway Timeout", "Upstream server failed to respond in time", "网关或代理等待上游服务器响应超时"],
];

const ASCII_CTRL: Record<number, string> = {
  0: "NUL", 7: "BEL", 8: "BS", 9: "TAB", 10: "LF", 13: "CR", 27: "ESC", 32: "SPACE", 127: "DEL",
};

const SHEETS: Array<{ id: SheetId; labelEn: string; labelZh: string }> = [
  { id: "git", labelEn: "Git", labelZh: "Git" },
  { id: "docker", labelEn: "Docker", labelZh: "Docker" },
  { id: "k8s", labelEn: "K8s", labelZh: "K8s" },
  { id: "linux", labelEn: "Linux", labelZh: "Linux" },
  { id: "sql", labelEn: "SQL", labelZh: "SQL" },
  { id: "jvm", labelEn: "JVM", labelZh: "JVM" },
  { id: "network", labelEn: "OpenSSL/Net", labelZh: "OpenSSL/网络" },
  { id: "http", labelEn: "HTTP", labelZh: "HTTP 状态码" },
  { id: "mime", labelEn: "MIME", labelZh: "MIME 类型" },
  { id: "regex", labelEn: "Regex", labelZh: "正则语法" },
  { id: "cron", labelEn: "Cron", labelZh: "Cron 示例" },
  { id: "ascii", labelEn: "ASCII", labelZh: "ASCII 码表" },
  { id: "chmod", labelEn: "Chmod", labelZh: "Chmod 权限" },
];

export default function CheatsheetTool({ locale }: ToolProps) {
  const [sheet, setSheet] = useState<SheetId>("git");
  const [q, setQ] = useState("");
  const [chmodBits, setChmodBits] = useState([true, true, true, true, false, true, true, false, true]); // 0755
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);

  const lower = q.trim().toLowerCase();

  const handleCopy = async (text: string) => {
    await copyToClipboard(text);
    setCopiedCmd(text);
    setTimeout(() => setCopiedCmd((cur) => (cur === text ? null : cur)), 1500);
  };

  const asciiRows = useMemo(() => {
    const list: Array<{ dec: number; hex: string; ch: string }> = [];
    for (let i = 0; i < 128; i++) {
      const ch = ASCII_CTRL[i] ?? (i < 32 ? `CTRL-${i}` : String.fromCharCode(i));
      list.push({ dec: i, hex: `0x${i.toString(16).toUpperCase().padStart(2, "0")}`, ch });
    }
    if (!lower) return list;
    return list.filter((r) => String(r.dec) === lower || r.hex.toLowerCase().includes(lower) || r.ch.toLowerCase().includes(lower));
  }, [lower]);

  const chmodOctal = [0, 3, 6]
    .map((off) => (chmodBits[off] ? 4 : 0) + (chmodBits[off + 1] ? 2 : 0) + (chmodBits[off + 2] ? 1 : 0))
    .join("");
  const chmodSym = chmodBits
    .map((on, idx) => (on ? ["r", "w", "x"][idx % 3] : "-"))
    .join("");

  return (
    <div className="ts-tool">
      <div className="ts-tool-head">
        <span className="ts-tool-title">{tx(locale, "Developer Cheatsheets (12 + Chmod)", "开发者速查表 (12 类 + Chmod)")}</span>
        {copiedCmd !== null && <span className="ts-badge good">{tx(locale, "Copied", "已复制")}</span>}
      </div>

      <div className="ts-row">
        {SHEETS.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`ts-pill ${sheet === s.id ? "active" : ""}`}
            onClick={() => setSheet(s.id)}
          >
            {tx(locale, s.labelEn, s.labelZh)}
          </button>
        ))}
      </div>

      {sheet !== "chmod" && (
        <input
          className="ts-input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={tx(locale, "Search across current sheet or type command keyword...", "搜索命令、说明或状态码...")}
        />
      )}

      <div className="ts-box" style={{ flex: 1, overflowY: "auto" }}>
        {sheet === "chmod" && (
          <div className="ts-col">
            <div className="ts-row">
              <span className="ts-badge">chmod {chmodOctal}</span>
              <span className="ts-badge ts-mono">{chmodSym}</span>
              <button type="button" className="ts-btn sm" onClick={() => handleCopy(`chmod ${chmodOctal} `)}>
                {tx(locale, "Copy Command", "复制命令")}
              </button>
            </div>
            <table className="ts-table">
              <thead>
                <tr>
                  <th>{tx(locale, "Role", "角色")}</th>
                  <th>{tx(locale, "Read (4)", "读 (4)")}</th>
                  <th>{tx(locale, "Write (2)", "写 (2)")}</th>
                  <th>{tx(locale, "Execute (1)", "执行 (1)")}</th>
                </tr>
              </thead>
              <tbody>
                {[
                  tx(locale, "Owner (User)", "所有者 (Owner)"),
                  tx(locale, "Group", "所属组 (Group)"),
                  tx(locale, "Others (Public)", "其他用户 (Others)"),
                ].map((role, ri) => (
                  <tr key={ri}>
                    <td>{role}</td>
                    {[0, 1, 2].map((ci) => {
                      const idx = ri * 3 + ci;
                      return (
                        <td key={ci}>
                          <input
                            type="checkbox"
                            checked={chmodBits[idx]}
                            onChange={(e) =>
                              setChmodBits((prev) => prev.map((v, i) => (i === idx ? e.target.checked : v)))
                            }
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {sheet === "http" && (
          <table className="ts-table">
            <thead>
              <tr>
                <th>{tx(locale, "Code", "状态码")}</th>
                <th>{tx(locale, "Phrase", "短语")}</th>
                <th>{tx(locale, "Meaning", "说明")}</th>
              </tr>
            </thead>
            <tbody>
              {HTTP_CODES.filter((r) => !lower || r.some((c) => c.toLowerCase().includes(lower))).map(([c, p, dEn, dZh]) => (
                <tr key={c}>
                  <td className="ts-mono"><strong>{c}</strong></td>
                  <td>{p}</td>
                  <td style={{ color: "var(--ts-fg-muted)" }}>{tx(locale, dEn, dZh)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {sheet === "ascii" && (
          <table className="ts-table">
            <thead>
              <tr>
                <th>{tx(locale, "DEC", "十进制")}</th>
                <th>{tx(locale, "HEX", "十六进制")}</th>
                <th>{tx(locale, "CHAR", "字符")}</th>
              </tr>
            </thead>
            <tbody>
              {asciiRows.map((r) => (
                <tr key={r.dec}>
                  <td className="ts-mono">{r.dec}</td>
                  <td className="ts-mono">{r.hex}</td>
                  <td className="ts-mono"><strong>{r.ch}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {sheet !== "http" && sheet !== "ascii" && sheet !== "chmod" && (
          <table className="ts-table">
            <thead>
              <tr>
                <th>{tx(locale, "Command / Pattern", "命令 / 语法")}</th>
                <th>{tx(locale, "Description", "说明")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {COMMAND_SHEETS[sheet]
                .filter(
                  (r) =>
                    !lower ||
                    r.cmd.toLowerCase().includes(lower) ||
                    r.descEn.toLowerCase().includes(lower) ||
                    r.descZh.toLowerCase().includes(lower),
                )
                .map((row) => (
                  <tr key={row.cmd}>
                    <td className="ts-mono" style={{ fontSize: 11.5 }}>{row.cmd}</td>
                    <td style={{ color: "var(--ts-fg-muted)" }}>{tx(locale, row.descEn, row.descZh)}</td>
                    <td>
                      <button type="button" className="ts-btn sm" onClick={() => handleCopy(row.cmd)}>
                        {copiedCmd === row.cmd ? tx(locale, "Copied", "已复制") : tx(locale, "Copy", "复制")}
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
