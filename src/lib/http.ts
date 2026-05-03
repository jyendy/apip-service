import type { APIGatewayProxyResultV2 } from 'aws-lambda'

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Tenant-Id',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
}

export function json(
  statusCode: number,
  body: unknown,
  extraHeaders?: Record<string, string>,
): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS, ...extraHeaders },
    body: JSON.stringify(body),
  }
}

export function jsonError(
  statusCode: number,
  code: string,
  message: string,
  details?: unknown,
): APIGatewayProxyResultV2 {
  return json(statusCode, { error: { code, message, details } })
}

export function noContent(): APIGatewayProxyResultV2 {
  return { statusCode: 204, headers: CORS_HEADERS, body: '' }
}
