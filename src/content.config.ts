import { defineCollection } from 'astro:content';
import { glob, file } from 'astro/loaders';
import { z } from 'astro/zod';
import { parse } from 'smol-toml';

const posts = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/posts' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.coerce.date(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
});

const notes = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/notes' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.coerce.date(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
});

// Data files are `[[item]]` TOML arrays. Item order in the file is the display order.
const item = z.object({
  title: z.string(),
  subtitle: z.string().optional(),
  content: z.string().optional(),
  image: z.string().optional(),
  link: z.string().optional(),
  badge: z.string().optional(),
  tags: z.array(z.string()).default([]),
  featured: z.boolean().default(false),
});

const toml = (name: string) =>
  file(`src/content/data/${name}.toml`, {
    parser: (text) =>
      ((parse(text).item ?? []) as Record<string, unknown>[]).map((it, i) => ({ id: String(i), ...it })),
  });

const collection = (name: string) => defineCollection({ loader: toml(name), schema: item });

// one row per country, newest trip first; `country` must be a name the map knows (src/lib/atlas.ts)
const travel = defineCollection({
  loader: toml('travel'),
  schema: z.object({
    country: z.string(),
    year: z.union([z.number(), z.string()]).optional(),
    places: z.string().optional(),
  }),
});

export const collections = {
  posts,
  notes,
  books: collection('books'),
  bookmarks: collection('bookmarks'),
  experience: collection('experience'),
  projects: collection('projects'),
  education: collection('education'),
  travel,
};
