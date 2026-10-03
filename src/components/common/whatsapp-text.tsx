import type { ReactNode } from "react";
import { parseWhatsApp } from "@/lib/templates";

/** Message text with WhatsApp formatting applied (*bold*, _italic_, ~strike~), as the member will see it. */
export function WhatsAppText({ text }: { text: string }) {
  return parseWhatsApp(text).map((s) => {
    let node: ReactNode = s.text;
    if (s.strike) node = <s>{node}</s>;
    if (s.italic) node = <em>{node}</em>;
    if (s.bold) node = <strong className="font-semibold">{node}</strong>;
    return <span key={s.at}>{node}</span>;
  });
}
