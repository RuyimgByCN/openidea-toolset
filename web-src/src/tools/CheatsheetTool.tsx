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

interface CheatEntry {
  cmd: string;
  desc: string;
}

const COMMAND_SHEETS: Record<Exclude<SheetId, "http" | "ascii" | "chmod">, CheatEntry[]> = {
  git: [
    { cmd: "git status -sb", desc: "Compact working tree & branch status" },
    { cmd: "git switch -c feat/name", desc: "Create and switch to new branch" },
    { cmd: "git rebase -i HEAD~5", desc: "Interactive rebase / squash last 5 commits" },
    { cmd: "git reset --soft HEAD~1", desc: "Undo last commit keeping staged changes" },
    { cmd: "git cherry-pick <sha>", desc: "Apply specific commit onto current branch" },
    { cmd: "git stash push -m \"wip\" -u", desc: "Stash tracked and untracked files" },
    { cmd: "git log --oneline --graph -20", desc: "Compact commit DAG graph" },
    { cmd: "git bisect start HEAD v1.0", desc: "Binary search commit that introduced a bug" },
    { cmd: "git worktree add ../wt branch", desc: "Checkout branch in parallel folder" },
    { cmd: "git clean -fd", desc: "Remove untracked files and directories" },
  ],
  docker: [
    { cmd: "docker ps -a --format \"table {{.Names}}\\t{{.Status}}\\t{{.Ports}}\"", desc: "List containers with formatted columns" },
    { cmd: "docker exec -it <container> sh", desc: "Open shell inside running container" },
    { cmd: "docker logs -f --tail 200 <container>", desc: "Tail live container logs" },
    { cmd: "docker compose up -d --build", desc: "Rebuild and detach compose services" },
    { cmd: "docker buildx build --platform linux/amd64,linux/arm64 -t img:tag .", desc: "Multi-arch image build" },
    { cmd: "docker system df", desc: "Inspect images, containers & volumes disk usage" },
    { cmd: "docker system prune -af --volumes", desc: "Clean unused images, containers & volumes" },
    { cmd: "docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' <id>", desc: "Print container IP" },
  ],
  k8s: [
    { cmd: "kubectl get pods -A -o wide", desc: "List pods across all namespaces with nodes & IPs" },
    { cmd: "kubectl logs -f -n <ns> deploy/<name> --tail=100", desc: "Follow Deployment logs" },
    { cmd: "kubectl exec -it -n <ns> pod/<name> -- sh", desc: "Shell into Pod container" },
    { cmd: "kubectl port-forward -n <ns> svc/<name> 8080:80", desc: "Forward local 8080 to service port 80" },
    { cmd: "kubectl rollout restart deployment/<name> -n <ns>", desc: "Trigger rolling restart" },
    { cmd: "kubectl top pods -A --sort-by=memory", desc: "Show highest memory pods" },
    { cmd: "kubectl describe pod <name> -n <ns>", desc: "Inspect pod events and scheduling errors" },
    { cmd: "kubectl get events -A --sort-by='.lastTimestamp'", desc: "Chronological cluster events" },
  ],
  linux: [
    { cmd: "lsof -i :8080 -P -n", desc: "Find process listening on TCP/UDP port 8080" },
    { cmd: "ps aux --sort=-%mem | head -20", desc: "Top 20 processes by RSS memory (Linux)" },
    { cmd: "rg -n \"pattern\" src/", desc: "Fast recursive search with ripgrep" },
    { cmd: "tar -czvf archive.tar.gz dir/", desc: "Create gzip archive" },
    { cmd: "tar -xzvf archive.tar.gz -C dest/", desc: "Extract gzip archive" },
    { cmd: "du -sh * | sort -hr | head -20", desc: "Largest directories/files in current folder" },
    { cmd: "rsync -avz --progress src/ user@host:/dest/", desc: "Incremental sync over SSH" },
    { cmd: "ssh -L 5432:127.0.0.1:5432 bastion -N", desc: "Local SSH port-forward tunnel" },
    { cmd: "systemd-analyze blame", desc: "Inspect systemd boot service times" },
  ],
  sql: [
    { cmd: "EXPLAIN ANALYZE SELECT ...", desc: "Inspect real execution plan & timing" },
    { cmd: "SELECT id, ROW_NUMBER() OVER (PARTITION BY dept ORDER BY salary DESC) AS rn FROM emp;", desc: "Window function ranking" },
    { cmd: "INSERT INTO t(id, val) VALUES (1, 'a') ON CONFLICT (id) DO UPDATE SET val = EXCLUDED.val;", desc: "PostgreSQL Upsert" },
    { cmd: "INSERT INTO t(id, val) VALUES (1, 'a') ON DUPLICATE KEY UPDATE val = VALUES(val);", desc: "MySQL Upsert" },
    { cmd: "WITH cte AS (SELECT ...) SELECT * FROM cte;", desc: "Common Table Expression (CTE)" },
    { cmd: "SHOW FULL PROCESSLIST;", desc: "List active MySQL threads & queries" },
    { cmd: "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state = 'idle in transaction';", desc: "Terminate stuck PostgreSQL idle tx" },
  ],
  jvm: [
    { cmd: "./mvnw clean verify -DskipTests=false", desc: "Maven wrapper build and verify" },
    { cmd: "mvn dependency:tree -Dverbose", desc: "Print Maven dependency resolution & conflicts" },
    { cmd: "./gradlew dependencies --configuration runtimeClasspath", desc: "Print Gradle runtime dependencies" },
    { cmd: "jcmd <pid> Thread.print", desc: "Dump JVM thread stacks" },
    { cmd: "jmap -dump:live,format=b,file=heap.hprof <pid>", desc: "Capture live heap dump" },
    { cmd: "jstat -gcutil <pid> 1000", desc: "Monitor GC utilization every 1s" },
    { cmd: "javap -c -p MyClass.class", desc: "Disassemble class bytecode" },
  ],
  network: [
    { cmd: "openssl s_client -connect example.com:443 -servername example.com </dev/null | openssl x509 -noout -dates -subject", desc: "Inspect TLS cert expiry & subject" },
    { cmd: "openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 365", desc: "Generate self-signed TLS certificate" },
    { cmd: "curl -sS -o /dev/null -w \"dns:%{time_namelookup} conn:%{time_connect} tls:%{time_appconnect} ttfb:%{time_starttransfer} total:%{time_total}\\n\" https://example.com", desc: "Measure HTTP phase timings" },
    { cmd: "dig +short AAAA example.com @1.1.1.1", desc: "Query DNS record against 1.1.1.1" },
    { cmd: "nc -zv 127.0.0.1 6379", desc: "Test TCP port reachability" },
  ],
  mime: [
    { cmd: "application/json", desc: ".json — JSON data" },
    { cmd: "application/x-www-form-urlencoded", desc: "HTML form key=value body" },
    { cmd: "multipart/form-data", desc: "Binary file upload form body" },
    { cmd: "application/octet-stream", desc: "Arbitrary binary stream" },
    { cmd: "text/event-stream", desc: "Server-Sent Events (SSE)" },
    { cmd: "application/pdf", desc: ".pdf — Portable Document" },
    { cmd: "application/wasm", desc: ".wasm — WebAssembly module" },
    { cmd: "image/svg+xml", desc: ".svg — Scalable Vector Graphics" },
    { cmd: "image/webp", desc: ".webp — WebP image" },
    { cmd: "application/yaml", desc: ".yaml / .yml — YAML document" },
  ],
  regex: [
    { cmd: ". / \\d / \\w / \\s", desc: "Any char / Digit [0-9] / Word [a-zA-Z0-9_] / Whitespace" },
    { cmd: "^ / $ / \\b", desc: "Start / End of line or string / Word boundary" },
    { cmd: "* / + / ? / {m,n}", desc: "0+ / 1+ / 0-1 / m..n repetitions (append ? for lazy)" },
    { cmd: "(?<name>abc)", desc: "Named capturing group ($name)" },
    { cmd: "(?:abc)", desc: "Non-capturing group" },
    { cmd: "[abc] / [^abc]", desc: "Character class / Negated class" },
    { cmd: "(?i) / (?m) / (?s)", desc: "Inline flags: ignore case / multiline / dotall" },
  ],
  cron: [
    { cmd: "* * * * *", desc: "Every minute (5-field Unix)" },
    { cmd: "*/5 * * * *", desc: "Every 5 minutes (Unix)" },
    { cmd: "0 2 * * *", desc: "Every day at 02:00 (Unix)" },
    { cmd: "0 0 * * 1-5", desc: "Midnight Mon-Fri (Unix)" },
    { cmd: "0 */15 9-18 ? * MON-FRI", desc: "Every 15 min 09:00-18:59 weekdays (Spring/Quartz)" },
    { cmd: "0 0 0 L * ?", desc: "Last day of every month at 00:00 (Quartz)" },
  ],
};

const HTTP_CODES: Array<[string, string, string]> = [
  ["100", "Continue", "Client may continue sending request body"],
  ["101", "Switching Protocols", "Server upgrades protocol (e.g. WebSocket)"],
  ["200", "OK", "Request succeeded"],
  ["201", "Created", "Resource created successfully"],
  ["204", "No Content", "Succeeded with no response body"],
  ["206", "Partial Content", "Range request fulfilled"],
  ["301", "Moved Permanently", "Permanent redirect (cacheable)"],
  ["302", "Found", "Temporary redirect"],
  ["304", "Not Modified", "Cached representation is still valid"],
  ["307", "Temporary Redirect", "Temporary redirect preserving HTTP method"],
  ["308", "Permanent Redirect", "Permanent redirect preserving HTTP method"],
  ["400", "Bad Request", "Malformed syntax or invalid parameters"],
  ["401", "Unauthorized", "Missing or invalid authentication credentials"],
  ["403", "Forbidden", "Authenticated but lacks permission"],
  ["404", "Not Found", "Requested resource does not exist"],
  ["405", "Method Not Allowed", "HTTP method unsupported on this endpoint"],
  ["408", "Request Timeout", "Server timed out waiting for client"],
  ["409", "Conflict", "Request conflicts with current resource state"],
  ["413", "Payload Too Large", "Request body exceeds server limit"],
  ["415", "Unsupported Media Type", "Content-Type not accepted"],
  ["422", "Unprocessable Content", "Semantically invalid request body"],
  ["429", "Too Many Requests", "Rate limit exceeded"],
  ["500", "Internal Server Error", "Unexpected server failure"],
  ["502", "Bad Gateway", "Invalid response from upstream server"],
  ["503", "Service Unavailable", "Server overloaded or under maintenance"],
  ["504", "Gateway Timeout", "Upstream server failed to respond in time"],
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

  const lower = q.trim().toLowerCase();

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
              <button type="button" className="ts-btn sm" onClick={() => copyToClipboard(`chmod ${chmodOctal} `)}>
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
              {HTTP_CODES.filter((r) => !lower || r.some((c) => c.toLowerCase().includes(lower))).map(([c, p, d]) => (
                <tr key={c}>
                  <td className="ts-mono"><strong>{c}</strong></td>
                  <td>{p}</td>
                  <td style={{ color: "var(--ts-fg-muted)" }}>{d}</td>
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
                .filter((r) => !lower || r.cmd.toLowerCase().includes(lower) || r.desc.toLowerCase().includes(lower))
                .map((row) => (
                  <tr key={row.cmd}>
                    <td className="ts-mono" style={{ fontSize: 11.5 }}>{row.cmd}</td>
                    <td style={{ color: "var(--ts-fg-muted)" }}>{row.desc}</td>
                    <td>
                      <button type="button" className="ts-btn sm" onClick={() => copyToClipboard(row.cmd)}>
                        {tx(locale, "Copy", "复制")}
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
