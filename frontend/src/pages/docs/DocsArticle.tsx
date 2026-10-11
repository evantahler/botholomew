import { useParams } from "react-router-dom";
import Alert from "#ui/Alert";
import Card from "#ui/Card";
import MarkdownBlock from "../../components/MarkdownBlock";
import { findDocsSection } from "../../content/docs/sections";

/**
 * One docs page: markdown from `content/docs/` rendered into the terminal theme.
 *
 * Unknown slugs say so inside the docs chrome rather than falling through to the
 * app-level catch-all and losing the sidebar — the same bargain the settings
 * section routes make.
 * @returns The rendered article, or a not-found notice.
 */
export default function DocsArticle() {
  const { slug } = useParams<{ slug: string }>();
  const section = slug ? findDocsSection(slug) : undefined;

  if (!section) {
    return (
      <Alert variant="warning" data-testid="no-such-docs-page">
        No such page.
      </Alert>
    );
  }

  return (
    <Card data-testid={`docs-page-${section.slug}`}>
      <Card.Body>
        <MarkdownBlock internalLinks testId={`docs-markdown-${section.slug}`}>
          {section.source}
        </MarkdownBlock>
      </Card.Body>
    </Card>
  );
}
