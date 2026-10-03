import {
  Building,
  DatabaseBackup,
  Info,
  MessageCircle,
  Palette,
  Receipt,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useSearchParams } from "react-router";
import { ErrorState, LoadingBlock, PageContainer, PageHeader } from "@/components/common/page";
import { useSettings } from "@/hooks/queries";
import { cn } from "@/lib/utils";
import { useCan } from "@/stores/session";
import { AboutSection, AppearanceSection } from "./sections/about";
import { BackupSection } from "./sections/backup";
import { GymSection, MembershipSection, PaymentsSection, SecuritySection } from "./sections/general";
import { UsersSection } from "./sections/users";
import { WhatsappSection } from "./sections/whatsapp";

const TABS = [
  { key: "gym", label: "Gym profile", icon: Building, admin: true },
  { key: "membership", label: "Membership rules", icon: Users, admin: true },
  { key: "payments", label: "Payments & receipts", icon: Receipt, admin: true },
  { key: "whatsapp", label: "WhatsApp messages", icon: MessageCircle, admin: true },
  { key: "users", label: "Users & security", icon: ShieldCheck, admin: true },
  { key: "backup", label: "Backup & restore", icon: DatabaseBackup, admin: false },
  { key: "appearance", label: "Appearance & PIN", icon: Palette, admin: false },
  { key: "about", label: "About", icon: Info, admin: false },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export function SettingsPage() {
  const isAdmin = useCan("manageSettings");
  const settings = useSettings();
  const [params, setParams] = useSearchParams();
  const visible = TABS.filter((t) => isAdmin || !t.admin);
  const requested = params.get("tab") as TabKey | null;
  const tab: TabKey = visible.some((t) => t.key === requested) ? (requested as TabKey) : visible[0].key;

  return (
    <PageContainer>
      <PageHeader
        title="Settings"
        description="Set up the gym once — every screen, receipt and message uses these values."
      />
      <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav className="flex flex-row flex-wrap gap-1 lg:flex-col">
          {visible.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setParams({ tab: t.key }, { replace: true })}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-3 py-2 text-left font-medium text-sm transition-colors hover:bg-muted",
                tab === t.key
                  ? "bg-card text-foreground shadow-sm ring-1 ring-border"
                  : "text-muted-foreground",
              )}
            >
              <t.icon className="size-4" /> {t.label}
            </button>
          ))}
        </nav>
        <div className="min-w-0">
          {settings.isPending ? (
            <LoadingBlock />
          ) : settings.error ? (
            <ErrorState error={settings.error} onRetry={() => settings.refetch()} />
          ) : (
            <>
              {tab === "gym" && <GymSection settings={settings.data} />}
              {tab === "membership" && <MembershipSection settings={settings.data} />}
              {tab === "payments" && <PaymentsSection settings={settings.data} />}
              {tab === "whatsapp" && <WhatsappSection settings={settings.data} />}
              {tab === "users" && (
                <div className="flex flex-col gap-5">
                  <UsersSection />
                  <SecuritySection settings={settings.data} />
                </div>
              )}
              {tab === "backup" && <BackupSection settings={settings.data} />}
              {tab === "appearance" && <AppearanceSection />}
              {tab === "about" && <AboutSection />}
            </>
          )}
        </div>
      </div>
    </PageContainer>
  );
}
