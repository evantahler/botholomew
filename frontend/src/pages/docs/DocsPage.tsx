import { Outlet } from "react-router-dom";
import Col from "#ui/Col";
import Row from "#ui/Row";
import DocsSectionNav from "./DocsSectionNav";

/**
 * `/docs/*` — the public documentation shell: section sidebar and the article.
 *
 * Available signed-in and signed-out. Content is markdown under
 * `frontend/src/content/docs/`; this page is only chrome.
 * @returns The rendered docs area.
 */
export default function DocsPage() {
  return (
    <>
      <h1 className="mt-3" data-testid="docs-title">
        Docs
      </h1>
      <span className="bh-rule" aria-hidden="true" />

      <Row className="g-3">
        <Col md={3}>
          <DocsSectionNav />
        </Col>
        <Col md={9}>
          <Outlet />
        </Col>
      </Row>
    </>
  );
}
