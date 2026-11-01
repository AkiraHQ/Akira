import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import {
  initializeServer,
  getApplicationReadiness,
  ensureServerStarted,
  isMissionAdmissionReady,
  isServerShuttingDown,
  registerServerSignalHandlers,
} from "./server-lifecycle";

// Register process signal handlers for graceful teardown in Node environment
if (typeof process !== "undefined" && typeof process.on === "function") {
  registerServerSignalHandlers(process);
}

// Initiate server startup on entry; ensures ordered startup (SQLite -> GENESIS -> Capabilities -> Observability -> VAJRA)
void initializeServer().catch((error) => {
  console.error("Critical: Server startup failed:", error);
});

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!body.includes('"unhandled":true') || !body.includes('"message":"HTTPError"')) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const url = new URL(request.url);

      // Process liveness probe: responds 200 while Node process is alive and responsive
      if (url.pathname === "/health" || url.pathname === "/api/health") {
        return new Response(
          JSON.stringify({
            status: "live",
            processLive: true,
            timestamp: new Date().toISOString(),
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      // Cognitive readiness probe: reflects whether VAJRA can safely admit new operational missions
      if (url.pathname === "/ready/vajra" || url.pathname === "/api/ready/vajra") {
        if (isServerShuttingDown()) {
          return new Response(
            JSON.stringify({ error: "Server is shutting down", code: "SERVER_SHUTTING_DOWN" }),
            {
              status: 503,
              headers: {
                "content-type": "application/json",
                "X-Akira-Cognitive-Status": "STOPPED",
                "X-Akira-Cognitive-Ready": "false",
              },
            },
          );
        }

        await ensureServerStarted();
        const readiness = getApplicationReadiness();
        const missionReady = isMissionAdmissionReady();
        const statusCode = missionReady ? 200 : 503;

        const bodyData = readiness.vajraReadiness ?? {
          status: readiness.vajraStatus,
          isOperational: readiness.vajraReady,
          hasUnresolvedRecovery: readiness.hasUnresolvedRecovery ?? false,
          error: readiness.error,
        };

        return new Response(JSON.stringify(bodyData), {
          status: statusCode,
          headers: {
            "content-type": "application/json",
            "X-Akira-Cognitive-Status": readiness.vajraStatus,
            "X-Akira-Cognitive-Ready": String(readiness.vajraReady),
          },
        });
      }

      // Application readiness probe: reflects whether host application is ready to serve
      if (url.pathname === "/ready" || url.pathname === "/api/ready") {
        if (isServerShuttingDown()) {
          return new Response(
            JSON.stringify({ error: "Server is shutting down", code: "SERVER_SHUTTING_DOWN" }),
            {
              status: 503,
              headers: {
                "content-type": "application/json",
                "X-Akira-Cognitive-Status": "STOPPED",
                "X-Akira-Cognitive-Ready": "false",
              },
            },
          );
        }

        await ensureServerStarted();
        const readiness = getApplicationReadiness();
        const statusCode = readiness.applicationReady ? 200 : 503;
        return new Response(JSON.stringify(readiness), {
          status: statusCode,
          headers: {
            "content-type": "application/json",
            "X-Akira-Cognitive-Status": readiness.vajraStatus,
            "X-Akira-Cognitive-Ready": String(readiness.vajraReady),
          },
        });
      }

      if (isServerShuttingDown()) {
        return new Response(
          JSON.stringify({ error: "Server is shutting down", code: "SERVER_SHUTTING_DOWN" }),
          {
            status: 503,
            headers: { "content-type": "application/json" },
          },
        );
      }

      // Ensure initialization has finished before routing operational requests
      const startResult = await ensureServerStarted();
      if (!startResult.applicationReady) {
        return new Response(renderErrorPage(), {
          status: 503,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }

      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
