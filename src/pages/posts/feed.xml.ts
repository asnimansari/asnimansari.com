import type { APIContext } from 'astro';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { render } from 'astro:content';
import { getPosts } from '../../lib/posts';
import { BLOG, SITE } from '../../consts';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const stamp = (d: Date) => `${d.toISOString().slice(0, 10)}T00:00:00+00:00`;

export async function GET(_context: APIContext) {
  const posts = await getPosts();
  const container = await AstroContainer.create();

  const entries = await Promise.all(
    posts.map(async (post) => {
      const { Content } = await render(post);
      const html = await container.renderToString(Content);
      const url = `${SITE.url}/posts/${post.id}/`;
      return `  <entry xml:lang="${SITE.lang}">
    <title>${esc(post.data.title)}</title>
    <published>${stamp(post.data.date)}</published>
    <updated>${stamp(post.data.date)}</updated>
    <link rel="alternate" type="text/html" href="${url}"/>
    <id>${url}</id>
    <summary type="html">${esc(post.data.description)}</summary>
    <content type="html" xml:base="${url}">${esc(html)}</content>
  </entry>`;
    }),
  );

  const feed = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="${SITE.lang}">
  <title>${esc(BLOG.title)}</title>
  <subtitle>${esc(BLOG.description)}</subtitle>
  <link rel="self" type="application/atom+xml" href="${SITE.url}/posts/feed.xml"/>
  <link rel="alternate" type="text/html" href="${SITE.url}/posts/"/>
  <updated>${posts.length ? stamp(posts[0].data.date) : stamp(new Date())}</updated>
  <id>${SITE.url}/posts/feed.xml</id>
${entries.join('\n')}
</feed>
`;

  return new Response(feed, { headers: { 'Content-Type': 'application/atom+xml; charset=utf-8' } });
}
