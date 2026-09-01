import type {
  RichDescription as RichDescriptionValue,
  RichInlineNode,
  RichTextMark,
} from "../domain/rich-description.js";

const ALLOWED_TAGS = new Set([
  "BLOCKQUOTE",
  "BR",
  "EM",
  "LI",
  "OL",
  "P",
  "SPAN",
  "STRONG",
  "U",
  "UL",
]);

const BLOCK_LEVEL_TAGS = new Set(["BLOCKQUOTE", "OL", "P", "UL"]);

const TAG_RENAMES = new Map([
  ["B", "STRONG"],
  ["DIV", "P"],
  ["FONT", "SPAN"],
  ["I", "EM"],
]);

const ALLOWED_SPAN_CLASSES = new Set(["description-term", "description-value"]);

const HIGHLIGHT_PATTERN = /(?<value>[+-]?\d+(?:[,.]\d+)?(?:\s*\/\s*[+-]?\d+(?:[,.]\d+)?)*(?:\s*(?:%|mètres?|secondes?|jetons?))?)|(?<term>rayon de terreur|temps de recharge|portes? de sortie|murs? destructibles?|tests? d['’]habileté|vitesse(?: d['’]action| de transport| de franchissement| de régression)?|auras?|générateurs?|palettes?|crochets?(?: du fléau)?|obsession|entité|indétectable|exposé|exposition|épuisement|hémorragie|blessé|mourant|inconscient|hâte|totems?|casiers?|soif de sang)/giu;

export function richDescriptionToEditableHtml(description: RichDescriptionValue | null): string {
  if (!description || description.blocks.length === 0) return "";

  return description.blocks.map((block) => {
    if (block.type === "list") {
      const tag = block.ordered ? "ol" : "ul";
      return `<${tag}>${block.items.map((item) => `<li>${renderInlineNodesToHtml(item)}</li>`).join("")}</${tag}>`;
    }
    if (block.type === "quote") return `<blockquote>${renderInlineNodesToHtml(block.children)}</blockquote>`;
    return `<p>${renderInlineNodesToHtml(block.children)}</p>`;
  }).join("");
}

export function sanitizeDescriptionHtml(html: string): string {
  const trimmed = html.trim();
  if (!trimmed || typeof document === "undefined") return trimmed;

  const template = document.createElement("template");
  template.innerHTML = trimmed;

  const root = document.createElement("div");
  root.append(...sanitizeNodes(Array.from(template.content.childNodes)));
  normalizeTopLevelNodes(root);

  return root.innerHTML.trim();
}

export function hasMeaningfulDescriptionContent(html: string): boolean {
  const trimmed = html.trim();
  if (!trimmed) return false;
  if (typeof document === "undefined") return trimmed.length > 0;

  const root = document.createElement("div");
  root.innerHTML = trimmed;
  return (root.textContent ?? "").trim().length > 0;
}

function renderInlineNodesToHtml(nodes: readonly RichInlineNode[]): string {
  return nodes.map((node) => {
    if (node.type === "icon") return escapeHtml(node.alt);

    let value = highlightTextToHtml(node.value);
    value = applyTextMarks(value, node.marks ?? []);
    return value;
  }).join("");
}

function highlightTextToHtml(value: string): string {
  let result = "";
  let cursor = 0;

  for (const match of value.matchAll(HIGHLIGHT_PATTERN)) {
    const index = match.index ?? 0;
    if (index > cursor) result += escapeHtml(value.slice(cursor, index)).replace(/\n/g, "<br>");

    const className = match.groups?.value ? "description-value" : "description-term";
    result += `<span class="${className}">${escapeHtml(match[0])}</span>`;
    cursor = index + match[0].length;
  }

  if (cursor < value.length) result += escapeHtml(value.slice(cursor)).replace(/\n/g, "<br>");
  return result || escapeHtml(value).replace(/\n/g, "<br>");
}

function applyTextMarks(value: string, marks: readonly RichTextMark[]): string {
  let next = value;
  if (marks.includes("em")) next = `<em>${next}</em>`;
  if (marks.includes("strong")) next = `<strong>${next}</strong>`;
  return next;
}

function sanitizeNodes(nodes: readonly ChildNode[]): Node[] {
  return nodes.flatMap((node) => sanitizeNode(node));
}

function sanitizeNode(node: ChildNode): Node[] {
  if (node.nodeType === Node.TEXT_NODE) {
    return [document.createTextNode(node.textContent ?? "")];
  }

  if (!(node instanceof HTMLElement)) return [];

  const originalTag = node.tagName.toUpperCase();
  const tag = TAG_RENAMES.get(originalTag) ?? originalTag;
  if (tag === "BR") return [document.createElement("br")];
  if (!ALLOWED_TAGS.has(tag)) return sanitizeNodes(Array.from(node.childNodes));

  const element = document.createElement(tag.toLowerCase());
  if (tag === "SPAN") applySpanStyles(node, element as HTMLSpanElement);

  element.append(...sanitizeNodes(Array.from(node.childNodes)));

  if ((tag === "OL" || tag === "UL") && !(element as HTMLElement).querySelector("li")) {
    return sanitizeNodes(Array.from(element.childNodes));
  }

  if ((tag === "BLOCKQUOTE" || tag === "LI" || tag === "P") && !hasMeaningfulElementContent(element as HTMLElement)) {
    return [];
  }

  return [element];
}

function applySpanStyles(source: HTMLElement, target: HTMLSpanElement): void {
  const classNames = Array.from(source.classList).filter((className) => ALLOWED_SPAN_CLASSES.has(className));
  const backgroundColor = sanitizeCssColor(source.style.backgroundColor || (source.getAttribute("bgcolor") ?? ""));
  const hasSemanticValueClass = classNames.includes("description-value") || backgroundColor !== null;
  const hasSemanticTermClass = classNames.includes("description-term");

  if (hasSemanticValueClass) target.classList.add("description-value");
  else if (hasSemanticTermClass) target.classList.add("description-term");

  const color = sanitizeCssColor(source.style.color || (source.getAttribute("color") ?? ""));
  if (color && !hasSemanticValueClass && !hasSemanticTermClass) target.style.color = color;

  if (backgroundColor && !hasSemanticValueClass) target.style.backgroundColor = backgroundColor;

  const fontWeight = sanitizeFontWeight(source.style.fontWeight);
  if (fontWeight) target.style.fontWeight = fontWeight;

  if (source.style.fontStyle === "italic") target.style.fontStyle = "italic";

  const textDecoration = source.style.textDecorationLine || source.style.textDecoration;
  if (textDecoration.includes("underline")) target.style.textDecoration = "underline";
}

function sanitizeCssColor(value: string): string | null {
  if (!value) return null;

  const probe = document.createElement("span");
  probe.style.color = "";
  probe.style.color = value;
  return probe.style.color || null;
}

function sanitizeFontWeight(value: string): string | null {
  if (!value) return null;
  if (value === "bold") return "700";

  const numeric = Number.parseInt(value, 10);
  return Number.isFinite(numeric) && numeric >= 600 ? String(numeric) : null;
}

function hasMeaningfulElementContent(element: HTMLElement): boolean {
  return (element.textContent ?? "").trim().length > 0 || element.querySelector("br") !== null;
}

function normalizeTopLevelNodes(root: HTMLDivElement): void {
  const output = document.createElement("div");
  let paragraph: HTMLParagraphElement | null = null;

  for (const child of Array.from(root.childNodes)) {
    const isBlock = child.nodeType === Node.ELEMENT_NODE
      && BLOCK_LEVEL_TAGS.has((child as HTMLElement).tagName.toUpperCase());
    const isMeaningfulText = child.nodeType !== Node.TEXT_NODE || Boolean(child.textContent?.trim());

    if (!isMeaningfulText) continue;

    if (isBlock) {
      paragraph = null;
      output.append(child);
      continue;
    }

    if (!paragraph) {
      paragraph = document.createElement("p");
      output.append(paragraph);
    }

    paragraph.append(child);
  }

  root.replaceChildren(...Array.from(output.childNodes));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}