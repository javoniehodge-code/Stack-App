import type { Metadata } from "next";
import BlockedScreen from "./BlockedScreen";

export const metadata: Metadata = { title: "Blocked accounts" };

export default function BlockedPage() {
  return <BlockedScreen />;
}
