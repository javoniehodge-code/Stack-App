import type { Metadata } from "next";
import AccountScreen from "./AccountScreen";

export const metadata: Metadata = { title: "Account and sign-in" };

export default function AccountPage() {
  return <AccountScreen />;
}
