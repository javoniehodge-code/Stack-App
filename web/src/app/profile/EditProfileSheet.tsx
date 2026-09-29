"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/components/AppProviders";
import sheet from "@/components/Sheet.module.css";
import { SocialIcon } from "@/components/SocialLinks";
import { fetchProfile } from "@/lib/queries";
import { CONTACT_TYPES, SOCIAL_FIELDS, toUrl } from "@/lib/socials";
import { createClient } from "@/lib/supabase/client";
import type { Profile, Socials } from "@/lib/types";
import p from "./Profile.module.css";

export default function EditProfileSheet({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { viewer, setViewer } = useAuth();
  const [name, setName] = useState(viewer?.name ?? "");
  const [handle, setHandle] = useState(viewer?.handle ?? "");
  const [bio, setBio] = useState(viewer?.bio ?? "");
  const [socials, setSocials] = useState<Socials>(viewer?.socials ?? {});
  // An older free-text button label is kept until a type is picked.
  const [contactLabel, setContactLabel] = useState(viewer?.featured_link_label ?? "");
  const [contactUrl, setContactUrl] = useState((viewer?.featured_link_url ?? "").replace(/^https?:\/\//, ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!viewer) return null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const h = handle.trim().replace(/^@/, "").toLowerCase();
    if (!/^[a-z0-9._]{2,30}$/.test(h)) {
      setError("Handles are 2–30 characters: letters, numbers, dots and underscores.");
      return;
    }
    if (!name.trim()) {
      setError("Add your name.");
      return;
    }
    setBusy(true);
    setError(null);
    const sb = createClient();
    const changes: Partial<Profile> = { name: name.trim(), handle: h, bio: bio.trim() };
    // Only send socials when they changed, so the rest still saves before the profile_featured migration.
    if (JSON.stringify(socials) !== JSON.stringify(viewer!.socials)) changes.socials = socials;
    const url = toUrl(contactUrl);
    const label = url ? contactLabel.trim() || "Website" : null;
    if (label !== viewer!.featured_link_label || (url || null) !== viewer!.featured_link_url) {
      changes.featured_link_label = label;
      changes.featured_link_url = url || null;
    }
    const { error } = await sb.from("profiles").update(changes).eq("id", viewer!.id);
    const data = error ? null : await fetchProfile(sb, "id", viewer!.id);
    setBusy(false);
    if (error) {
      setError(error.code === "23505" ? "That handle is taken." : error.message);
      return;
    }
    if (data) setViewer(data);
    router.refresh();
    onClose();
  }

  async function signOut() {
    await createClient().auth.signOut();
    onClose();
    router.push("/");
    router.refresh();
  }

  return (
    <div className={sheet.scrim} onClick={onClose}>
      <form className={sheet.sheet} onClick={(e) => e.stopPropagation()} onSubmit={save} role="dialog" aria-modal="true" aria-labelledby="edit-title">
        <div className={sheet.grabber} />
        <div id="edit-title" className={sheet.title} style={{ marginBottom: 18 }}>
          Edit profile
        </div>
        <label className={sheet.label} htmlFor="ep-name">
          Name
        </label>
        <input id="ep-name" className={sheet.input} value={name} maxLength={50} onChange={(e) => setName(e.target.value)} />
        <label className={sheet.label} htmlFor="ep-handle">
          Handle
        </label>
        <input id="ep-handle" className={sheet.input} value={handle} maxLength={31} autoCapitalize="none" autoCorrect="off" onChange={(e) => setHandle(e.target.value)} />
        <div className={p.bioLabelRow}>
          <label className={sheet.label} htmlFor="ep-bio">
            Bio
          </label>
          <span className={p.bioCount} style={{ color: bio.length >= 150 ? "oklch(54% 0.16 45)" : undefined }}>
            {bio.length} / 160
          </span>
        </div>
        <textarea id="ep-bio" className={sheet.input} rows={3} value={bio} maxLength={160} onChange={(e) => setBio(e.target.value)} placeholder="A line about what you collect" />
        <div className={sheet.label} style={{ marginTop: 16 }}>
          Social links
        </div>
        <div className={p.socialHint}>Only filled-in links show on your profile.</div>
        <div className={p.socialFields}>
          {SOCIAL_FIELDS.map((f, i) => (
            <div key={f.key}>
              {f.group === "other" && SOCIAL_FIELDS[i - 1]?.group === "social" && <div className={sheet.label} style={{ margin: "8px 0 10px" }}>Other links</div>}
              <label className={p.socialField}>
                <span className={p.socialIcon}>
                  <SocialIcon name={f.key} />
                </span>
                <span className={p.socialBody}>
                  <span className={p.socialName}>{f.label}</span>
                  <input
                    value={socials[f.key] ?? ""}
                    maxLength={200}
                    onChange={(e) => setSocials((s) => ({ ...s, [f.key]: e.target.value }))}
                    placeholder={f.placeholder}
                    type={f.key === "email" ? "email" : "text"}
                    autoCapitalize="none"
                    autoCorrect="off"
                  />
                </span>
              </label>
            </div>
          ))}
        </div>
        <div className={sheet.label} style={{ marginTop: 6 }}>
          Custom link
        </div>
        <div className={p.socialHint} style={{ marginBottom: 10 }}>
          Shows as the button next to Follow on your profile.
        </div>
        <div className={p.typeChips}>
          {CONTACT_TYPES.map((t) => (
            <button key={t} type="button" className={`${p.typeChip} ${contactLabel === t ? p.typeChipOn : ""}`} aria-pressed={contactLabel === t} onClick={() => setContactLabel(t)}>
              {t}
            </button>
          ))}
        </div>
        <label className={p.socialField} style={{ marginBottom: 20 }}>
          <span className={p.socialIcon}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="oklch(28.6% 0.006 80)" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2" />
              <path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2" />
            </svg>
          </span>
          <span className={p.socialBody}>
            <span className={p.socialName}>{CONTACT_TYPES.includes(contactLabel) ? contactLabel : "Link"} URL</span>
            <input value={contactUrl} maxLength={300} inputMode="url" autoCapitalize="none" autoCorrect="off" onChange={(e) => setContactUrl(e.target.value)} placeholder="yoursite.com" />
          </span>
        </label>
        {error && <div className={sheet.error}>{error}</div>}
        <button type="submit" className={sheet.primary} disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" className={sheet.secondary} onClick={onClose}>
          Cancel
        </button>
        <button type="button" className={p.signOut} onClick={signOut}>
          Sign out
        </button>
      </form>
    </div>
  );
}
