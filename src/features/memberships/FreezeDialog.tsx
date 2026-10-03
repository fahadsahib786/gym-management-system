import { useQuery } from "@tanstack/react-query";
import { addDays, format } from "date-fns";
import { Snowflake } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/api/client";
import { errorMessage } from "@/api/errors";
import { Field } from "@/components/common/fields";
import { MemberSummary } from "@/components/common/member-picker";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatDate, parseDate, todayISO } from "@/lib/format";

export function FreezeDialog({
  memberId,
  onOpenChange,
}: {
  memberId: string;
  onOpenChange: (open: boolean) => void;
}) {
  const member = useQuery({
    queryKey: ["member-quick", memberId],
    queryFn: () => api.members.quick(memberId),
  });
  const [start, setStart] = useState(todayISO());
  const [days, setDays] = useState(15);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const end = member.data?.endDate ? parseDate(member.data.endDate) : null;
  const newEnd = end ? format(addDays(end, days), "yyyy-MM-dd") : null;
  const freezeEnd = parseDate(start)
    ? format(addDays(parseDate(start) as Date, days - 1), "yyyy-MM-dd")
    : null;

  const save = async () => {
    setBusy(true);
    try {
      await api.freezes.create({ memberId, startDate: start, days, reason: reason.trim() || null });
      toast.success(`Membership frozen for ${days} days`, {
        description: newEnd ? `New end date: ${formatDate(newEnd)}` : undefined,
      });
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
          <DialogTitle>Freeze membership</DialogTitle>
          <DialogDescription>
            Pause for travel, illness or exams — the frozen days are added to the end date.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          {member.data && <MemberSummary member={member.data} />}
          <Field label="Freeze from">
            <DateField value={start} onChange={setStart} />
          </Field>
          <Field label="Number of days">
            <div className="flex items-center gap-2">
              <Input
                inputMode="numeric"
                className="w-24"
                value={days || ""}
                onChange={(e) => setDays(Math.min(180, Number(e.target.value.replace(/\D/g, "")) || 0))}
              />
              {[7, 15, 30].map((d) => (
                <Button
                  key={d}
                  size="sm"
                  variant={days === d ? "default" : "outline"}
                  onClick={() => setDays(d)}
                >
                  {d} days
                </Button>
              ))}
            </div>
          </Field>
          <Field label="Reason" hint="Optional">
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Travelling to Lahore"
            />
          </Field>
          {newEnd && freezeEnd && days > 0 && (
            <div className="flex items-start gap-2 rounded-lg bg-info-soft px-3 py-2 text-info-ink text-sm">
              <Snowflake className="mt-0.5 size-4 shrink-0" />
              <span>
                Frozen {formatDate(start)} – {formatDate(freezeEnd)}. Membership will end on{" "}
                <b>{formatDate(newEnd)}</b> instead of {formatDate(member.data?.endDate)}.
              </span>
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} loading={busy} disabled={days < 1}>
            <Snowflake /> Freeze
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
