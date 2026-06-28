// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { AnalyticsService } from '../analyticsService'

describe('AnalyticsService', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('accepts the owner master password and verification code', async () => {
    const service = new AnalyticsService()
    await service.initialize()

    const step1 = await service.verifyStep1('kingkiller@1234')
    const step2 = await service.verifyStep2('21')

    expect(step1.success).toBe(true)
    expect(step2.success).toBe(true)
  })

  it('locks access after repeated failed attempts', async () => {
    const service = new AnalyticsService()
    await service.initialize()

    for (let index = 0; index < 5; index += 1) {
      await service.verifyStep1('wrong')
    }

    const result = await service.verifyStep1('kingkiller@1234')
    expect(result.success).toBe(false)
    expect(result.locked).toBe(true)
  })
})
