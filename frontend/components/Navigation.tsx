"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { Navbar, Nav, Container } from "react-bootstrap";

export default function Navigation() {
  const router = useRouter();

  const isActive = (path: string) => {
    return router.pathname === path;
  };

  return (
    <Navbar
      bg="dark"
      variant="dark"
      expand="lg"
      fixed="top"
      className="shadow-sm"
    >
      <Container fluid>
        <Navbar.Brand as={Link} href="/" className="fw-bold">
          🤖 Botholomew
        </Navbar.Brand>

        <Navbar.Toggle aria-controls="basic-navbar-nav" />
        <Navbar.Collapse id="basic-navbar-nav">
          <Nav className="me-auto">
            <Nav.Link
              as={Link}
              href="/"
              className={isActive("/") ? "active" : ""}
            >
              Home
            </Nav.Link>
            <Nav.Link
              as={Link}
              href="/status"
              className={isActive("/status") ? "active" : ""}
            >
              Server Status
            </Nav.Link>
            <Nav.Link
              as={Link}
              href="/swagger"
              className={isActive("/swagger") ? "active" : ""}
            >
              API Documentation
            </Nav.Link>
          </Nav>
        </Navbar.Collapse>
      </Container>
    </Navbar>
  );
}
