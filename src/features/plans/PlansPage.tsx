import { Pencil, Plus, Tag, Trash, Users } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import type { DurationUnit, Plan } from "@/api/bindings";
import { api } from "@/api/client";
import { errorMessage } from "@/api/errors";
import { Field, MoneyInput } from "@/components/common/fields";
import { EmptyState, ErrorState, LoadingBlock, PageContainer, PageHeader } from "@/components/common/page";
import { ConfirmDialog } from "@/components/common/widgets";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, Switch } from "@/components/ui/menus";
import { Badge, Card } from "@/components/ui/primitives";
import { usePlans, useSettings } from "@/hooks/queries";
import { money, num } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useCan } from "@/stores/session";

export function durationLabel(value: number, unit: DurationUnit) {
  if (unit === "month") return value === 12 ? "1 year" : `${value} month${value === 1 ? "" : "s"}`;
  return `${value} day${value === 1 ? "" : "s"}`;
}

function PlanDialog({ plan, onOpenChange }: { plan: Plan | null; onOpenChange: (o: boolean) => void }) {
  const [name, setName] = useState(plan?.name ?? "");
  const [value, setValue] = useState(plan?.durationValue ?? 1);
  const [unit, setUnit] = useState<DurationUnit>(plan?.durationUnit ?? "month");
  const [price, setPrice] = useState(plan?.price ?? 0);
  const [description, setDescription] = useState(plan?.description ?? "");
  const [active, setActive] = useState(plan?.isActive ?? true);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await api.plans.save({
        id: plan?.id ?? null,
        name,
        durationValue: value,
        durationUnit: unit,
        price,
        description: description.trim() || null,
        color: null,
        isActive: active,
        sortOrder: plan?.sortOrder ?? null,
      });
      toast.success(plan ? "Plan updated — new renewals use the new fee" : "Plan created");
      onOpenChange(false);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{plan ? "Edit plan" : "New plan"}</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <Field label="Name" required>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Monthly (Gym + Cardio)"
              autoFocus
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Duration">
              <Input
                inputMode="numeric"
                value={value || ""}
                onChange={(e) => setValue(Number(e.target.value.replace(/\D/g, "").slice(0, 4)) || 0)}
              />
            </Field>
            <Field label="Unit">
              <Select
                value={unit}
                onValueChange={(v) => setUnit(v as DurationUnit)}
                options={[
                  { value: "month", label: "Months" },
                  { value: "day", label: "Days" },
                ]}
              />
            </Field>
          </div>
          <Field label="Fee" required>
            <MoneyInput value={price} onChange={setPrice} />
          </Field>
          <Field label="Description" hint="Optional, shown when choosing a plan">
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>
              <span className="font-medium">Available for new memberships</span>
              <span className="block text-muted-foreground text-xs">
                Turn off old plans instead of deleting them.
              </span>
            </span>
            <Switch checked={active} onCheckedChange={setActive} />
          </label>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!name.trim() || value < 1}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PlansPage() {
  const canManage = useCan("managePlans");
  const plans = usePlans(true);
  const settings = useSettings();
  const [editing, setEditing] = useState<Plan | null | "new">(null);
  const [deleting, setDeleting] = useState<Plan | null>(null);

  return (
    <PageContainer>
      <PageHeader
        icon={<Tag />}
        title="Plans & fees"
        description="Membership packages offered at the gym. Changing a fee never changes memberships already sold."
        actions={
          canManage && (
            <Button onClick={() => setEditing("new")}>
              <Plus /> New plan
            </Button>
          )
        }
      />
      {settings.data && (
        <Card className="mb-5 flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <div className="font-medium">
              Admission fee: {money(settings.data.membership.defaultAdmissionFee)}
            </div>
            <div className="text-muted-foreground text-sm">
              Charged once when a new member joins (can be changed per member at registration).
            </div>
          </div>
          {canManage && (
            <Button variant="outline" asChild>
              <Link to="/settings?tab=membership">Change admission fee</Link>
            </Button>
          )}
        </Card>
      )}
      {plans.isPending ? (
        <LoadingBlock />
      ) : plans.error ? (
        <ErrorState error={plans.error} onRetry={() => plans.refetch()} />
      ) : plans.data.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Tag />}
            title="No plans yet"
            action={canManage && <Button onClick={() => setEditing("new")}>Create the first plan</Button>}
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {plans.data.map((p) => (
            <Card key={p.id} className={cn("flex flex-col p-5", !p.isActive && "opacity-60")}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-semibold">{p.name}</div>
                  <div className="text-muted-foreground text-sm">
                    {durationLabel(p.durationValue, p.durationUnit)}
                  </div>
                </div>
                {!p.isActive && <Badge>Turned off</Badge>}
              </div>
              <div className="mt-4 font-semibold text-3xl tracking-tight">{money(p.price)}</div>
              {p.description && <p className="mt-1 text-muted-foreground text-sm">{p.description}</p>}
              <div className="mt-4 flex items-center gap-2 text-muted-foreground text-sm">
                <Users className="size-4" /> {num(p.activeMembers)} active members
              </div>
              {canManage && (
                <div className="mt-4 flex gap-2 border-t pt-3">
                  <Button size="sm" variant="outline" onClick={() => setEditing(p)}>
                    <Pencil /> Edit
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDeleting(p)}>
                    <Trash /> Delete
                  </Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
      {editing && (
        <PlanDialog plan={editing === "new" ? null : editing} onOpenChange={(o) => !o && setEditing(null)} />
      )}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete plan “${deleting?.name ?? ""}”?`}
        description="Only plans never used by any member can be deleted. Used plans can be turned off instead."
        confirmLabel="Delete plan"
        destructive
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await api.plans.remove(deleting.id);
            toast.success("Plan deleted");
          } catch (e) {
            toast.error(errorMessage(e));
            throw e;
          }
        }}
      />
    </PageContainer>
  );
}
