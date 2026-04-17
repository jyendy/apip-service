declare module 'jexl' {
  interface JexlStatic {
    eval(expression: string, context?: Record<string, unknown>): Promise<unknown>
    evalSync(expression: string, context?: Record<string, unknown>): unknown
  }
  const jexl: JexlStatic
  export default jexl
}
