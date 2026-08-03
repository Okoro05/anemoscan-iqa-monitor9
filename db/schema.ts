import {
  doublePrecision,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'

export const captures = pgTable('captures', {
  id: serial('id').primaryKey(),
  blobKey: text('blob_key').notNull(),
  name: text('name'),
  status: text('status').notNull(),
  cameraLabel: text('camera_label').notNull(),
  threshold: doublePrecision('threshold').notNull(),
  brightness: doublePrecision('brightness').notNull(),
  sharpness: doublePrecision('sharpness').notNull(),
  contrast: doublePrecision('contrast').notNull(),
  overall: doublePrecision('overall').notNull(),
  imageBytes: integer('image_bytes').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})
