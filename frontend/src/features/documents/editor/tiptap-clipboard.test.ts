import { afterEach, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { tiptapExtensions } from './tiptap-extensions';
import { toTiptapDocument, fromTiptapDocument } from './tiptap-model';
import type { OrbisBlock } from '../../content/model/blocks';
const editors: Editor[] = [];
afterEach(() => editors.splice(0).forEach(e => e.destroy()));
function editor(blocks: OrbisBlock[] = []) {
  const instance = new Editor({ extensions: tiptapExtensions, content: toTiptapDocument({ schema_version: 2, editor: 'blocknote', blocks }) });
  editors.push(instance); return instance;
}
function pasteCopy(source: Editor) {
  const clipboard = source.view.serializeForClipboard(source.state.doc.slice(0, source.state.doc.content.size));
  const destination = editor();
  destination.view.pasteHTML(clipboard.dom.innerHTML, new Event('paste') as ClipboardEvent);
  return fromTiptapDocument(destination.getJSON());
}
it('preserves media URL through native editor copy and paste', () => {
  const copied = pasteCopy(editor([{ id: 'media-1', type: 'image', props: { url: 'https://example.com/photo.png', caption: 'Important diagram', name: 'photo.png' }, content: [], children: [] }]));
  expect(copied.blocks.find(b => b.type === 'image')?.props.url).toBe('https://example.com/photo.png');
});
it('preserves a documentation card through native editor copy and paste', () => {
  const copied = pasteCopy(editor([{ id: 'card-1', type: 'card', props: { title: 'Read the guide', href: 'https://example.com/guide' }, content: [], children: [{ id: 'body-1', type: 'paragraph', props: {}, content: [{ type: 'text', text: 'Body' }], children: [] }] }]));
  expect(copied.blocks.find(b => b.type === 'card')?.props.title).toBe('Read the guide');
});

it('keeps a callout body and authored colors in their original fields', () => {
  const copied = pasteCopy(editor([{ id: 'callout', type: 'callout', props: { title: 'Review', tone: 'warning', private_token: 'not-for-the-clipboard' }, content: [{ type: 'text', text: 'Keep color', styles: { textColor: '#aabbcc' } }], children: [] }]));
  expect(copied.blocks[0]).toMatchObject({ type: 'callout', props: { title: 'Review', tone: 'warning' }, content: [{ type: 'text', text: 'Keep color', styles: { textColor: '#aabbcc' } }], children: [] });
  expect(copied.blocks[0].props).not.toHaveProperty('private_token');
});

it('ignores unknown component kinds in untrusted pasted HTML', () => {
  const destination = editor();
  expect(() => destination.view.pasteHTML('<section data-document-component="unknown">Readable text</section>', new Event('paste') as ClipboardEvent)).not.toThrow();
  expect(destination.getText()).toContain('Readable text');
});

it('does not let generic HTML attributes override validated clipboard attributes', () => {
  const destination = editor();
  destination.view.pasteHTML('<section data-document-component="callout" kind="unknown"><p>Body</p></section><figure data-orbis-media="image" data-src="https://example.com/valid.png" kind="unknown" url="wrong"><figcaption>Caption</figcaption></figure>', new Event('paste') as ClipboardEvent);
  const blocks = fromTiptapDocument(destination.getJSON()).blocks;
  expect(blocks[0].type).toBe('callout');
  expect(blocks[1]).toMatchObject({ type: 'image', props: { url: 'https://example.com/valid.png', caption: 'Caption' } });
});
