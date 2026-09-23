"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth, useToast } from "@/components/AppProviders";
import shell from "@/components/AppShell.module.css";
import { MAX_LINE, TAG_SUGGESTIONS } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import type { Draft, DraftLine, DraftSection } from "@/lib/types";
import s from "./Create.module.css";

export default function CreateScreen({ initial }: { initial: Draft }) {
  const router = useRouter();
  const { requireAuth } = useAuth();
  const toast = useToast();
  const [draft, setDraft] = useState<Draft>(initial);
  const [tagInput, setTagInput] = useState("");
  const [saving, setSaving] = useState(false);

  const setSections = (fn: (secs: DraftSection[]) => DraftSection[]) => setDraft((d) => ({ ...d, sections: fn(d.sections) }));
  const setLine = (si: number, li: number, patch: Partial<DraftLine>) =>
    setSections((secs) => secs.map((sec, i) => (i !== si ? sec : { ...sec, lines: sec.lines.map((ln, j) => (j === li ? { ...ln, ...patch } : ln)) })));

  function addTag(raw: string) {
    const t = raw.trim().replace(/^#/, "").slice(0, 40);
    setTagInput("");
    if (!t) return;
    setDraft((d) => (d.tags.some((x) => x.toLowerCase() === t.toLowerCase()) || d.tags.length >= 20 ? d : { ...d, tags: [...d.tags, t] }));
  }
  const removeTag = (t: string) => setDraft((d) => ({ ...d, tags: d.tags.filter((x) => x !== t) }));

  const hasLine = draft.sections.some((sec) => sec.lines.some((l) => l.text.trim()));
  const canPublish = draft.title.trim().length > 0 && hasLine;
  const badLink = draft.sections.some((sec) => sec.lines.some((l) => l.text.trim() && l.link.trim() && !/^https?:\/\/\S+$/i.test(l.link.trim())));

  async function save(status: "draft" | "published") {
    if (saving) return;
    setSaving(true);
    const { error } = await createClient().rpc("save_stack", {
      p_id: draft.id,
      p_title: status === "draft" && !draft.title.trim() ? "Untitled draft" : draft.title,
      p_sections: draft.sections.map((sec) => ({ label: sec.label, lines: sec.lines.map((l) => ({ text: l.text, link: l.link || null })) })),
      p_tags: draft.tags,
      p_status: status,
      p_forked_from: draft.forkedFromId,
      p_style: draft.style,
    });
    setSaving(false);
    if (error) {
      toast(error.message.includes("sign in") ? "Sign in to continue." : `Couldn't save: ${error.message}`);
      return;
    }
    toast(status === "published" ? "Published" : "Draft saved");
    router.push(status === "published" ? "/profile" : "/profile?tab=drafts");
    router.refresh();
  }

  function publish() {
    if (!canPublish) {
      toast("Add a title and at least one line to publish.");
      return;
    }
    if (badLink) {
      toast("Links need to start with http:// or https://");
      return;
    }
    requireAuth(() => save("published"), "Sign in to publish this stack and share it with others.");
  }

  function saveDraft() {
    if (badLink) {
      toast("Links need to start with http:// or https://");
      return;
    }
    requireAuth(() => save("draft"), "Sign in to save this stack as a draft.");
  }

  const suggestions = TAG_SUGGESTIONS.filter((n) => !draft.tags.some((t) => t.toLowerCase() === n.toLowerCase()));

  return (
    <main className={shell.screen}>
      <header className={s.header}>
        <button className={s.cancel} onClick={() => router.push("/")}>
          Cancel
        </button>
        <h1 className={s.heading}>{draft.id ? "Edit Draft" : "New Stack"}</h1>
        <div className={s.headerActions}>
          <button className={s.cancel} onClick={saveDraft} disabled={saving}>
            Save Draft
          </button>
          <button className={s.publish} style={{ color: canPublish ? "var(--accent)" : "var(--muted-56)" }} onClick={publish} disabled={saving} aria-disabled={!canPublish}>
            Publish
          </button>
        </div>
      </header>

      <div className={s.body}>
        <input
          className={s.titleInput}
          value={draft.title}
          maxLength={MAX_LINE}
          onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
          placeholder="Untitled stack"
          aria-label="Title"
        />

        {draft.sections.map((sec, si) => (
          <div key={si} className={s.section}>
            <div className={s.sectionHead}>
              <input
                className={s.sectionInput}
                value={sec.label}
                maxLength={60}
                onChange={(e) => setSections((secs) => secs.map((x, i) => (i === si ? { ...x, label: e.target.value } : x)))}
                placeholder="Subsection (optional)"
                aria-label={`Subsection ${si + 1} name`}
              />
              {si > 0 && (
                <button className={s.remove} onClick={() => setSections((secs) => secs.filter((_, i) => i !== si))}>
                  Remove
                </button>
              )}
            </div>
            {sec.lines.map((ln, li) => {
              const linkOpen = !!ln.linkOpen || !!ln.link;
              return (
                <div key={li} className={s.lineWrap}>
                  <div className={s.lineRow}>
                    <span className={s.num}>{String(li + 1).padStart(2, "0")}</span>
                    <input
                      className={s.lineInput}
                      value={ln.text}
                      maxLength={MAX_LINE}
                      onChange={(e) => setLine(si, li, { text: e.target.value.slice(0, MAX_LINE) })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          setSections((secs) => secs.map((x, i) => (i === si ? { ...x, lines: [...x.lines.slice(0, li + 1), { text: "", link: "" }, ...x.lines.slice(li + 1)] } : x)));
                        }
                      }}
                      placeholder="Add a line…"
                      aria-label={`Line ${li + 1}`}
                    />
                    <span className={s.remaining} aria-live="polite">
                      {MAX_LINE - ln.text.length}
                    </span>
                    <button className={s.removeLine} aria-label={`Remove line ${li + 1}`} onClick={() => setSections((secs) => secs.map((x, i) => (i === si ? { ...x, lines: x.lines.filter((_, j) => j !== li) } : x)))}>
                      ×
                    </button>
                  </div>
                  {linkOpen ? (
                    <input
                      className={s.linkInput}
                      type="url"
                      inputMode="url"
                      value={ln.link}
                      onChange={(e) => setLine(si, li, { link: e.target.value })}
                      placeholder="https://…"
                      aria-label={`Link for line ${li + 1}`}
                      autoFocus={!!ln.linkOpen && !ln.link}
                    />
                  ) : (
                    <button className={s.addLink} onClick={() => setLine(si, li, { linkOpen: true })}>
                      + link
                    </button>
                  )}
                </div>
              );
            })}
            <button className={s.addLine} onClick={() => setSections((secs) => secs.map((x, i) => (i === si ? { ...x, lines: [...x.lines, { text: "", link: "" }] } : x)))}>
              + Add line
            </button>
          </div>
        ))}

        <button className={s.addSection} onClick={() => setSections((secs) => [...secs, { label: "", lines: [{ text: "", link: "" }] }])}>
          + Add subsection
        </button>

        <div className={s.tags}>
          <div className={s.tagsLabel}>Tags</div>
          <div className={s.tagsHelp}>Tags help people find this stack in search. They stay private — nobody sees them on the published stack.</div>
          {draft.tags.length > 0 && (
            <div className={s.tagList}>
              {draft.tags.map((t) => (
                <span key={t} className={s.tag}>
                  {t}
                  <button className={s.tagRemove} aria-label={`Remove tag ${t}`} onClick={() => removeTag(t)}>
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          <input
            className={s.tagInput}
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                addTag(tagInput);
              } else if (e.key === "Backspace" && tagInput === "" && draft.tags.length) {
                removeTag(draft.tags[draft.tags.length - 1]);
              }
            }}
            onBlur={() => tagInput.trim() && addTag(tagInput)}
            placeholder="Type a tag and press Enter"
            aria-label="Add a tag"
            enterKeyHint="done"
          />
          {suggestions.length > 0 && (
            <>
              <div className={s.suggestLabel}>Suggestions</div>
              <div className={s.tagList} style={{ marginBottom: 0 }}>
                {suggestions.map((n) => (
                  <button key={n} className={s.suggestion} onClick={() => addTag(n)}>
                    + {n}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
