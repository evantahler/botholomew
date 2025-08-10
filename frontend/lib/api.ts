import { getApiUrl } from "./config";
import type { Action, ActionResponse } from "../../backend/api";

// HTTP methods enum
export enum HTTP_METHOD {
  "GET" = "GET",
  "POST" = "POST",
  "PUT" = "PUT",
  "DELETE" = "DELETE",
  "PATCH" = "PATCH",
  "OPTIONS" = "OPTIONS",
}

// Generic API wrapper that accepts response type directly
export class APIWrapper {
  /**
   * Make a generic API request
   * @param url - The API endpoint URL
   * @param method - The HTTP method to use
   * @param params - Parameters to send with the request
   * @param options - Additional fetch options
   */
  static async request<T extends Action>(
    url: string,
    method: HTTP_METHOD,
    params?: Record<string, any>,
    options: RequestInit = {}
  ): Promise<ActionResponse<T>> {
    // Replace route parameters with actual values
    let finalUrl = url;
    if (params) {
      // Handle route parameters (e.g., /agent/:id)
      finalUrl = url.replace(/:(\w+)/g, (match, paramName) => {
        if (params[paramName] !== undefined) {
          const value = params[paramName];
          delete params[paramName]; // Remove from params to avoid sending in body
          return String(value);
        }
        throw new Error(`Missing required route parameter: ${paramName}`);
      });
    }

    const fetchOptions: RequestInit = {
      method,
      credentials: "include",
      ...options,
    };

    // Add query parameters for GET requests
    if (
      method === HTTP_METHOD.GET &&
      params &&
      Object.keys(params).length > 0
    ) {
      const queryParams = new URLSearchParams();
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          queryParams.append(key, String(value));
        }
      });
      finalUrl += `?${queryParams.toString()}`;
    }

    // Add body for non-GET requests
    if (
      method !== HTTP_METHOD.GET &&
      params &&
      Object.keys(params).length > 0
    ) {
      fetchOptions.headers = {
        "Content-Type": "application/json",
        ...fetchOptions.headers,
      };
      fetchOptions.body = JSON.stringify(params);
    }

    const response = await fetch(getApiUrl(finalUrl), fetchOptions);

    if (!response.ok) {
      const errorRsp = await response.json().catch(() => ({}));
      throw new Error(
        errorRsp?.error
          ? `${errorRsp.error.type}: ${errorRsp.error.message}`
          : `Failed to execute ${method} ${url} [${response.status}]: ${response.statusText}`
      );
    }

    return (await response.json()) as ActionResponse<T>;
  }

  /**
   * GET request
   */
  static async get<T extends Action>(
    url: string,
    params?: Record<string, any>,
    limit?: number,
    offset?: number
  ) {
    const queryParams = { ...params };

    if (limit !== undefined) {
      queryParams.limit = limit;
    }

    if (offset !== undefined) {
      queryParams.offset = offset;
    }

    return this.request<T>(url, HTTP_METHOD.GET, queryParams);
  }

  /**
   * POST request
   */
  static async post<T extends Action>(
    url: string,
    params?: Record<string, any>
  ) {
    return this.request<T>(url, HTTP_METHOD.POST, params);
  }

  /**
   * PUT request
   */
  static async put<T extends Action>(
    url: string,
    params?: Record<string, any>
  ) {
    return this.request<T>(url, HTTP_METHOD.PUT, params);
  }

  /**
   * DELETE request
   */
  static async delete<T extends Action>(
    url: string,
    params?: Record<string, any>
  ) {
    return this.request<T>(url, HTTP_METHOD.DELETE, params);
  }
}
