import { useEffect, useState } from "react";
import { bridge, copyToClipboard } from "../bridge";
import { ToolActionBar } from "../components/ToolActionBar";
import { useToolState } from "../hooks/useToolState";
import { tx } from "../i18n";
import type { ToolProps } from "../types";

interface XmlMatch {
  kind: "element" | "attr" | "text";
  path: string;
  tag: string;
  name?: string;
  value: string;
  text: string;
  attrs: Record<string, string>;
  outerXml: string;
}

interface XmlQueryResult {
  mode: "xpath" | "css";
  query: string;
  count: number;
  totalMatches: number;
  truncated: boolean;
  scalar: number | string | null;
  rootTag: string;
  elementCount: number;
  matches: XmlMatch[];
}

const SAMPLE_POM = `<project>
  <modelVersion>4.0.0</modelVersion>
  <groupId>dev.openidea</groupId>
  <artifactId>toolset-sample</artifactId>
  <dependencies>
    <dependency scope="compile">
      <groupId>org.slf4j</groupId>
      <artifactId>slf4j-api</artifactId>
      <version>2.0.12</version>
    </dependency>
    <dependency scope="test">
      <groupId>org.junit.jupiter</groupId>
      <artifactId>junit-jupiter</artifactId>
      <version>5.10.2</version>
    </dependency>
  </dependencies>
</project>`;

const SAMPLE_HTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Demo Store</title></head>
<body>
  <section id="catalog">
    <div class="card active" data-sku="A-101">
      <h3>Mechanical Keyboard</h3>
      <span class="price">$129</span>
    </div>
    <div class="card" data-sku="B-202">
      <h3>USB-C Hub</h3>
      <span class="price">$49</span>
    </div>
  </section>
</body>
</html>`;

export default function XPathQueryTool({ tabId, locale, initialInput, onConsumeInitial }: ToolProps) {
  const [saved, setSaved] = useToolState(`xpath-${tabId}`, {
    mode: "xpath" as "xpath" | "css",
    htmlMode: false,
    query: "//dependency[@scope='test']/artifactId",
    xml: SAMPLE_POM,
  });
  const [res, setRes] = useState<XmlQueryResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (initialInput != null) {
      const looksHtml = /<!doctype|<html|<div|<span/i.test(initialInput);
      setSaved((p) => ({ ...p, xml: initialInput, htmlMode: looksHtml }));
      onConsumeInitial?.();
    }
  }, [initialInput]);

  const runQuery = async () => {
    if (!bridge.isHosted) return;
    setErr(null);
    try {
      const data = await bridge.rpc<XmlQueryResult>("xml.query", {
        xml: saved.xml,
        query: saved.query,
        mode: saved.mode,
        html: saved.htmlMode,
      });
      setRes(data);
    } catch (e) {
      setRes(null);
      setErr((e as Error).message);
    }
  };

  useEffect(() => {
    if (!bridge.isHosted) return;
    const t = setTimeout(() => {
      void runQuery();
    }, 120);
    return () => clearTimeout(t);
  }, [saved.xml, saved.query, saved.mode, saved.htmlMode]);

  const quickExamples =
    saved.mode === "xpath"
      ? [
          "//dependency/artifactId/text()",
          "//dependency[@scope='test']",
          "count(//dependency)",
          "//dependency/@scope",
          "//groupId | //artifactId",
        ]
      : [
          "dependencies > dependency artifactId",
          "dependency[scope=\"test\"]",
          ".card.active > h3",
          "#catalog .card span.price",
          "div.card:first-child",
        ];

  const outputText = res
    ? res.scalar !== null
      ? String(res.scalar)
      : JSON.stringify(res.matches, null, 2)
    : "";

  return (
    <div className="ts-tool">
      <div className="ts-tool-head">
        <span className="ts-tool-title">{tx(locale, "XPath & CSS Selector Tester", "XPath 与 CSS 选择器测试")}</span>
        <ToolActionBar
          locale={locale}
          onImportEditor={(t) => setSaved((p) => ({ ...p, xml: t }))}
          onPaste={(t) => setSaved((p) => ({ ...p, xml: t }))}
          outputText={outputText}
          openTabTitle={tx(locale, "XML/HTML Matches", "XPath/CSS 提取结果")}
          openTabLanguage="json"
          onClear={() => {
            setSaved((p) => ({ ...p, xml: "", query: "" }));
            setRes(null);
          }}
        />
      </div>

      <div className="ts-row">
        <button
          type="button"
          className={`ts-pill ${saved.mode === "xpath" ? "active" : ""}`}
          onClick={() =>
            setSaved((p) => ({
              ...p,
              mode: "xpath",
              query: p.mode === "css" ? "//dependency/artifactId" : p.query,
            }))
          }
        >
          XPath
        </button>
        <button
          type="button"
          className={`ts-pill ${saved.mode === "css" ? "active" : ""}`}
          onClick={() =>
            setSaved((p) => ({
              ...p,
              mode: "css",
              query: p.mode === "xpath" ? "dependencies > dependency artifactId" : p.query,
            }))
          }
        >
          CSS Selector
        </button>
        <label className="ts-row" style={{ gap: 4, fontSize: 11.5 }}>
          <input
            type="checkbox"
            checked={saved.htmlMode}
            onChange={(e) => setSaved((p) => ({ ...p, htmlMode: e.target.checked }))}
          />
          {tx(locale, "HTML Tolerant (void tags)", "HTML 容错模式（允许未闭合标签）")}
        </label>
        <button
          type="button"
          className="ts-btn sm"
          onClick={() =>
            setSaved((p) => ({
              ...p,
              xml: SAMPLE_POM,
              htmlMode: false,
              mode: "xpath",
              query: "//dependency[@scope='test']/artifactId",
            }))
          }
        >
          {tx(locale, "Maven XML Sample", "Maven XML 示例")}
        </button>
        <button
          type="button"
          className="ts-btn sm"
          onClick={() =>
            setSaved((p) => ({
              ...p,
              xml: SAMPLE_HTML,
              htmlMode: true,
              mode: "css",
              query: ".card.active > span.price",
            }))
          }
        >
          {tx(locale, "HTML Sample", "HTML 示例")}
        </button>
      </div>

      <div className="ts-row">
        <input
          className="ts-input mono"
          style={{ flex: 1 }}
          value={saved.query}
          onChange={(e) => setSaved((p) => ({ ...p, query: e.target.value }))}
          placeholder={
            saved.mode === "xpath"
              ? "//node[@attr='val']/text()"
              : "div.card > span.price"
          }
        />
        <button type="button" className="ts-btn primary" onClick={runQuery}>
          {tx(locale, "Run", "执行查询")}
        </button>
      </div>

      <div className="ts-row">
        {quickExamples.map((ex) => (
          <button
            key={ex}
            type="button"
            className="ts-btn sm mono"
            onClick={() => setSaved((p) => ({ ...p, query: ex }))}
          >
            {ex}
          </button>
        ))}
      </div>

      <textarea
        className="ts-textarea mono"
        rows={8}
        value={saved.xml}
        onChange={(e) => setSaved((p) => ({ ...p, xml: e.target.value }))}
        placeholder={tx(locale, "Paste XML or HTML document...", "粘贴 XML 或 HTML 文档...")}
      />

      {err && <div className="ts-err">{err}</div>}

      {res && (
        <div className="ts-row" style={{ justifyContent: "space-between" }}>
          <div className="ts-row">
            <span className="ts-badge good">
              {res.scalar !== null
                ? `${tx(locale, "Scalar", "标量结果")}: ${JSON.stringify(res.scalar)}`
                : `${res.totalMatches} ${tx(locale, "matches", "个匹配")}`}
            </span>
            <span className="ts-badge">
              {tx(locale, "Root", "根节点")}: &lt;{res.rootTag}&gt; ({res.elementCount} {tx(locale, "nodes", "节点")})
            </span>
            {res.truncated && (
              <span className="ts-badge">{tx(locale, "Showing first 500 matches", "仅显示前 500 条")}</span>
            )}
            {copied && <span className="ts-badge good">{copied}</span>}
          </div>
          {res.matches.length > 0 && (
            <button
              type="button"
              className="ts-btn sm"
              onClick={async () => {
                await copyToClipboard(res.matches.map((m) => m.value || m.outerXml).join("\n"));
                setCopied(tx(locale, "Copied all values", "已复制全部值"));
                setTimeout(() => setCopied(null), 1400);
              }}
            >
              {tx(locale, "Copy Values", "复制全部结果值")}
            </button>
          )}
        </div>
      )}

      {res && res.matches.length > 0 && (
        <div className="ts-box" style={{ maxHeight: 240, overflowY: "auto" }}>
          <table className="ts-table">
            <thead>
              <tr>
                <th>#</th>
                <th>{tx(locale, "Kind / Path", "类型 / 路径")}</th>
                <th>{tx(locale, "Value / XML", "值 / 节点内容")}</th>
                <th style={{ width: 65 }} />
              </tr>
            </thead>
            <tbody>
              {res.matches.map((m, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td className="ts-mono">
                    <span className="ts-badge" style={{ marginRight: 4 }}>{m.kind}</span>
                    {m.path}
                  </td>
                  <td className="ts-mono" style={{ maxWidth: 320, overflowWrap: "anywhere" }}>
                    <div>{m.value || m.outerXml}</div>
                    {m.value && m.outerXml !== m.value && (
                      <div style={{ color: "var(--ts-fg-muted)", fontSize: 10.5, marginTop: 2 }}>{m.outerXml}</div>
                    )}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="ts-btn sm"
                      onClick={async () => {
                        await copyToClipboard(m.value || m.outerXml);
                        setCopied(`#${i + 1}`);
                        setTimeout(() => setCopied(null), 1000);
                      }}
                    >
                      {tx(locale, "Copy", "复制")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
