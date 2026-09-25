import { marked } from 'marked';

/** Render a trusted markdown string from a data file. */
export function md(text: string): string {
  return marked.parse(text.trim(), { async: false, gfm: true }) as string;
}
