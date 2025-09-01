"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Button, Container, Nav, Navbar, NavDropdown } from "react-bootstrap";
import { useAuth } from "../lib/auth";
import Logo from "./Logo";

export default function Navigation() {
  const router = useRouter();
  const pathname = usePathname();
  const { user, signout } = useAuth();

  const isActive = (path: string) => {
    return pathname === path;
  };

  const handleSignout = async () => {
    await signout();
    router.push("/");
  };

  return (
    <Navbar
      key={pathname}
      bg="dark"
      variant="dark"
      expand="lg"
      fixed="top"
      className="shadow-sm"
    >
      <Container fluid>
        <Navbar.Brand
          as={Link}
          href="/"
          className="fw-bold d-flex align-items-center"
        >
          <Logo size={40} className="me-2" />
          Botholomew
        </Navbar.Brand>

        <Navbar.Toggle aria-controls="basic-navbar-nav" />
        <Navbar.Collapse id="basic-navbar-nav">
          <Nav className="me-auto">
            {!user && (
              <Nav.Link
                as={Link}
                href="/"
                className={isActive("/") ? "active" : ""}
              >
                Home
              </Nav.Link>
            )}
            {user && (
              <>
                <Nav.Link
                  as={Link}
                  href="/dashboard"
                  className={isActive("/dashboard") ? "active" : ""}
                >
                  Dashboard
                </Nav.Link>
                <Nav.Link
                  as={Link}
                  href="/agents"
                  className={
                    isActive("/agents") ||
                    isActive("/agents/create") ||
                    isActive("/agents/[id]")
                      ? "active"
                      : ""
                  }
                >
                  Agents
                </Nav.Link>
                <Nav.Link
                  as={Link}
                  href="/workflows"
                  className={
                    isActive("/workflows") ||
                    isActive("/workflows/create") ||
                    isActive("/workflows/[id]") ||
                    isActive("/workflows/edit/[id]")
                      ? "active"
                      : ""
                  }
                >
                  Workflows
                </Nav.Link>
              </>
            )}
          </Nav>
          <Nav>
            <NavDropdown
              title="System"
              id="system-dropdown"
              className={
                isActive("/status") || isActive("/swagger") ? "active" : ""
              }
            >
              <NavDropdown.Item
                as={Link}
                href="/status"
                className={`dropdown-item-custom ${
                  isActive("/status") ? "active" : ""
                }`}
              >
                Server Status
              </NavDropdown.Item>
              <NavDropdown.Item
                as={Link}
                href="/swagger"
                className={`dropdown-item-custom ${
                  isActive("/swagger") ? "active" : ""
                }`}
              >
                API Documentation
              </NavDropdown.Item>
            </NavDropdown>
            {user ? (
              <div className="d-flex align-items-center">
                <NavDropdown
                  title="Account"
                  id="user-dropdown"
                  className="me-3"
                >
                  <NavDropdown.Item
                    as={Link}
                    href="/account"
                    className="dropdown-item-custom"
                  >
                    Account Settings
                  </NavDropdown.Item>
                  <NavDropdown.Item
                    as={Link}
                    href="/toolkits"
                    className="dropdown-item-custom"
                  >
                    Toolkit Management
                  </NavDropdown.Item>
                  <NavDropdown.Divider />
                  <NavDropdown.Item
                    onClick={handleSignout}
                    className="dropdown-item-custom"
                  >
                    Sign Out
                  </NavDropdown.Item>
                </NavDropdown>
              </div>
            ) : (
              <div className="d-flex align-items-center">
                <Button
                  variant="outline-light"
                  className="text-light"
                  size="sm"
                  onClick={() => router.push("/signin")}
                >
                  Sign In
                </Button>
                &nbsp;&nbsp;
                <Button
                  variant="outline-light"
                  className="text-light"
                  size="sm"
                  onClick={() => router.push("/signup")}
                >
                  Sign Up
                </Button>
              </div>
            )}
          </Nav>
        </Navbar.Collapse>
      </Container>
    </Navbar>
  );
}
