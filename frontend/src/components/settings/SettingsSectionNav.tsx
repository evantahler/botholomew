import SectionNav, { type SectionNavItem } from "../sections/SectionNav";
import { SETTINGS_SECTIONS } from "./sections";

/** See {@link SettingsSectionNav}. */
export interface SettingsSectionNavProps {
  /** Which section is holding unsaved edits, if any. */
  dirtySlug?: string | null;
  /** Intercept a navigation. See `SectionNav`, which documents the contract. */
  onNavigate?: (slug: string) => boolean;
}

/**
 * The settings sidebar: {@link SETTINGS_SECTIONS} mapped onto `SectionNav`'s items.
 *
 * **Every section is a link, including the ones whose controls are admin-only**
 * — a decision rather than an omission. Two reasons. A deep link mounts the
 * section whatever the sidebar did, so `/settings/danger` typed or bookmarked by
 * a plain member needs its own "admins only" notice regardless; a disabled nav
 * item is redundant chrome in front of a message that has to exist anyway. And
 * standing arrives asynchronously, so gating the list flashes the whole sidebar
 * disabled→enabled for every admin on every load.
 *
 * There is no `problemCounts` here either: a project has no validator, so nothing
 * produces counts to render.
 * @param props - See {@link SettingsSectionNavProps}.
 * @returns The rendered sidebar.
 */
export default function SettingsSectionNav({
  dirtySlug = null,
  onNavigate,
}: SettingsSectionNavProps) {
  const items: SectionNavItem[] = SETTINGS_SECTIONS.map((section) => ({
    slug: section.slug,
    label: section.label,
    group: section.group,
    to: `/settings/${section.slug}`,
  }));

  return (
    <SectionNav
      testId="settings-section-nav"
      items={items}
      dirtySlug={dirtySlug}
      onNavigate={onNavigate}
    />
  );
}
