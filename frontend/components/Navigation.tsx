"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { Navbar, Nav, Container, Button } from "react-bootstrap";
import { useAuth } from "../lib/auth";

export default function Navigation() {
  const router = useRouter();
  const { user, signout } = useAuth();

  const isActive = (path: string) => {
    return router.pathname === path;
  };

  const handleSignout = async () => {
    await signout();
    router.push("/");
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
            {user && (
              <Nav.Link
                as={Link}
                href="/dashboard"
                className={isActive("/dashboard") ? "active" : ""}
              >
                Dashboard
              </Nav.Link>
            )}
          </Nav>
          <Nav>
            {user ? (
              <div className="d-flex align-items-center">
                <span className="text-light me-3">Welcome, {user.name}</span>
                <Button
                  variant="outline-light"
                  size="sm"
                  onClick={handleSignout}
                >
                  Sign Out
                </Button>
              </div>
            ) : (
              <div className="d-flex gap-2">
                <Link href="/signin" className="btn btn-outline-light btn-sm">
                  Sign In
                </Link>
                <Link href="/signup" className="btn btn-light btn-sm">
                  Sign Up
                </Link>
              </div>
            )}
          </Nav>
        </Navbar.Collapse>
      </Container>
    </Navbar>
  );
}
