import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

export const name = 'dsh-pangea-companion-report-policy'
export const inject = ['subagents', 'tools', 'systemPrompt']

const PANGEA_WORKSPACE_MARKER = join('.agents', 'pangea', 'dsh.md')
const REPORT_SECTION_ORDER = 117

export function isPangeaWorkspace(cwd) {
  if (typeof cwd !== 'string' || cwd.trim() === '') return false
  let current = resolve(cwd)
  while (true) {
    if (existsSync(join(current, PANGEA_WORKSPACE_MARKER))) return true
    const parent = dirname(current)
    if (parent === current) return false
    current = parent
  }
}

export function reportDeliveryForWorkspace(cwd) {
  return isPangeaWorkspace(cwd) ? 'quiet' : 'next-step'
}

function workspaceCwd(exec) {
  const cwd = exec?.agent?.session?.header?.cwd
  return typeof cwd === 'string' && cwd.trim() !== '' ? cwd : undefined
}

export function installReportTool(childCtx, ctx) {
  const disposeSection = childCtx.systemPrompt.section({
    name: 'tool:report',
    order: REPORT_SECTION_ORDER,
    text: 'Deliver your result with the report tool before you finish: call it once with a self-contained answer. The agent that started you shares your workspace but does not automatically receive your transcript, tool output, or reasoning, so a closing remark such as "done" leaves it nothing it can use. Report earlier as well whenever a partial finding changes what that agent should do next; reporting never ends your turn.',
  })
  const disposeTool = childCtx.tools.register({
    name: 'report',
    description: 'Report selected content to the agent that started you. Reporting does not end your turn or finish your work.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        output: {
          type: 'string',
          description: 'Actionable content for your parent; summarize conclusions and reference relevant shared paths.',
        },
      },
      required: ['output'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { messageId: { type: 'string' } },
        required: ['messageId'],
      },
      render: (_args, value) => [{
        type: 'text',
        text: `report accepted by the agent that started you as message ${value.messageId}`,
      }],
    },
    async execute(args, exec) {
      const delivery = reportDeliveryForWorkspace(workspaceCwd(exec))
      const messageId = await ctx.subagents.reportFrom(
        exec.agent,
        [{ type: 'text', text: args.output }],
        { delivery, signal: exec.signal },
      )
      return { messageId }
    },
  })

  return () => {
    disposeTool()
    disposeSection()
  }
}

export function apply(ctx) {
  ctx.subagents.registerContinuableSetup(childCtx => installReportTool(childCtx, ctx))
}
