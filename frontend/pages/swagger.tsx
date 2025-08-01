import { useEffect, useState } from "react";
import { getApiUrl } from "../lib/config";

// Type definitions for Swagger UI
interface SwaggerUIBundle {
  (config: {
    spec: unknown;
    dom_id: string;
    deepLinking: boolean;
    presets: unknown[];
    plugins: unknown[];
    layout: string;
    tryItOutEnabled: boolean;
  }): void;
  presets: {
    apis: unknown;
  };
  plugins: {
    DownloadUrl: unknown;
  };
}

interface SwaggerUIStandalonePreset {
  (): unknown;
}

declare global {
  interface Window {
    SwaggerUIBundle?: SwaggerUIBundle;
    SwaggerUIStandalonePreset?: SwaggerUIStandalonePreset;
  }
}

export default function SwaggerPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Load Swagger UI scripts and styles
    const loadSwaggerUI = () => {
      // Load CSS
      if (!document.querySelector('link[href*="swagger-ui.css"]')) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = "https://unpkg.com/swagger-ui-dist@5.9.0/swagger-ui.css";
        document.head.appendChild(link);
      }

      // Load scripts
      const loadScript = (src: string): Promise<void> => {
        return new Promise((resolve, reject) => {
          if (document.querySelector(`script[src="${src}"]`)) {
            resolve();
            return;
          }
          const script = document.createElement("script");
          script.src = src;
          script.onload = () => resolve();
          script.onerror = reject;
          document.head.appendChild(script);
        });
      };

      Promise.all([
        loadScript(
          "https://unpkg.com/swagger-ui-dist@5.9.0/swagger-ui-bundle.js"
        ),
        loadScript(
          "https://unpkg.com/swagger-ui-dist@5.9.0/swagger-ui-standalone-preset.js"
        ),
      ])
        .then(() => {
          document.title = "API Documentation - Botholomew";
          loadSwaggerDoc();
        })
        .catch(err => {
          setError("Failed to load Swagger UI: " + err.message);
          setIsLoading(false);
        });
    };

    loadSwaggerUI();
  }, []);

  const loadSwaggerDoc = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(getApiUrl("/api/swagger"));
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const swaggerDoc = await response.json();
      setIsLoading(false);

      // Load Swagger UI dynamically
      const SwaggerUIBundle = window.SwaggerUIBundle;
      const SwaggerUIStandalonePreset = window.SwaggerUIStandalonePreset;

      if (SwaggerUIBundle && SwaggerUIStandalonePreset) {
        SwaggerUIBundle({
          spec: swaggerDoc,
          dom_id: "#swagger-ui",
          deepLinking: true,
          presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
          plugins: [SwaggerUIBundle.plugins.DownloadUrl],
          layout: "StandaloneLayout",
          tryItOutEnabled: true,
        });
      }
    } catch (err) {
      setIsLoading(false);
      setError(
        err instanceof Error ? err.message : "Failed to load API documentation"
      );
    }
  };

  return (
    <>
      <div style={{ background: "#fafafa", minHeight: "100vh" }}>
        {isLoading && (
          <div
            className="loading"
            style={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              height: "100vh",
              fontSize: "18px",
              color: "#666",
            }}
          >
            Loading API documentation...
          </div>
        )}

        {error && (
          <div
            className="error"
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              alignItems: "center",
              height: "100vh",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: "18px", marginBottom: "10px" }}>
              Failed to load API documentation
            </div>
            <div
              style={{ fontSize: "14px", marginBottom: "20px", color: "#666" }}
            >
              {error}
            </div>
            <button
              onClick={loadSwaggerDoc}
              style={{
                padding: "10px 20px",
                background: "#1976d2",
                color: "white",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
                fontSize: "16px",
              }}
              onMouseOver={e => {
                e.currentTarget.style.background = "#1565c0";
              }}
              onMouseOut={e => {
                e.currentTarget.style.background = "#1976d2";
              }}
            >
              Retry
            </button>
          </div>
        )}

        <div id="swagger-ui"></div>
      </div>
    </>
  );
}
