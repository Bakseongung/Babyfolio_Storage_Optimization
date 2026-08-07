import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { currentUser } from "@/lib/current-user";
import { safeReturnTo } from "@/lib/return-to";

export default async function SignupPage({
  searchParams
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const returnTo = safeReturnTo((await searchParams).returnTo);
  if (await currentUser()) redirect(returnTo);
  return <AuthForm mode="signup" returnTo={returnTo} />;
}
