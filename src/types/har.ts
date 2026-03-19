/**
 *
 */
export interface HarLog {
  log: {
    version: string;
    creator: { name: string; version: string };
    entries: HarEntry[];
  };
}

/**
 *
 */
export interface HarEntry {
  startedDateTime: string;
  time: number;
  request: HarRequest;
  response: HarResponse;
  serverIPAddress?: string;
  _resourceType?: string;
}

/**
 *
 */
export interface HarRequest {
  method: string;
  url: string;
  httpVersion: string;
  headers: HarHeader[];
  queryString: HarQueryParam[];
  postData?: HarPostData;
  headersSize: number;
  bodySize: number;
  cookies: HarCookie[];
}

/**
 *
 */
export interface HarResponse {
  status: number;
  statusText: string;
  httpVersion: string;
  headers: HarHeader[];
  content: HarContent;
  redirectURL: string;
  headersSize: number;
  bodySize: number;
  cookies: HarCookie[];
}

/**
 *
 */
export interface HarHeader {
  name: string;
  value: string;
}

/**
 *
 */
export interface HarQueryParam {
  name: string;
  value: string;
}

/**
 *
 */
export interface HarPostData {
  mimeType: string;
  text?: string;
  params?: HarParam[];
}

/**
 *
 */
export interface HarParam {
  name: string;
  value?: string;
  fileName?: string;
  contentType?: string;
}

/**
 *
 */
export interface HarContent {
  size: number;
  compression?: number;
  mimeType: string;
  text?: string;
  encoding?: string;
}

/**
 *
 */
export interface HarCookie {
  name: string;
  value: string;
  path?: string;
  domain?: string;
  expires?: string;
  httpOnly?: boolean;
  secure?: boolean;
}
