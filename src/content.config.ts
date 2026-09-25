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

const collection = (name: string) =>
  defineCollection({
    loader: file(`src/content/data/${name}.toml`, {
      parser: (text) =>
        ((parse(text).item ?? []) as Record<string, unknown>[]).map((it, i) => ({ id: String(i), ...it })),
    }),
    schema: item,
  });

export const collections = {
  posts,
  notes,
  books: collection('books'),
  bookmarks: collection('bookmarks'),
  experience: collection('experience'),
  projects: collection('projects'),
  education: collection('education'),
};
