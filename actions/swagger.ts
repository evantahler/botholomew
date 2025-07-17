import { Action, config, api } from "../api";
import packageJSON from "../package.json";
import { HTTP_METHOD } from "../classes/Action";
import { zodToJsonSchema } from "zod-to-json-schema";

const SWAGGER_VERSION = "3.0.0";

const errorResponseSchema = {
  type: "object",
  properties: {
    error: { type: "string" },
  },
};

const swaggerResponses = {
  "200": {
    description: "successful operation",
    content: {
      "application/json": {
        schema: {},
      },
    },
  },
  "400": {
    description: "Invalid input",
    content: {
      "application/json": {
        schema: errorResponseSchema,
      },
    },
  },
  "404": {
    description: "Not Found",
    content: {
      "application/json": {
        schema: errorResponseSchema,
      },
    },
  },
  "422": {
    description: "Missing or invalid params",
    content: {
      "application/json": {
        schema: errorResponseSchema,
      },
    },
  },
  "500": {
    description: "Server error",
    content: {
      "application/json": {
        schema: errorResponseSchema,
      },
    },
  },
};

export class Swagger implements Action {
  name = "swagger";
  description = "Return API documentation in the OpenAPI specification";
  web = { route: "/swagger", method: HTTP_METHOD.GET };

  async run() {
    const paths: Record<string, any> = {};
    const components: { schemas: Record<string, any> } = { schemas: {} };

    for (const action of api.actions.actions) {
      if (!action.web?.route || !action.web?.method) continue;
      const path = action.web.route;
      const method = action.web.method.toLowerCase();
      const tag = action.name.split(":")[0];
      const summary = action.description || action.name;

      // Build requestBody if Zod inputs exist
      let requestBody: any = undefined;
      if (action.inputs && typeof action.inputs.parse === "function") {
        const zodSchema = action.inputs;
        const schemaName = `${action.name.replace(/:/g, "_")}_Request`;
        const jsonSchema = zodToJsonSchema(zodSchema, schemaName);
        components.schemas[schemaName] =
          jsonSchema.definitions?.[schemaName] || jsonSchema;
        requestBody = {
          required: method !== "get",
          content: {
            "application/json": {
              schema: { $ref: `#/components/schemas/${schemaName}` },
            },
          },
        };
      }

      // Build responses (200 will be generic unless action has a known output schema)
      const responses = { ...swaggerResponses };

      // Add path/method
      if (!paths[path]) paths[path] = {};
      paths[path][method] = {
        summary,
        ...(requestBody ? { requestBody } : {}),
        responses,
        tags: [tag],
      };
    }

    const document = {
      openapi: SWAGGER_VERSION,
      info: {
        version: packageJSON.version,
        title: packageJSON.name,
        license: { name: packageJSON.license },
        description: packageJSON.description,
      },
      servers: [
        {
          url: config.server.web.applicationUrl + config.server.web.apiRoute,
          description: packageJSON.description,
        },
      ],
      paths,
      components,
    };
    return document;
  }
}
