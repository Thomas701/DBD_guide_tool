export type RichTextMark = "strong" | "em";

export interface RichTextNode {
  type: "text";
  value: string;
  marks?: RichTextMark[];
}

export interface RichIconNode {
  type: "icon";
  sourceName: string;
  ref: string | null;
  alt: string;
}

export type RichInlineNode = RichTextNode | RichIconNode;

export interface RichParagraphBlock {
  type: "paragraph";
  children: RichInlineNode[];
}

export interface RichQuoteBlock {
  type: "quote";
  children: RichInlineNode[];
}

export interface RichListBlock {
  type: "list";
  ordered: boolean;
  items: RichInlineNode[][];
}

export type RichDescriptionBlock =
  | RichParagraphBlock
  | RichQuoteBlock
  | RichListBlock;

export interface RichDescription {
  version: 1;
  blocks: RichDescriptionBlock[];
}
