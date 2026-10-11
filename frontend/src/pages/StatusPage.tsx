import type { Status } from "@backend/actions/status";
import type { ActionResponse } from "keryx";
import { useEffect, useState } from "react";
import Alert from "#ui/Alert";
import Badge from "#ui/Badge";
import Table from "#ui/Table";
import LoadingLabel from "../components/LoadingLabel";
import { apiFetch } from "../utils/client";

/** The backend `status` action's response, derived from the action itself — no codegen. */
type StatusResponse = ActionResponse<Status>;

/**
 * Render a boolean dependency check as a badge, so "up" and "down" are not
 * distinguishable by color alone.
 * @param props.ok - Whether the dependency answered.
 * @returns The rendered badge.
 */
function Health({ ok }: { ok: boolean }) {
  return <Badge bg={ok ? "success" : "danger"}>{ok ? "up" : "down"}</Badge>;
}

/**
 * The backend health readout. The oldest page in the app, and still
 * the one that proves `apiFetch` reaches a real backend across origins, which
 * is what the e2e smoke spec asserts.
 * @returns The rendered status page.
 */
export default function StatusPage() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<StatusResponse>("/status")
      .then(setStatus)
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <>
      <h1 className="mt-3">Status</h1>
      <span className="bh-rule" aria-hidden="true" />

      {error && (
        <Alert variant="danger" data-testid="status-error">
          Cannot reach the backend: {error}
        </Alert>
      )}

      {!error && !status && (
        <LoadingLabel label="Checking" testId="status-loading" />
      )}

      {status && (
        <Table striped hover size="sm" data-testid="status-table">
          <tbody>
            <tr>
              <th scope="row">Process</th>
              <td>{status.name}</td>
            </tr>
            <tr>
              <th scope="row">Version</th>
              <td>{status.version}</td>
            </tr>
            <tr>
              <th scope="row">PID</th>
              <td>{status.pid}</td>
            </tr>
            <tr>
              <th scope="row">Uptime</th>
              <td>{Math.round(status.uptime / 1000)}s</td>
            </tr>
            <tr>
              <th scope="row">Heap</th>
              <td>{status.consumedMemoryMB} MB</td>
            </tr>
            <tr>
              <th scope="row">Healthy</th>
              <td>
                <Health ok={status.healthy} />
              </td>
            </tr>
            <tr>
              <th scope="row">Database</th>
              <td>
                <Health ok={status.checks.database} />
              </td>
            </tr>
            <tr>
              <th scope="row">Redis</th>
              <td>
                <Health ok={status.checks.redis} />
              </td>
            </tr>
          </tbody>
        </Table>
      )}
    </>
  );
}
