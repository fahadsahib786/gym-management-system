import type { GymSettings } from "@/api/bindings";
import { formatDateTime } from "@/lib/format";
import { printNode } from "@/lib/print";

export interface ReportSection {
  title: string;
  columns: string[];
  rows: (string | number)[][];
  footer?: (string | number)[];
}

export interface ReportPrintProps {
  gym: GymSettings;
  title: string;
  period: string;
  kpis?: { label: string; value: string }[];
  sections: ReportSection[];
  preparedBy?: string;
}

/** Plain black-on-white A4 layout for any report. */
function ReportDocument({ gym, title, period, kpis = [], sections, preparedBy }: ReportPrintProps) {
  const cell = { border: "1px solid #999", padding: "4px 6px" } as const;
  return (
    <div
      style={{ fontFamily: '"Inter Variable", "Segoe UI", Arial, sans-serif', fontSize: 11, color: "#000" }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          borderBottom: "2px solid #000",
          paddingBottom: 6,
        }}
      >
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {gym.logo && <img src={gym.logo} alt="" style={{ height: 42 }} />}
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{gym.name}</div>
            <div>{[gym.address, gym.city].filter(Boolean).join(", ")}</div>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{title}</div>
          <div>{period}</div>
        </div>
      </div>
      {kpis.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, margin: "10px 0" }}>
          {kpis.map((k) => (
            <div key={k.label} style={{ border: "1px solid #999", padding: "6px 8px" }}>
              <div style={{ fontSize: 9, textTransform: "uppercase" }}>{k.label}</div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{k.value}</div>
            </div>
          ))}
        </div>
      )}
      {sections.map((s) => (
        <div key={s.title} style={{ marginTop: 12, breakInside: "avoid" }}>
          <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 4 }}>{s.title}</div>
          {s.rows.length === 0 ? (
            <div style={{ fontStyle: "italic" }}>Nothing to show.</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {s.columns.map((c, i) => (
                    <th
                      key={c}
                      style={{ ...cell, background: "#eee", textAlign: i === 0 ? "left" : "right" }}
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {s.rows.map((r, ri) => (
                  <tr key={ri}>
                    {r.map((v, ci) => (
                      <td key={ci} style={{ ...cell, textAlign: ci === 0 ? "left" : "right" }}>
                        {v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              {s.footer && (
                <tfoot>
                  <tr>
                    {s.footer.map((v, ci) => (
                      <td
                        key={ci}
                        style={{ ...cell, fontWeight: 700, textAlign: ci === 0 ? "left" : "right" }}
                      >
                        {v}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          )}
        </div>
      ))}
      <div style={{ marginTop: 16, display: "flex", justifyContent: "space-between", fontSize: 9 }}>
        <span>
          Printed {formatDateTime(new Date())}
          {preparedBy ? ` by ${preparedBy}` : ""}
        </span>
        <span>Signature: ____________________</span>
      </div>
    </div>
  );
}

export function printReport(props: ReportPrintProps) {
  return printNode(<ReportDocument {...props} />, "a4");
}
