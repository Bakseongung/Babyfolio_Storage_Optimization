import { notFound } from "next/navigation";
import { InviteCard } from "@/components/invite-card";
import { ServerApiError, serverApi } from "@/lib/server-api";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let invite: { familyName: string; email: string };
  try {
    invite = await serverApi(`/invites/${token}`);
  } catch (error) {
    if (error instanceof ServerApiError && error.status === 404) notFound();
    throw error;
  }
  return <InviteCard token={token} familyName={invite.familyName} email={invite.email} />;
}
