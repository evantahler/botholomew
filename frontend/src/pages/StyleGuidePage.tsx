import { useState } from "react";
import Alert from "#ui/Alert";
import Badge from "#ui/Badge";
import Button from "#ui/Button";
import Card from "#ui/Card";
import Col from "#ui/Col";
import Dropdown from "#ui/Dropdown";
import Form from "#ui/Form";
import ListGroup from "#ui/ListGroup";
import Modal from "#ui/Modal";
import Nav from "#ui/Nav";
import Pagination from "#ui/Pagination";
import ProgressBar from "#ui/ProgressBar";
import Row from "#ui/Row";
import Table from "#ui/Table";
import LoadingLabel from "../components/LoadingLabel";
import MarkdownBlock from "../components/MarkdownBlock";
import SkeletonBlocks from "../components/SkeletonBlocks";
import SkeletonRows from "../components/SkeletonRows";

/** The button variants the theme is expected to cover. */
const VARIANTS = [
  "primary",
  "secondary",
  "success",
  "info",
  "warning",
  "danger",
  "light",
  "dark",
] as const;

/** Rows for the sample table — shaped like the members table the app renders. */
const MEMBERS = [
  { id: 1, name: "Peach", email: "peach@example.com", tags: "admin" },
  { id: 2, name: "Mario", email: "mario@example.com", tags: "operators" },
  { id: 3, name: "Toad", email: "toad@example.com", tags: "—" },
];

/**
 * A markdown document exercising everything `MarkdownBlock` has to get right.
 *
 * Every line of it is load bearing: the table and the task list are GFM (plain
 * CommonMark renders both as literal punctuation), and the `<script>` line must
 * survive as text — react-markdown drops raw HTML, and a regression into
 * `rehype-raw` turns model-authored prose into an XSS vector.
 */
const MARKDOWN_SAMPLE = `## Report

| member | tags | invites |
|---|:--:|---:|
| Peach | admin | 2 |
| Mario | ~~viewers~~ operators | 0 |

- [x] invited the team
- [ ] tagged the operators

Ran \`bun test\` and read the [audit log](https://example.com/audit).

\`\`\`ts
const answer = 42;
\`\`\`

> Nothing here is a second typeface.

<script>alert(1)</script>
`;

/**
 * The component gallery: every component the theme styles, on one page.
 *
 * This is how a theme regression gets caught by eye in one place instead of
 * being discovered on whichever page happens to use the broken component. It is
 * linked from the signed-in user menu so the people tuning these shared
 * primitives can reach the gallery without remembering a development URL.
 * @returns The rendered style guide.
 */
export default function StyleGuidePage() {
  const [showModal, setShowModal] = useState(false);

  return (
    <>
      <h1 className="mt-3">Style guide</h1>
      <p className="bh-muted">
        Every shared component the product theme covers, rendered with the same
        chrome and density as the application.
      </p>

      <h2 className="bh-section-title">Buttons</h2>
      <div className="d-flex flex-wrap gap-2 mb-2">
        {VARIANTS.map((variant) => (
          <Button
            key={variant}
            variant={variant}
            data-testid={`btn-${variant}`}
          >
            {variant}
          </Button>
        ))}
      </div>
      <div className="d-flex flex-wrap gap-2 mb-2">
        {VARIANTS.map((variant) => (
          <Button key={variant} variant={`outline-${variant}`}>
            {variant}
          </Button>
        ))}
      </div>
      <div className="d-flex flex-wrap gap-2 align-items-center">
        <Button size="sm">small</Button>
        <Button>default</Button>
        <Button size="lg">large</Button>
        <Button disabled>disabled</Button>
        <Button variant="link">link</Button>
        <Button onClick={() => setShowModal(true)} data-testid="open-modal">
          Open modal
        </Button>
      </div>
      <div
        className="d-flex flex-wrap gap-2 align-items-center mt-2"
        data-testid="style-save-buttons"
      >
        <Button variant="primary">Save primary</Button>
        <Button variant="secondary" data-testid="save-secondary">
          Save secondary
        </Button>
        <Button variant="outline-secondary">Save outline</Button>
        <Button disabled data-testid="save-disabled">
          Save disabled
        </Button>
      </div>

      <span className="bh-rule" aria-hidden="true" />
      <h2 className="bh-section-title">Menus</h2>
      {/* A menu of the page's own, rather than the navbar's. Every navbar menu
          disables something on a signed-out visit, which makes what it shows
          depend on session state the style guide has nothing to do with. This
          is the same header/items/divider shape those menus are built from,
          with one disabled row, so the disabled colour is on the page to be
          checked by eye. */}
      <Dropdown data-testid="sg-dropdown">
        <Dropdown.Toggle id="sg-dropdown" data-testid="sg-dropdown-toggle">
          Menu
        </Dropdown.Toggle>
        <Dropdown.Menu>
          <Dropdown.Header>Group</Dropdown.Header>
          <Dropdown.Item active>Selected item</Dropdown.Item>
          <Dropdown.Item>Item</Dropdown.Item>
          <Dropdown.Item disabled>Disabled item</Dropdown.Item>
          <Dropdown.Divider />
          <Dropdown.Item>Item after a divider</Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown>

      <span className="bh-rule" aria-hidden="true" />
      <h2 className="bh-section-title">Alerts</h2>
      <Alert variant="success">
        <Alert.Heading as="h3">Invite accepted</Alert.Heading>
        Mario joined the project holding the operators tag.
      </Alert>
      <Alert variant="info">Two invites are waiting on an answer.</Alert>
      <Alert variant="warning">
        You are the last admin; that tag cannot be removed.
      </Alert>
      <Alert variant="danger">That email already has an open invite.</Alert>

      <span className="bh-rule" aria-hidden="true" />
      <h2 className="bh-section-title">Table</h2>
      <Table striped hover data-testid="sample-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Tags</th>
          </tr>
        </thead>
        <tbody>
          {MEMBERS.map((member) => (
            <tr key={member.id}>
              <td>{member.name}</td>
              <td>
                <code>{member.email}</code>
              </td>
              <td>{member.tags}</td>
            </tr>
          ))}
        </tbody>
      </Table>

      <span className="bh-rule" aria-hidden="true" />
      <h2 className="bh-section-title">Markdown</h2>
      <p className="bh-muted">
        What the docs and any model-authored prose render through. The last line
        of the sample is raw HTML, and it must appear as text.
      </p>
      <Card>
        <Card.Body>
          <MarkdownBlock testId="sg-markdown">{MARKDOWN_SAMPLE}</MarkdownBlock>
        </Card.Body>
      </Card>

      <span className="bh-rule" aria-hidden="true" />
      <h2 className="bh-section-title">Forms</h2>
      <Row className="g-3">
        <Col md={6}>
          <Form.Group className="mb-2" controlId="sg-text">
            <Form.Label>Text</Form.Label>
            <Form.Control placeholder="Peach's Project" />
            <Form.Text>Help text sits under the control.</Form.Text>
          </Form.Group>
          <Form.Group className="mb-2" controlId="sg-invalid">
            <Form.Label>Invalid</Form.Label>
            <Form.Control isInvalid defaultValue="not-an-email" />
            <Form.Control.Feedback type="invalid">
              Enter a valid email address.
            </Form.Control.Feedback>
          </Form.Group>
          <Form.Group className="mb-2" controlId="sg-disabled">
            <Form.Label>Disabled</Form.Label>
            <Form.Control disabled defaultValue="read only" />
          </Form.Group>
        </Col>
        <Col md={6}>
          <Form.Group className="mb-2" controlId="sg-select">
            <Form.Label>Select</Form.Label>
            <Form.Select>
              <option>operators</option>
              <option>viewers</option>
            </Form.Select>
          </Form.Group>
          <Form.Group className="mb-2" controlId="sg-textarea">
            <Form.Label>Textarea</Form.Label>
            <Form.Control
              as="textarea"
              rows={3}
              defaultValue="A few lines of free text."
            />
          </Form.Group>
          <Form.Check
            type="checkbox"
            id="sg-check"
            label="Audit every write"
            defaultChecked
          />
          <Form.Check
            type="radio"
            id="sg-radio-a"
            name="sg-radio"
            label="Member"
          />
          <Form.Check
            type="radio"
            id="sg-radio-b"
            name="sg-radio"
            label="Admin"
            defaultChecked
          />
          <Form.Check type="switch" id="sg-switch" label="Enabled" />
        </Col>
      </Row>

      <span className="bh-rule" aria-hidden="true" />
      <h2 className="bh-section-title">Cards, badges, progress</h2>
      <Row className="g-3">
        <Col md={4}>
          <Card>
            <Card.Header>Plain card</Card.Header>
            <Card.Body>
              <Card.Title as="h3">Header and body</Card.Title>
              <Card.Text className="bh-muted">
                The default surface. Everything that groups content is one of
                these.
              </Card.Text>
            </Card.Body>
            <Card.Footer className="bh-muted">Footer</Card.Footer>
          </Card>
        </Col>
        <Col md={4}>
          <Card className="bh-feature-card">
            <Card.Body>
              <Card.Title as="h3">Feature card</Card.Title>
              <Card.Text>
                The magenta-ruled variant the landing page uses.
              </Card.Text>
            </Card.Body>
          </Card>
        </Col>
        <Col md={4}>
          {/* One active row with a `.bh-mono-label`, because the engine
              restates the inherit colour for a label on the accent fill, and
              a fixture that never paints that pair lets the rule drift. */}
          <ListGroup>
            <ListGroup.Item active>
              Peach&apos;s Project
              <div className="bh-mono-label">the selected project</div>
            </ListGroup.Item>
            <ListGroup.Item>Mario&apos;s Project</ListGroup.Item>
            <ListGroup.Item>Toad&apos;s Project</ListGroup.Item>
          </ListGroup>
        </Col>
      </Row>

      {/* The real settings proportions make an over-wide secondary menu
          visible here. The nav also carries all four item states: active,
          resting, dirty, and disabled. */}
      <Row className="g-3 bh-section-layout mt-1">
        <Col md={3} className="bh-section-nav-column">
          <Card data-testid="style-sidenav">
            <Card.Body className="p-2">
              <Nav className="flex-column bh-sidenav">
                <div className="bh-mono-label px-2 pb-1">Project</div>
                <Nav.Link href="#" className="active">
                  General
                </Nav.Link>
                <Nav.Link href="#">
                  Members
                  <span className="bh-nav-dirty" aria-hidden="true" />
                  <span className="visually-hidden"> unsaved changes</span>
                </Nav.Link>
                <Nav.Link href="#">
                  Tags
                  <span className="bh-nav-count bh-danger">2</span>
                </Nav.Link>
                <span className="nav-link disabled" aria-disabled="true">
                  Danger zone
                </span>
              </Nav>
            </Card.Body>
          </Card>
        </Col>
        <Col md={9} className="bh-section-content-column">
          <Card className="h-100">
            <Card.Header as="h3">General</Card.Header>
            <Card.Body>
              Secondary navigation stays compact while the section receives the
              remaining width.
            </Card.Body>
          </Card>
        </Col>
      </Row>
      <div className="d-flex flex-wrap gap-2 align-items-center mt-3">
        {VARIANTS.map((variant) => (
          <Badge key={variant} bg={variant}>
            {variant}
          </Badge>
        ))}
      </div>
      <div
        className="d-flex flex-wrap gap-2 align-items-center mt-3"
        data-testid="style-tag-pills"
      >
        <Badge pill bg="warning">
          admin
        </Badge>
        <Badge
          pill
          bg="secondary"
          className="d-inline-flex align-items-center gap-2"
          data-testid="style-tag-pill"
        >
          operators
          <Button
            size="sm"
            variant="link"
            className="p-0 lh-1"
            aria-label="Delete the operators tag"
          >
            ×
          </Button>
        </Badge>
      </div>
      <ProgressBar now={62} label="62%" className="mt-3" />
      <Pagination
        size="sm"
        className="mt-3 mb-0"
        data-testid="style-pagination"
      >
        <Pagination.Prev disabled />
        <Pagination.Item active>1</Pagination.Item>
        <Pagination.Item>2</Pagination.Item>
        <Pagination.Ellipsis />
        <Pagination.Item>8</Pagination.Item>
        <Pagination.Next />
      </Pagination>

      <span className="bh-rule" aria-hidden="true" />
      <h2 className="bh-section-title">Loading</h2>
      <p className="bh-muted">
        Skeletons for tables and lists, a caret label for everything else. The
        skeleton fill is drawn from CSS <code>content</code> and never moves —
        the only thing that blinks on a loading page is the one caret.
      </p>
      <Row className="g-3">
        <Col md={6}>
          {/* `.bh-loading` is `inline-flex`, so two of them need a column
              wrapper to stack rather than sit side by side. */}
          <div className="d-flex flex-column align-items-start">
            <LoadingLabel testId="sg-loading" />
            <LoadingLabel label="Checking" testId="sg-loading-checking" />
          </div>
          <Card className="mt-2">
            <Card.Body className="p-0">
              <LoadingLabel block testId="sg-loading-block" />
            </Card.Body>
          </Card>
        </Col>
        <Col md={6}>
          <SkeletonBlocks
            count={2}
            testId="sg-skeleton-blocks"
            label="Loading projects"
          />
        </Col>
      </Row>
      {/* A real table, because what a reviewer has to catch by eye is that a
          ghost row inherits the same `.table` borders and cell padding as the
          sample table four sections up — which no computed-style assertion
          states well. */}
      <Table hover size="sm" className="mt-3" data-testid="sg-skeleton-table">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Email</th>
            <th scope="col">Tags</th>
          </tr>
        </thead>
        <tbody>
          <SkeletonRows
            columns={3}
            rows={3}
            testId="sg-skeleton-rows"
            label="Loading members"
          />
        </tbody>
      </Table>

      <span className="bh-rule" aria-hidden="true" />
      <h2 className="bh-section-title">Type and chrome</h2>
      <h1>Heading 1</h1>
      <h2>Heading 2</h2>
      <h3>Heading 3</h3>
      <h4>Heading 4</h4>
      <h5>Heading 5</h5>
      <h6>Heading 6</h6>
      <p>
        Body copy, with an <a href="/style-guide">inline link</a>, some{" "}
        <code>inline_code()</code>, and <strong>bold emphasis</strong>.
      </p>
      <p className="bh-mono-label">A mono label</p>
      <p className="bh-cursor">A line ending in the caret&nbsp;</p>
      <div className="terminal-block">
        <div className="terminal-block-bar">cli · botholomew</div>
        <pre className="terminal-block-body">
          <div className="bh-in">botholomew tag create --name operators</div>
          <div className="bh-out">created tag 2</div>
          <div className="bh-out bh-out-ok">done</div>
        </pre>
      </div>

      <Modal show={showModal} onHide={() => setShowModal(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title as="h2">Delete the operators tag?</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          Deleting a tag revokes it from everyone who holds it. The audit row
          survives.
        </Modal.Body>
        <Modal.Footer>
          <Button
            variant="outline-secondary"
            onClick={() => setShowModal(false)}
          >
            Cancel
          </Button>
          <Button variant="danger" onClick={() => setShowModal(false)}>
            Delete
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
}
