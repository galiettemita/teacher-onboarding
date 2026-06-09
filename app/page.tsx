import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";

export default async function Home() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role === "admin") redirect("/admin/dashboard");
  redirect("/teacher/dashboard");
}
