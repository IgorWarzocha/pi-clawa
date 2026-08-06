import assert from 'node:assert/strict'
import test from 'node:test'
import { formatClawaDeliveryReceipt, registerClawasTools } from './tool-surface.js'

test('message_clawa advertises its route and returns only a named receipt', () => {
  const previousRole = process.env['PI_CLAWAS_ROLE']
  delete process.env['PI_CLAWAS_ROLE']
  const tools: Array<{ name: string; promptSnippet?: string }> = []
  try {
    registerClawasTools(
      {
        registerTool: (tool: { name: string; promptSnippet?: string }) => tools.push(tool),
      } as never,
      {} as never,
    )

    assert.equal(tools.length, 1)
    assert.equal(tools[0]?.name, 'message_clawa')
    assert.equal(tools[0]?.promptSnippet, 'Send a private note to another Clawa')
    assert.equal(formatClawaDeliveryReceipt('Techie'), 'Delivered private note to Techie.')
  } finally {
    if (previousRole === undefined) delete process.env['PI_CLAWAS_ROLE']
    else process.env['PI_CLAWAS_ROLE'] = previousRole
  }
})
