export type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: JsonValue }
  | JsonValue[];

export type JsonSchema = Record<string, unknown>;

export interface PathParameter {
  name: string;
  sourceRef?: string;
}

export interface HerokuOperation {
  operationId: string;
  method: string;
  pathTemplate: string;
  rawHref: string;
  rel?: string;
  title?: string;
  description?: string;
  definitionName: string;
  requestSchema?: JsonSchema;
  targetSchemaRef?: string;
  pathParams: PathParameter[];
  requiredParams: string[];
  isMutating: boolean;
  searchText: string;
}

export interface SearchResultItem {
  operation_id: string;
  method: string;
  path: string;
  summary: string;
  required_params: string[];
  is_mutating: boolean;
  score: number;
}

export interface SearchResponse {
  results: SearchResultItem[];
}

export interface ExecuteRequest {
  operation_id: string;
  path_params?: Record<string, string>;
  query_params?: Record<string, string | number | boolean>;
  body?: unknown;
  dry_run?: boolean;
  confirm_write_token?: string;
}

export interface ExecuteResponse {
  request: {
    method: string;
    url: string;
    operation_id: string;
  };
  status: number;
  headers: Record<string, string>;
  body: unknown;
  request_id?: string;
  warnings?: string[];
}

export interface OAuthTokenRecord {
  accessToken: string;
  tokenType: string;
  refreshToken?: string;
  scope: string[];
  expiresAt?: string;
  obtainedAt: string;
}

export interface AuthStatusResponse {
  authenticated: boolean;
  scopes: string[];
  expires_at?: string;
}

export interface NormalizedCatalog {
  operations: HerokuOperation[];
  rootSchema: JsonSchema;
}
