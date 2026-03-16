export interface Endpoint {
  method: string;
  normalizedPath: string;
  originalUrls: string[];
  queryParams: QueryParamInfo[];
  requestBodies: unknown[];
  responseBodies: unknown[];
  responseStatuses: number[];
  headers: Record<string, string>;
}

export interface QueryParamInfo {
  name: string;
  observedValues: string[];
  required: boolean;
}

export interface EndpointGroup {
  baseUrl: string;
  endpoints: Endpoint[];
}
