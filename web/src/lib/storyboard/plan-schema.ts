import { z } from 'zod';

const VoiceEnum = z.enum(['native', 'dub', 'none']);
const ModeEnum = z.enum(['frame', 'direct']);
const AnchorKindEnum = z.enum(['character', 'scene', 'style']);

export const PartialDeskRowSchema = z.object({
  desc: z.string().optional(),
  line: z.string().optional(),
  dur: z.number().positive().max(60).optional(),
  size: z.string().optional(),
  roles: z.array(z.string()).optional(),
  voice: VoiceEnum.optional(),
  mode: ModeEnum.optional(),
  cont: z.boolean().optional(),
});

export const ChangeSchema = z.discriminatedUnion('kind', [
  z.object({
    id: z.string().min(1),
    kind: z.literal('row.add'),
    at: z.number().int().min(0).optional(),
    row: PartialDeskRowSchema,
  }),
  z.object({
    id: z.string().min(1),
    kind: z.literal('row.update'),
    rowId: z.string().min(1),
    patch: PartialDeskRowSchema,
  }),
  z.object({
    id: z.string().min(1),
    kind: z.literal('row.remove'),
    rowId: z.string().min(1),
  }),
  z.object({
    id: z.string().min(1),
    kind: z.literal('row.move'),
    rowId: z.string().min(1),
    to: z.number().int().min(0),
  }),
  z.object({
    id: z.string().min(1),
    kind: z.literal('anchor.add'),
    anchor: z.object({
      kind: AnchorKindEnum,
      name: z.string().min(1),
      text: z.string(),
    }),
  }),
  z.object({
    id: z.string().min(1),
    kind: z.literal('row.roles'),
    rowId: z.string().min(1),
    anchorNames: z.array(z.string().min(1)),
  }),
]);

export const PlanSchema = z.object({
  summary: z.string().min(1),
  changes: z.array(ChangeSchema),
  suggestRun: z
    .object({
      rowIds: z.array(z.string()),
      kind: z.enum(['image', 'video']),
    })
    .optional(),
});

export type Change = z.infer<typeof ChangeSchema>;
export type Plan = z.infer<typeof PlanSchema>;

export const PLAN_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'changes'],
  properties: {
    summary: { type: 'string' },
    changes: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'kind'],
        properties: {
          id: { type: 'string' },
          kind: {
            type: 'string',
            enum: [
              'row.add',
              'row.update',
              'row.remove',
              'row.move',
              'anchor.add',
              'row.roles',
            ],
          },
          at: { type: 'integer', minimum: 0 },
          rowId: { type: 'string' },
          to: { type: 'integer', minimum: 0 },
          row: { type: 'object' },
          patch: { type: 'object' },
          anchor: {
            type: 'object',
            required: ['kind', 'name', 'text'],
            properties: {
              kind: { type: 'string', enum: ['character', 'scene', 'style'] },
              name: { type: 'string' },
              text: { type: 'string' },
            },
          },
          anchorNames: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    suggestRun: {
      type: 'object',
      required: ['rowIds', 'kind'],
      properties: {
        rowIds: { type: 'array', items: { type: 'string' } },
        kind: { type: 'string', enum: ['image', 'video'] },
      },
    },
  },
} as const;
