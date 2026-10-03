import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, Pencil, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { api } from "@/api/client";
import { errorMessage, toAppError } from "@/api/errors";
import { ErrorState, LoadingBlock, PageContainer, PageHeader } from "@/components/common/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/primitives";
import { useHotkeys } from "@/hooks/common";
import { useMember } from "@/hooks/queries";
import {
  emptyMember,
  formToInput,
  MemberDetails,
  MemberEssentials,
  type MemberFormValues,
  memberSchema,
  memberToForm,
} from "./memberForm";

export function EditMemberPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const member = useMember(id);
  const form = useForm<MemberFormValues>({
    resolver: zodResolver(memberSchema),
    defaultValues: emptyMember(),
    mode: "onTouched",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (member.data) form.reset(memberToForm(member.data));
  }, [member.data, form]);

  const submit = form.handleSubmit(async (values) => {
    setSaving(true);
    try {
      await api.members.update(id, formToInput(values));
      toast.success("Member details saved");
      navigate(`/members/${id}`);
    } catch (e) {
      const err = toAppError(e);
      if (err.field && err.field in values)
        form.setError(err.field as keyof MemberFormValues, { message: err.message });
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  });

  useHotkeys({ "ctrl+s": () => void submit() });

  if (member.isPending) return <LoadingBlock className="py-24" />;
  if (member.error) return <ErrorState error={member.error} onRetry={() => member.refetch()} />;

  return (
    <PageContainer className="max-w-4xl">
      <PageHeader
        icon={<Pencil />}
        title={`Edit ${member.data.fullName}`}
        description={`${member.data.memberCode} · Fees and memberships are changed from the profile, not here.`}
        actions={
          <>
            <Button variant="outline" onClick={() => navigate(`/members/${id}`)}>
              <ArrowLeft /> Back
            </Button>
            <Button onClick={() => void submit()} loading={saving}>
              <Save /> Save changes
            </Button>
          </>
        }
      />
      <div className="flex flex-col gap-5">
        <Card>
          <CardHeader>
            <CardTitle>Member details</CardTitle>
          </CardHeader>
          <CardContent>
            <MemberEssentials form={form} />
          </CardContent>
        </Card>
        <MemberDetails form={form} defaultOpen />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => navigate(`/members/${id}`)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={saving}>
            <Save /> Save changes
          </Button>
        </div>
      </div>
    </PageContainer>
  );
}
