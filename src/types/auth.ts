/**
 *
 */
export type AuthType =
  | "bearer"
  | "cookie"
  | "api-key"
  | "query-param"
  | "custom-header";

/**
 *
 */
export interface AuthInfo {
  type: AuthType;
  location: "header" | "cookie" | "query";
  key: string;
  value: string;
  confidence: number;
}
