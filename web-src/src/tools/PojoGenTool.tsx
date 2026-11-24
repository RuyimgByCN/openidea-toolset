import { useEffect, useState } from "react";
import { bridge } from "../bridge";
import { ToolActionBar } from "../components/ToolActionBar";
import { useToolState } from "../hooks/useToolState";
import { tx } from "../i18n";
import type { ToolProps } from "../types";

const TARGETS = [
  { id: "java", en: "Java POJO", zh: "Java POJO", lang: "java", ext: "java" },
  { id: "java-record", en: "Java Record", zh: "Java Record", lang: "java", ext: "java" },
  { id: "typescript", en: "TypeScript Interface", zh: "TypeScript 接口", lang: "typescript", ext: "ts" },
  { id: "go", en: "Go Struct", zh: "Go 结构体", lang: "go", ext: "go" },
  { id: "rust", en: "Rust Serde Struct", zh: "Rust 结构体", lang: "rust", ext: "rs" },
];

export default function PojoGenTool({ locale, initialInput, onConsumeInitial }: ToolProps) {
  const [saved, setSaved] = useToolState("pojo-gen", {
    target: "java",
    rootName: "UserProfile",
    lombok: true,
    input: '{\n  "user_id": 1001,\n  "full_name": "Ada Lovelace",\n  "active": true,\n  "roles": ["admin", "dev"]\n}',
  });
  const [output, setOutput] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (initialInput != null) {
      setSaved((p) => ({ ...p, input: initialInput }));
      onConsumeInitial?.();
    }
  }, [initialInput]);

  const generate = async () => {
    setErr(null);
    try {
      const res = await bridge.rpc<{ result: string }>("format.pojo", {
        text: saved.input,
        target: saved.target,
        rootName: saved.rootName,
        lombok: saved.lombok,
      });
      setOutput(res.result);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const targetMeta = TARGETS.find((t) => t.id === saved.target);

  return (
    <div className="ts-tool">
      <div className="ts-tool-head">
        <span className="ts-tool-title">{tx(locale, "JSON → POJO / Struct", "JSON 生成实体类")}</span>
        <ToolActionBar
          locale={locale}
          onImportEditor={(t) => setSaved((p) => ({ ...p, input: t }))}
          onPaste={(t) => setSaved((p) => ({ ...p, input: t }))}
          outputText={output}
          openTabTitle={saved.rootName || "Model"}
          openTabLanguage={targetMeta?.lang}
          openTabFileName={`${saved.rootName || "Model"}.${targetMeta?.ext || "txt"}`}
        />
      </div>

      <div className="ts-row">
        <select className="ts-select" style={{ width: 165 }} value={saved.target} onChange={(e) => setSaved((p) => ({ ...p, target: e.target.value }))}>
          {TARGETS.map((t) => (
            <option key={t.id} value={t.id}>{tx(locale, t.en, t.zh)}</option>
          ))}
        </select>
        <input
          className="ts-input"
          style={{ width: 130 }}
          value={saved.rootName}
          onChange={(e) => setSaved((p) => ({ ...p, rootName: e.target.value }))}
          placeholder={tx(locale, "ClassName", "类名（如 UserProfile）")}
        />
        {saved.target === "java" && (
          <label className="ts-inline-check">
            <input type="checkbox" checked={saved.lombok} onChange={(e) => setSaved((p) => ({ ...p, lombok: e.target.checked }))} />
            Lombok @Data
          </label>
        )}
        <button type="button" className="ts-btn primary" onClick={generate}>
          {tx(locale, "Generate", "生成")}
        </button>
      </div>

      <textarea className="ts-textarea mono" rows={6} value={saved.input} onChange={(e) => setSaved((p) => ({ ...p, input: e.target.value }))} />
      {err && <div className="ts-err">{err}</div>}
      <textarea className="ts-textarea mono" rows={9} readOnly value={output} />
    </div>
  );
}
