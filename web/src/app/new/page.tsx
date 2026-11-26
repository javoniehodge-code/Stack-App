import type { Metadata } from "next";
import { blankDraft } from "@/lib/drafts";
import CreateScreen from "../create/CreateScreen";

export const metadata: Metadata = { title: "New Stack" };

/** A new stack, starting at the title. It becomes /drafts/<id> once its first save lands. */
export default function NewPage() {
  return <CreateScreen key="new" initial={blankDraft()} start="title" />;
}
