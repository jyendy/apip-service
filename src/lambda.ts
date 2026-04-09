import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2, Handler } from 'aws-lambda'
import { route } from './http/router'

export const handler: Handler<APIGatewayProxyEventV2, APIGatewayProxyResultV2> = async event => {
  return route(event)
}
