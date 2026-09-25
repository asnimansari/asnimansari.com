import { getPosts, getTags, isoDate } from '../lib/posts';
import { SITE } from '../consts';

export async function GET() {
  const [posts, tags] = await Promise.all([getPosts(), getTags()]);

  const urls: { path: string; lastmod?: string }[] = [
    { path: '/' },
    { path: '/posts/' },
    { path: '/books/' },
    { path: '/bookmarks/' },
    { path: '/resume/' },
    { path: '/tags/' },
    ...posts.map((p) => ({ path: `/posts/${p.id}/`, lastmod: isoDate(p.data.date) })),
    ...tags.map((t) => ({ path: `/tags/${t.slug}/` })),
  ];

  const body = urls
    .map((u) => `  <url>\n    <loc>${SITE.url}${u.path}</loc>${u.lastmod ? `\n    <lastmod>${u.lastmod}</lastmod>` : ''}\n  </url>`)
    .join('\n');

  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`,
    { headers: { 'Content-Type': 'application/xml; charset=utf-8' } },
  );
}
