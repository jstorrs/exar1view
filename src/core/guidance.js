// @ts-check
/**
 * The guidance of an add-in: the text the technologist reads, found in the add-in's Data without
 * the full component model. Data is XML whose component configurations are XML-escaped one or more
 * levels; inside `GuidanceCombiConfig`, each `m_rtf…` block holds a XAML FlowDocument whose
 * `Paragraph` text (its `Run` children included) is the guidance, and `m_cfgimg_…/m_image` are
 * base64 PNGs, counted here and not decoded. Pure; never throws.
 */
import { parseXml, decodeXml, nestedXml } from './xmltext.js';

/** @typedef {import('./xmltext.js').XmlNode} XmlNode */
/** @typedef {Extract<XmlNode, { kind: 'element' }>} XmlElement */
/**
 * @typedef {object} Guidance
 * @property {string[][]} texts the paragraphs of each text block, in document order; blocks with no text, or only the stock placeholder, are left out
 * @property {number} images how many images are configured
 * @property {boolean} placeholder a block held only the stock "configure guidance text here" notice and no other block has text
 */

/** Most levels of XML escaped into XML that are unwrapped. */
const MAX_LEVELS = 8;
/** What a block holds until someone writes guidance: a resource key, not prose. */
const PLACEHOLDER = 'i18n://syngo.MR.ApplCommon.Resources.GuidanceResources/Resource/NoticePleaseConfigureGuidanceTextHere';

/** @param {string} name */
const localName = (name) => name.slice(name.indexOf(':') + 1);

/**
 * `nodes` with every text that is itself XML (once decoded) replaced by its nodes, at any depth
 * but below a FlowDocument, whose text is the guidance as written, tags and all.
 * @param {readonly XmlNode[]} nodes
 * @param {number} levels
 * @returns {XmlNode[]}
 */
function expand(nodes, levels) {
  return nodes.flatMap((node) => {
    if (node.kind === 'element') {
      return [localName(node.name) === 'FlowDocument' ? node : { ...node, children: expand(node.children, levels) }];
    }
    if (node.kind !== 'text' || levels >= MAX_LEVELS) return [node];
    const nested = nestedXml(decodeXml(node.text).trim());
    return nested ? expand(nested, levels + 1) : [node];
  });
}

/**
 * The elements in `nodes` whose name, prefix ignored, satisfies `want`, in document order; not looking inside a match.
 * @param {readonly XmlNode[]} nodes
 * @param {(name: string) => boolean} want
 * @returns {XmlElement[]}
 */
function find(nodes, want) {
  return nodes.flatMap((n) => (n.kind !== 'element' ? [] : want(localName(n.name)) ? [n] : find(n.children, want)));
}

/**
 * All the text under `nodes`, decoded.
 * @param {readonly XmlNode[]} nodes
 * @returns {string}
 */
function textOf(nodes) {
  return nodes.map((n) => (n.kind === 'text' ? decodeXml(n.text) : n.kind === 'element' ? (localName(n.name) === 'LineBreak' ? '\n' : textOf(n.children)) : '')).join('');
}

/**
 * The guidance in an add-in's Data, or null when it has no `GuidanceCombiConfig` (or is not XML).
 * @param {string} data
 * @returns {Guidance | null}
 */
export function guidanceOf(data) {
  try {
    if (typeof data !== 'string' || !data.includes('GuidanceCombiConfig')) return null;
    const nodes = parseXml(data);
    if (nodes === null) return null;
    const [config] = find(expand(nodes, 0), (n) => n === 'GuidanceCombiConfig');
    if (!config) return null;
    const blocks = find(config.children, (n) => n.startsWith('m_rtf'))
      .map((block) =>
        find(find(block.children, (n) => n === 'm_guidingString'), (n) => n === 'Paragraph')
          .map((p) => textOf(p.children).trim())
          .filter((t) => t !== ''))
      .filter((paragraphs) => paragraphs.length > 0);
    const texts = blocks.filter((paragraphs) => !paragraphs.every((t) => t === PLACEHOLDER));
    const images = find(config.children, (n) => n.startsWith('m_cfgimg'))
      .flatMap((img) => find(img.children, (n) => n === 'm_image'))
      .filter((image) => textOf(image.children).trim() !== '').length;
    return { texts, images, placeholder: texts.length === 0 && blocks.length > 0 };
  } catch {
    return null;
  }
}
