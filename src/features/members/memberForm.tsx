import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { Controller, type UseFormReturn } from "react-hook-form";
import { z } from "zod";
import type { Gender, Member, MemberInput } from "@/api/bindings";
import { api } from "@/api/client";
import { CnicInput, Field, PhoneInput } from "@/components/common/fields";
import { DateField } from "@/components/ui/date-field";
import { Input, Textarea } from "@/components/ui/input";
import { Segmented, Select } from "@/components/ui/menus";
import { useSettings } from "@/hooks/queries";
import { phoneDisplay, todayISO } from "@/lib/format";
import { isValidCnic, isValidPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";

const optionalText = (max: number) => z.string().max(max, `Maximum ${max} characters`);

export const memberSchema = z.object({
  memberCode: z
    .string()
    .max(20, "Maximum 20 characters")
    .refine((v) => /^[A-Za-z0-9\-_/]*$/.test(v.trim()), "Use letters, numbers and - / _ only"),
  fullName: z.string().trim().min(2, "Enter the member's full name").max(80),
  fatherName: optionalText(80),
  gender: z.enum(["male", "female", "other"]),
  dateOfBirth: z.string(),
  phone: z.string().refine(isValidPhone, "Enter a valid mobile number like 0300-1234567"),
  whatsapp: z.string().refine((v) => !v.trim() || isValidPhone(v), "Enter a valid WhatsApp number"),
  cnic: z.string().refine(isValidCnic, "CNIC must have 13 digits"),
  email: z
    .string()
    .refine((v) => !v.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()), "Enter a valid email"),
  address: optionalText(200),
  area: optionalText(60),
  occupation: optionalText(60),
  bloodGroup: z.string(),
  emergencyName: optionalText(80),
  emergencyPhone: z.string().max(20),
  medicalNotes: optionalText(1000),
  notes: optionalText(1000),
  timing: z.string(),
  source: z.string(),
  joinDate: z.string(),
});

export type MemberFormValues = z.infer<typeof memberSchema>;

export function emptyMember(): MemberFormValues {
  return {
    memberCode: "",
    fullName: "",
    fatherName: "",
    gender: "male",
    dateOfBirth: "",
    phone: "",
    whatsapp: "",
    cnic: "",
    email: "",
    address: "",
    area: "",
    occupation: "",
    bloodGroup: "",
    emergencyName: "",
    emergencyPhone: "",
    medicalNotes: "",
    notes: "",
    timing: "",
    source: "",
    joinDate: todayISO(),
  };
}

export function memberToForm(m: Member): MemberFormValues {
  return {
    memberCode: m.memberCode,
    fullName: m.fullName,
    fatherName: m.fatherName ?? "",
    gender: m.gender,
    dateOfBirth: m.dateOfBirth ?? "",
    phone: phoneDisplay(m.phone),
    whatsapp: m.whatsapp ? phoneDisplay(m.whatsapp) : "",
    cnic: m.cnic ?? "",
    email: m.email ?? "",
    address: m.address ?? "",
    area: m.area ?? "",
    occupation: m.occupation ?? "",
    bloodGroup: m.bloodGroup ?? "",
    emergencyName: m.emergencyName ?? "",
    emergencyPhone: m.emergencyPhone ? phoneDisplay(m.emergencyPhone) : "",
    medicalNotes: m.medicalNotes ?? "",
    notes: m.notes ?? "",
    timing: m.timing ?? "",
    source: m.source ?? "",
    joinDate: m.joinDate,
  };
}

const opt = (v: string) => (v.trim() ? v.trim() : null);

export function formToInput(v: MemberFormValues): MemberInput {
  return {
    memberCode: opt(v.memberCode),
    fullName: v.fullName.trim(),
    fatherName: opt(v.fatherName),
    gender: v.gender as Gender,
    dateOfBirth: opt(v.dateOfBirth),
    phone: v.phone.trim(),
    whatsapp: opt(v.whatsapp),
    cnic: opt(v.cnic),
    email: opt(v.email),
    address: opt(v.address),
    area: opt(v.area),
    occupation: opt(v.occupation),
    bloodGroup: opt(v.bloodGroup),
    emergencyName: opt(v.emergencyName),
    emergencyPhone: opt(v.emergencyPhone),
    medicalNotes: opt(v.medicalNotes),
    notes: opt(v.notes),
    timing: opt(v.timing),
    source: opt(v.source),
    joinDate: opt(v.joinDate),
  };
}

const BLOOD = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

export function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-3">
      <h3 className="font-semibold text-[0.95rem]">{title}</h3>
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
    </div>
  );
}

/** Core identity fields: name, gender, phone (with duplicate hints shown by the page). */
export function MemberEssentials({
  form,
  onPhoneBlur,
  onNameBlur,
  codePlaceholder,
  existingMode,
}: {
  form: UseFormReturn<MemberFormValues>;
  onPhoneBlur?: () => void;
  onNameBlur?: () => void;
  codePlaceholder?: string;
  existingMode?: boolean;
}) {
  const { register, control, formState } = form;
  const e = formState.errors;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field
        label="Full name"
        required
        error={e.fullName?.message}
        className="sm:col-span-2"
        htmlFor="fullName"
      >
        <Input
          id="fullName"
          autoFocus
          placeholder="e.g. Muhammad Ali"
          {...register("fullName", { onBlur: onNameBlur })}
          aria-invalid={!!e.fullName}
        />
      </Field>
      <Field label="Mobile / WhatsApp" required error={e.phone?.message} htmlFor="phone">
        <Controller
          control={control}
          name="phone"
          render={({ field }) => (
            <PhoneInput
              id="phone"
              value={field.value}
              onChange={field.onChange}
              onBlur={() => {
                field.onBlur();
                onPhoneBlur?.();
              }}
              aria-invalid={!!e.phone}
            />
          )}
        />
      </Field>
      <Field label="Gender" required>
        <Controller
          control={control}
          name="gender"
          render={({ field }) => (
            <Segmented
              className="w-full [&>button]:flex-1"
              value={field.value}
              onChange={field.onChange}
              options={[
                { value: "male", label: "Male" },
                { value: "female", label: "Female" },
                { value: "other", label: "Other" },
              ]}
            />
          )}
        />
      </Field>
      <Field
        label="Member ID"
        error={e.memberCode?.message}
        hint={
          existingMode
            ? "Type the old register number to keep it, or leave empty."
            : "Leave empty to use the next number."
        }
        htmlFor="memberCode"
      >
        <Input
          id="memberCode"
          placeholder={codePlaceholder ?? "Automatic"}
          {...register("memberCode")}
          aria-invalid={!!e.memberCode}
        />
      </Field>
      <Field label={existingMode ? "Original joining date" : "Joining date"} error={e.joinDate?.message}>
        <Controller
          control={control}
          name="joinDate"
          render={({ field }) => <DateField value={field.value} onChange={field.onChange} max={todayISO()} />}
        />
      </Field>
    </div>
  );
}

/** Optional details, collapsed by default to keep registration quick. */
export function MemberDetails({
  form,
  defaultOpen = false,
}: {
  form: UseFormReturn<MemberFormValues>;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const settings = useSettings();
  const suggestions = useQuery({
    queryKey: ["member-suggestions"],
    queryFn: api.members.suggestions,
    staleTime: 60_000,
    enabled: open,
  });
  const { register, control, formState } = form;
  const e = formState.errors;
  const timings = settings.data?.membership.timings ?? [];
  const sources = settings.data?.membership.sources ?? [];

  return (
    <div className="rounded-xl border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <div>
          <div className="font-semibold text-[0.95rem]">More details</div>
          <div className="text-muted-foreground text-xs">
            Father name, CNIC, date of birth, address, emergency contact, health notes…
          </div>
        </div>
        <ChevronDown
          className={cn("size-5 text-muted-foreground transition-transform", open && "rotate-180")}
        />
      </button>
      {open && (
        <div className="grid gap-4 border-t px-4 py-4 sm:grid-cols-2">
          <Field label="Father / husband name" error={e.fatherName?.message}>
            <Input {...register("fatherName")} />
          </Field>
          <Field label="CNIC" error={e.cnic?.message} hint="Optional">
            <Controller
              control={control}
              name="cnic"
              render={({ field }) => (
                <CnicInput value={field.value} onChange={field.onChange} aria-invalid={!!e.cnic} />
              )}
            />
          </Field>
          <Field
            label="Date of birth"
            error={e.dateOfBirth?.message}
            hint="For age stats and birthday wishes"
          >
            <Controller
              control={control}
              name="dateOfBirth"
              render={({ field }) => (
                <DateField
                  value={field.value}
                  onChange={field.onChange}
                  max={todayISO()}
                  clearable
                  yearDropdown
                  placeholder="Not given"
                />
              )}
            />
          </Field>
          <Field
            label="Different WhatsApp number"
            error={e.whatsapp?.message}
            hint="Only if WhatsApp is on another number"
          >
            <Controller
              control={control}
              name="whatsapp"
              render={({ field }) => (
                <PhoneInput value={field.value} onChange={field.onChange} aria-invalid={!!e.whatsapp} />
              )}
            />
          </Field>
          <Field label="Timing / batch">
            <Controller
              control={control}
              name="timing"
              render={({ field }) => (
                <Select
                  value={field.value || "__none"}
                  onValueChange={(v) => field.onChange(v === "__none" ? "" : v)}
                  options={[
                    { value: "__none", label: "Not set" },
                    ...timings.map((t) => ({ value: t, label: t })),
                  ]}
                />
              )}
            />
          </Field>
          <Field label="How did they hear about us?">
            <Controller
              control={control}
              name="source"
              render={({ field }) => (
                <Select
                  value={field.value || "__none"}
                  onValueChange={(v) => field.onChange(v === "__none" ? "" : v)}
                  options={[
                    { value: "__none", label: "Not set" },
                    ...sources.map((t) => ({ value: t, label: t })),
                  ]}
                />
              )}
            />
          </Field>
          <Field label="Area / locality">
            <Input list="area-suggestions" placeholder="e.g. Model Town B" {...register("area")} />
            <datalist id="area-suggestions">
              {suggestions.data?.areas.map((a) => (
                <option key={a} value={a} />
              ))}
            </datalist>
          </Field>
          <Field label="Occupation">
            <Input list="occupation-suggestions" placeholder="e.g. Student" {...register("occupation")} />
            <datalist id="occupation-suggestions">
              {suggestions.data?.occupations.map((a) => (
                <option key={a} value={a} />
              ))}
            </datalist>
          </Field>
          <Field label="Address" className="sm:col-span-2">
            <Input {...register("address")} />
          </Field>
          <Field label="Blood group">
            <Controller
              control={control}
              name="bloodGroup"
              render={({ field }) => (
                <Select
                  value={field.value || "__none"}
                  onValueChange={(v) => field.onChange(v === "__none" ? "" : v)}
                  options={[
                    { value: "__none", label: "Not known" },
                    ...BLOOD.map((b) => ({ value: b, label: b })),
                  ]}
                />
              )}
            />
          </Field>
          <Field label="Email" error={e.email?.message}>
            <Input type="email" {...register("email")} />
          </Field>
          <Field label="Emergency contact name">
            <Input {...register("emergencyName")} />
          </Field>
          <Field label="Emergency contact phone">
            <Controller
              control={control}
              name="emergencyPhone"
              render={({ field }) => <PhoneInput value={field.value} onChange={field.onChange} />}
            />
          </Field>
          <Field
            label="Health / injury notes"
            hint="Visible to trainers on the profile"
            className="sm:col-span-2"
          >
            <Textarea
              rows={2}
              placeholder="e.g. Knee injury — avoid heavy squats"
              {...register("medicalNotes")}
            />
          </Field>
          <Field label="Other notes" className="sm:col-span-2">
            <Textarea rows={2} {...register("notes")} />
          </Field>
        </div>
      )}
    </div>
  );
}
