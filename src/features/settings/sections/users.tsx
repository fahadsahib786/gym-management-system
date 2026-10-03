import { useQuery } from "@tanstack/react-query";
import { KeyRound, Pencil, Plus, UserRound } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { Role, UserSummary } from "@/api/bindings";
import { api } from "@/api/client";
import { errorMessage } from "@/api/errors";
import { Field } from "@/components/common/fields";
import { ErrorState, LoadingBlock } from "@/components/common/page";
import { Button } from "@/components/ui/button";
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
import { Segmented, Switch } from "@/components/ui/menus";
import { Badge, Card, CardHeader, CardTitle } from "@/components/ui/primitives";
import { initials, timeAgo } from "@/lib/format";
import { useSession } from "@/stores/session";

function PinFields({
  pin,
  setPin,
  pin2,
  setPin2,
}: {
  pin: string;
  setPin: (v: string) => void;
  pin2: string;
  setPin2: (v: string) => void;
}) {
  const clean = (v: string) => v.replace(/\D/g, "").slice(0, 8);
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="PIN (4–8 digits)">
        <Input
          type="password"
          inputMode="numeric"
          value={pin}
          onChange={(e) => setPin(clean(e.target.value))}
          placeholder="••••"
        />
      </Field>
      <Field label="Repeat PIN" error={pin2 && pin !== pin2 ? "PINs do not match" : null}>
        <Input
          type="password"
          inputMode="numeric"
          value={pin2}
          onChange={(e) => setPin2(clean(e.target.value))}
          placeholder="••••"
        />
      </Field>
    </div>
  );
}

function UserDialog({
  user,
  onOpenChange,
}: {
  user: UserSummary | null;
  onOpenChange: (o: boolean) => void;
}) {
  const [name, setName] = useState(user?.name ?? "");
  const [role, setRole] = useState<Role>(user?.role ?? "staff");
  const [active, setActive] = useState(user?.isActive ?? true);
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [busy, setBusy] = useState(false);
  const pinOk = user ? true : pin.length >= 4 && pin === pin2;
  const submit = async () => {
    setBusy(true);
    try {
      if (user) {
        await api.users.update({ id: user.id, name, role, isActive: active });
        toast.success("User updated");
      } else {
        await api.users.create({ name, role, pin });
        toast.success(`${name.trim()} can now log in with their PIN`);
      }
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
          <DialogTitle>{user ? `Edit ${user.name}` : "Add a user"}</DialogTitle>
          <DialogDescription>
            Each person at the desk should have their own PIN, so the activity log shows who did what.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <Field label="Name">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              placeholder="e.g. Ali (Reception)"
            />
          </Field>
          <Field
            label="Role"
            hint={
              role === "admin"
                ? "Full access: money reports, corrections, settings and users."
                : "Front desk: registration, fees, renewals, check-in, reminders."
            }
          >
            <Segmented
              value={role}
              onChange={(v) => setRole(v as Role)}
              options={[
                { value: "staff", label: "Receptionist" },
                { value: "admin", label: "Owner / Admin" },
              ]}
            />
          </Field>
          {!user && <PinFields pin={pin} setPin={setPin} pin2={pin2} setPin2={setPin2} />}
          {user && (
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>
                <span className="font-medium">Account active</span>
                <span className="block text-muted-foreground text-xs">
                  Turn off for staff who left (their history stays).
                </span>
              </span>
              <Switch checked={active} onCheckedChange={setActive} />
            </label>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={name.trim().length < 2 || !pinOk}>
            {user ? "Save" : "Add user"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResetPinDialog({ user, onOpenChange }: { user: UserSummary; onOpenChange: (o: boolean) => void }) {
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await api.users.resetPin(user.id, pin);
      toast.success(`New PIN set for ${user.name}`);
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
          <DialogTitle>New PIN for {user.name}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <PinFields pin={pin} setPin={setPin} pin2={pin2} setPin2={setPin2} />
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={pin.length < 4 || pin !== pin2}>
            Set PIN
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function UsersSection() {
  const me = useSession((s) => s.actor);
  const users = useQuery({ queryKey: ["users", true], queryFn: () => api.users.list(true) });
  const [editing, setEditing] = useState<UserSummary | null | "new">(null);
  const [resetting, setResetting] = useState<UserSummary | null>(null);
  return (
    <Card className="overflow-hidden">
      <CardHeader className="items-center">
        <div>
          <CardTitle>Users</CardTitle>
          <p className="mt-1 text-muted-foreground text-xs">People who can log in to this computer.</p>
        </div>
        <Button size="sm" onClick={() => setEditing("new")}>
          <Plus /> Add user
        </Button>
      </CardHeader>
      {users.isPending ? (
        <LoadingBlock />
      ) : users.error ? (
        <ErrorState error={users.error} />
      ) : (
        <ul className="divide-y">
          {users.data.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <div className="flex size-10 items-center justify-center rounded-full bg-accent font-semibold text-accent-foreground text-sm">
                {initials(u.name)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 font-medium">
                  {u.name} {u.id === me?.userId && <Badge variant="outline">You</Badge>}
                </div>
                <div className="text-muted-foreground text-xs">
                  Last login: {u.lastLoginAt ? timeAgo(u.lastLoginAt) : "never"}
                </div>
              </div>
              <Badge variant={u.role === "admin" ? "primary" : "neutral"}>
                <UserRound /> {u.role === "admin" ? "Owner / Admin" : "Receptionist"}
              </Badge>
              {!u.isActive && <Badge variant="danger">Turned off</Badge>}
              <Button size="sm" variant="ghost" onClick={() => setResetting(u)}>
                <KeyRound /> PIN
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(u)}>
                <Pencil /> Edit
              </Button>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <UserDialog user={editing === "new" ? null : editing} onOpenChange={(o) => !o && setEditing(null)} />
      )}
      {resetting && <ResetPinDialog user={resetting} onOpenChange={(o) => !o && setResetting(null)} />}
    </Card>
  );
}
