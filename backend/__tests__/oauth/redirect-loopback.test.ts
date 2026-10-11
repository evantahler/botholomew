import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { api } from "keryx";
import {
  buildTestUniverse,
  computeS256Challenge,
  HOOK_TIMEOUT,
  randomString,
  TEST_PASSWORD,
  type TestUniverse,
} from "../setup";

// A CLI MCP client — Claude Code, Codex — takes an ephemeral loopback port from
// the OS when it starts its callback listener, so it cannot register that port
// ahead of time. It declares `http://localhost/callback` and then authorizes on
// whatever port it ended up binding, which RFC 8252 §7.3 requires an
// authorization server to allow. Keryx compared redirect URIs byte-exactly, so
// every such client got "Invalid redirect URI" on the authorize page and no
// external client could connect to a project's MCP URL at all
// (actionhero/keryx#533, fixed in keryx@0.42.4).
//
// This suite exists because our own `getMcpAccessToken` cannot catch that: it
// sends one identical redirect-URI string through register, authorize, and
// token, so the flow it drives passes whether or not the port is compared. The
// divergence between the registered and the requested URI is the whole point
// here, which is why both are named at the top of each test rather than hidden
// behind a helper argument.
//
// It is a backend suite rather than a Keryx concern we defer to upstream
// because this is the front door: `/oauth/authorize` is how a person's Claude
// Code reaches their project, and a dependency bump that silently regressed it
// would be found by a user, not by CI.

/** What a native client can commit to before it knows its port. */
const REGISTERED_URI = "http://localhost/callback";

/** What it actually asks for once the OS has handed it one. */
const REQUESTED_URI = "http://localhost:3118/callback";

describe("OAuth loopback redirect URIs (RFC 8252 §7.3)", () => {
  let universe: TestUniverse;

  beforeAll(async () => {
    universe = await buildTestUniverse();
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await api.stop();
  }, HOOK_TIMEOUT);

  /**
   * Register a client holding a single redirect URI.
   * @param redirectUri - The URI to register, verbatim.
   * @returns The issued `client_id`.
   */
  async function registerClient(redirectUri: string): Promise<string> {
    const res = await fetch(`${universe.url}/oauth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        redirect_uris: [redirectUri],
        client_name: "Loopback Test Client",
        application_type: "native",
      }),
    });
    expect(res.status).toBe(201);
    const { client_id: clientId } = (await res.json()) as { client_id: string };
    return clientId;
  }

  /**
   * Post the authorize form as an existing user, without following the redirect.
   * @param clientId - The registered client.
   * @param redirectUri - The `redirect_uri` to request.
   * @param codeChallenge - The PKCE S256 challenge.
   * @returns The raw response, so a caller can assert on a 302 or on the
   *   re-rendered error page.
   */
  async function authorize(
    clientId: string,
    redirectUri: string,
    codeChallenge: string,
  ): Promise<Response> {
    return fetch(`${universe.url}/oauth/authorize`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        mode: "login",
        email: universe.peach.email,
        password: TEST_PASSWORD,
        client_id: clientId,
        redirect_uri: redirectUri,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        response_type: "code",
        state: "loopback",
      }).toString(),
      redirect: "manual",
    });
  }

  test("a portless registration authorizes on an ephemeral port, and the code exchanges", async () => {
    const clientId = await registerClient(REGISTERED_URI);
    const codeVerifier = randomString(43);
    const codeChallenge = await computeS256Challenge(codeVerifier);

    const authRes = await authorize(clientId, REQUESTED_URI, codeChallenge);
    expect(authRes.status).toBe(302);

    const location = authRes.headers.get("location");
    expect(location).toBeTruthy();
    const redirect = new URL(location as string);

    // The bounce goes to the URI the client asked for, port included — not to
    // the portless one it registered. A client listening on 3118 is the only
    // thing that can receive this, so sending it anywhere else would be a
    // redirect nobody is holding the other end of.
    expect(redirect.origin).toBe("http://localhost:3118");
    expect(redirect.pathname).toBe("/callback");
    expect(redirect.searchParams.get("state")).toBe("loopback");

    const code = redirect.searchParams.get("code");
    expect(code).toBeTruthy();

    // The token endpoint compares against the URI stored on the *code*, which is
    // the literal one the authorize request carried. That comparison stays exact
    // and is a separate check from the one above; a fix that relaxed only the
    // authorize side would strand the client here holding an unusable code.
    const tokenRes = await fetch(`${universe.url}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: code as string,
        code_verifier: codeVerifier,
        client_id: clientId,
        redirect_uri: REQUESTED_URI,
      }).toString(),
    });
    expect(tokenRes.status).toBe(200);
    const { access_token: accessToken } = (await tokenRes.json()) as {
      access_token?: string;
    };
    expect(accessToken).toBeTruthy();
  });

  test("the carve-out is the port only — a different loopback host is still refused", async () => {
    const clientId = await registerClient(REGISTERED_URI);
    const codeChallenge = await computeS256Challenge(randomString(43));

    // RFC 8252 §8.3 treats `localhost` and `127.0.0.1` as distinct
    // registrations. Matching them against each other would widen the carve-out
    // past what the RFC asks for, and it is the direction a well-meaning
    // "loopback is loopback" simplification would drift in.
    const res = await authorize(
      clientId,
      "http://127.0.0.1:3118/callback",
      codeChallenge,
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Invalid redirect URI");
  });

  test("the carve-out is the port only — a different path is still refused", async () => {
    const clientId = await registerClient(REGISTERED_URI);
    const codeChallenge = await computeS256Challenge(randomString(43));

    // Everything but the port stays byte-exact. If it did not, a registration
    // for `/callback` would accept a redirect to any path on the same loopback
    // origin, which is the open-redirect shape `gateway:oauth-return` is
    // separately careful about.
    const res = await authorize(
      clientId,
      "http://localhost:3118/stolen",
      codeChallenge,
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Invalid redirect URI");
  });

  test("a non-loopback host gets no port flexibility", async () => {
    const clientId = await registerClient("https://example.com/callback");
    const codeChallenge = await computeS256Challenge(randomString(43));

    // Port flexibility is a concession to native apps binding loopback
    // listeners. A remote web callback knows its own port, so relaxing this
    // would let a registration for `example.com` be redirected to a service on
    // another port of the same host.
    const res = await authorize(
      clientId,
      "https://example.com:8443/callback",
      codeChallenge,
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Invalid redirect URI");
  });
});
