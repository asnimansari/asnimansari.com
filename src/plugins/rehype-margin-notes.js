// rehype-margin-notes
// ----------------------------------------------------------------------------
// Converts standard markdown footnotes (produced by remark-gfm) into
// Tufte-style margin notes that float into the side margin on wide screens
// and collapse to inline asides on narrow screens.
//
// Authoring:
//   Some sentence that needs an aside.[^1] More text.
//   [^1]: This will appear in the right margin.
//
//   For an unnumbered note (no superscript marker), use a label that begins
//   with `*`:
//   Some sentence.[^*hush] More text.
//   [^*hush]: This appears as a bare margin note.
//
// Output: each footnote reference is replaced inline by
//   <sup class="mn-ref">N</sup><span class="margin-note">…</span>
// (a <span> rather than <aside> so it remains valid inside <p>).
// The bottom <section data-footnotes> emitted by remark-gfm is removed.

export default function rehypeMarginNotes() {
  return (tree) => {
    const defs = new Map();
    let footnoteSection = null;
    let footnoteParent = null;

    // Locate the footnote section and collect definitions.
    walk(tree, (node, parent) => {
      if (
        node.type === 'element' &&
        node.tagName === 'section' &&
        node.properties &&
        node.properties.dataFootnotes !== undefined
      ) {
        footnoteSection = node;
        footnoteParent = parent;
      }
    });

    if (!footnoteSection) return;

    const ol = footnoteSection.children.find(
      (c) => c.type === 'element' && c.tagName === 'ol'
    );
    if (ol) {
      for (const li of ol.children) {
        if (li.type !== 'element' || li.tagName !== 'li') continue;
        const id = li.properties && li.properties.id;
        if (!id) continue;
        defs.set(id, stripBackrefs(li.children));
      }
    }

    // Replace each footnote reference with marker + margin note span.
    walk(tree, (node) => {
      if (!node.children || node.children.length === 0) return;
      const next = [];
      for (const child of node.children) {
        const ref = matchFootnoteRef(child);
        if (ref) {
          const def = defs.get(ref.targetId);
          if (def) {
            // remark-gfm always renders the visible reference as a sequential
            // number. The original label (e.g. `*hush`) survives in the id
            // as `user-content-fn-*hush`, so we read the unnumbered marker
            // from there.
            const originalLabel = ref.targetId.replace(/^user-content-fn-/, '');
            const isUnnumbered = /^\*/.test(originalLabel);
            if (!isUnnumbered) {
              next.push({
                type: 'element',
                tagName: 'sup',
                properties: { className: ['mn-ref'] },
                children: [{ type: 'text', value: ref.label }],
              });
            }
            next.push({
              type: 'element',
              tagName: 'span',
              properties: {
                className: [
                  'margin-note',
                  isUnnumbered ? 'margin-note--bare' : 'margin-note--numbered',
                ],
              },
              children: isUnnumbered
                ? unwrapFirstParagraph(def)
                : [
                    {
                      type: 'element',
                      tagName: 'span',
                      properties: { className: ['mn-num'] },
                      children: [{ type: 'text', value: ref.label }],
                    },
                    ...unwrapFirstParagraph(def),
                  ],
            });
            continue;
          }
        }
        next.push(child);
      }
      node.children = next;
    });

    // Remove the bottom footnote section.
    if (footnoteParent) {
      footnoteParent.children = footnoteParent.children.filter(
        (c) => c !== footnoteSection
      );
    }
  };
}

// ---------- helpers ---------------------------------------------------------

function walk(node, visit, parent = null) {
  if (!node || typeof node !== 'object') return;
  visit(node, parent);
  if (node.children) {
    for (const child of node.children) walk(child, visit, node);
  }
}

function matchFootnoteRef(node) {
  // remark-gfm wraps refs as <sup><a data-footnote-ref href="#…">N</a></sup>
  if (
    node.type !== 'element' ||
    node.tagName !== 'sup' ||
    !node.children ||
    node.children.length === 0
  ) {
    return null;
  }
  const a = node.children[0];
  if (
    a.type !== 'element' ||
    a.tagName !== 'a' ||
    !a.properties ||
    a.properties.dataFootnoteRef === undefined
  ) {
    return null;
  }
  const href = a.properties.href || '';
  return {
    targetId: href.replace(/^#/, ''),
    label: textOf(a),
  };
}

function stripBackrefs(nodes) {
  if (!nodes) return [];
  const out = [];
  for (const n of nodes) {
    if (
      n.type === 'element' &&
      n.tagName === 'a' &&
      n.properties &&
      n.properties.dataFootnoteBackref !== undefined
    ) {
      continue;
    }
    if (n.children) {
      out.push({ ...n, children: stripBackrefs(n.children) });
    } else {
      out.push(n);
    }
  }
  return out;
}

// If the definition is wrapped in a single <p>, unwrap it so we don't nest
// block elements inside the inline <span class="margin-note">.
function unwrapFirstParagraph(nodes) {
  const cleaned = nodes.filter(
    (n) => !(n.type === 'text' && /^\s*$/.test(n.value))
  );
  if (
    cleaned.length === 1 &&
    cleaned[0].type === 'element' &&
    cleaned[0].tagName === 'p'
  ) {
    return cleaned[0].children;
  }
  return nodes;
}

function textOf(node) {
  if (!node) return '';
  if (node.type === 'text') return node.value;
  if (node.children) return node.children.map(textOf).join('');
  return '';
}
