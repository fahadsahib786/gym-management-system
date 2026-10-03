import type { Gender, GymSettings } from "@/api/bindings";
import { Barcode } from "@/components/common/barcode";
import { formatDate, initials, phoneDisplay } from "@/lib/format";
import { pdfFileName, saveAsPdf } from "@/lib/pdf";
import { photoUrl } from "@/lib/photo";
import { printNode } from "@/lib/print";

export interface CardMember {
  id: string;
  fullName: string;
  memberCode: string;
  photoVersion: number;
  joinDate: string;
  phone: string;
  gender?: Gender;
  fatherName?: string | null;
  cnic?: string | null;
  bloodGroup?: string | null;
  timing?: string | null;
}

/** Cards per A4 sheet (2 × 5, credit-card size 85.6 × 54 mm). */
export const CARDS_PER_PAGE = 10;

const ACCENT = "#3f3fd1";

/**
 * Member card (credit-card size): photo, name, ID, phone and — when entered — CNIC, father/husband name, blood
 * group and timing. The barcode holds the member ID, so a USB scanner at the desk checks the member in.
 * Works on black & white printers and as a PDF for a card-printing shop.
 */
export function MemberCard({ member: m, gym }: { member: CardMember; gym: GymSettings }) {
  const photo = photoUrl(m.id, m.photoVersion);
  const details: [string, string | null | undefined][] = [
    ["Phone", m.phone ? phoneDisplay(m.phone) : null],
    ["CNIC", m.cnic],
    ["F/H Name", m.fatherName],
    ["Blood", m.bloodGroup],
    ["Timing", m.timing],
    ["Since", formatDate(m.joinDate)],
  ];
  const gymPhone = gym.phone ? (/^\d{12}$/.test(gym.phone) ? phoneDisplay(gym.phone) : gym.phone) : "";
  return (
    <div
      className="flex h-[54mm] w-[85.6mm] flex-col overflow-hidden rounded-[3mm] border border-black/40 bg-white text-black [break-inside:avoid]"
      style={{ printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }}
    >
      <div
        className="flex h-[9.5mm] shrink-0 items-center gap-[2mm] px-[3mm] text-white"
        style={{ background: ACCENT }}
      >
        {gym.logo && (
          <img src={gym.logo} alt="" className="size-[6.5mm] rounded-[1mm] bg-white object-contain" />
        )}
        <div className="min-w-0 flex-1 leading-none">
          <div className="truncate font-bold text-[9.5pt]">{gym.name}</div>
          {gym.tagline && <div className="mt-[0.7mm] truncate text-[5.5pt] opacity-85">{gym.tagline}</div>}
        </div>
        <div className="text-right font-semibold text-[5.5pt] leading-tight tracking-[0.14em]">
          MEMBER
          <br />
          CARD
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-[2.5mm] px-[3mm] pt-[2mm]">
        <div
          className="flex h-[24mm] w-[19mm] shrink-0 items-center justify-center overflow-hidden rounded-[1.5mm] border border-black/25 bg-[#eef0ff] font-bold text-[13pt]"
          style={{ color: ACCENT }}
        >
          {photo ? <img src={photo} alt="" className="size-full object-cover" /> : initials(m.fullName)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 font-bold text-[9pt] leading-tight">{m.fullName}</div>
          <div className="mt-[0.6mm] font-bold text-[8pt] tracking-wide" style={{ color: ACCENT }}>
            {m.memberCode}
          </div>
          <dl className="mt-[1mm] grid grid-cols-[auto_minmax(0,1fr)] gap-x-[1.8mm] gap-y-[0.3mm] text-[6.3pt] leading-[1.25]">
            {details
              .filter(([, v]) => !!v)
              .map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-black/55">{label}</dt>
                  <dd className="truncate font-medium">{value}</dd>
                </div>
              ))}
          </dl>
        </div>
      </div>

      <div className="flex shrink-0 items-end justify-between gap-[2mm] px-[3mm] pb-[1.6mm]">
        <div className="min-w-0 text-[5.5pt] text-black/60 leading-tight">
          {(gym.address || gym.city) && (
            <div className="truncate">{[gym.address, gym.city].filter(Boolean).join(", ")}</div>
          )}
          {gymPhone && <div>Ph: {gymPhone}</div>}
        </div>
        <div className="flex shrink-0 flex-col items-center">
          <Barcode value={m.memberCode} heightMm={6.5} />
          <div className="font-mono text-[5.5pt] tracking-[0.25em]">{m.memberCode}</div>
        </div>
      </div>
    </div>
  );
}

function CardSheets({ members, gym }: { members: CardMember[]; gym: GymSettings }) {
  const pages: CardMember[][] = [];
  for (let i = 0; i < members.length; i += CARDS_PER_PAGE) pages.push(members.slice(i, i + CARDS_PER_PAGE));
  return (
    <div>
      {pages.map((page, i) => (
        <div
          key={page[0]?.id ?? i}
          className="grid grid-cols-[repeat(2,85.6mm)] justify-center gap-x-[6mm] gap-y-[3mm] [&:not(:last-child)]:break-after-page"
        >
          {page.map((m) => (
            <MemberCard key={m.id} member={m} gym={gym} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Prints cards on A4 sheets, ten per page, ready to cut out (and laminate). */
export async function printMemberCards(members: CardMember[], gym: GymSettings) {
  await printNode(<CardSheets members={members} gym={gym} />, "cards");
}

/** Saves cards as a PDF (A4 sheets, ten per page) — e.g. to have them printed on PVC at a print shop. */
export async function saveMemberCardsPdf(members: CardMember[], gym: GymSettings) {
  const name =
    members.length === 1
      ? pdfFileName("Member card", members[0].memberCode, members[0].fullName)
      : pdfFileName("Member cards", `${members.length} members`);
  await saveAsPdf(<CardSheets members={members} gym={gym} />, "cards", name);
}
