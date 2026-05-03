import { describe, expect, it } from 'vitest'
import { parseCognitoGroupsClaim } from './context'

describe('parseCognitoGroupsClaim', () => {
  it('acepta formato Cognito estándar', () => {
    expect(parseCognitoGroupsClaim('apip-platform-admin, admin')).toEqual(['apip-platform-admin', 'admin'])
  })

  it('quita corchetes literales por segmento (claim mal mapeado)', () => {
    expect(parseCognitoGroupsClaim('[apip-platform-admin]')).toEqual(['apip-platform-admin'])
  })

  it('lista mixta con corchetes en un ítem', () => {
    expect(parseCognitoGroupsClaim('[apip-platform-admin], readers')).toEqual(['apip-platform-admin', 'readers'])
  })
})
