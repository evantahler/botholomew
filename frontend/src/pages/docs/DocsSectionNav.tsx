import SectionNav, {
  type SectionNavItem,
} from "../../components/sections/SectionNav";
import { DOCS_SECTIONS } from "../../content/docs/sections";

/**
 * The docs sidebar: {@link DOCS_SECTIONS} mapped onto `SectionNav`'s items.
 *
 * Public docs reuse the same sidenav chrome as settings so a reader who is
 * also a signed-in member gets one navigation language. Every
 * entry is a link — there is no standing gate on documentation.
 * @returns The rendered sidebar.
 */
export default function DocsSectionNav() {
  const items: SectionNavItem[] = DOCS_SECTIONS.map((section) => ({
    slug: section.slug,
    label: section.label,
    group: section.group,
    to: `/docs/${section.slug}`,
  }));

  return <SectionNav testId="docs-section-nav" items={items} />;
}
