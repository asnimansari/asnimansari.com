import { getPosts } from '../lib/posts';
import { SITE } from '../consts';

export async function GET() {
  const posts = await getPosts();

  const postLines = posts.map((p) => `- [${p.data.title}](${SITE.url}/posts/${p.id}/): ${p.data.description}`).join('\n');

  const body = `# ${SITE.title}

> ${SITE.bio}

## Posts

${postLines}

## Pages

- [Books](${SITE.url}/books/): Books I've read.
- [Bookmarks](${SITE.url}/bookmarks/): Links worth keeping.
- [Resume](${SITE.url}/resume/): Experience, projects, and education.
`;

  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
