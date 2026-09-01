import type { ReactNode } from "react";

import type {
  RichDescription as RichDescriptionValue,
  RichInlineNode
} from "../domain/rich-description.js";
import { sanitizeDescriptionHtml } from "./rich-description-html.js";

interface RichDescriptionProps {
  description: RichDescriptionValue | null;
  editableHtml?: string | null;
}

export function RichDescription({ description, editableHtml = null }: RichDescriptionProps) {
  const renderedHtml = editableHtml?.trim() ? sanitizeDescriptionHtml(editableHtml) : null;

  if (renderedHtml) {
    return <div className="rich-description rich-description-edited" dangerouslySetInnerHTML={{ __html: renderedHtml }} />;
  }

  if (!description) {
    return <p className="empty-copy">Description indisponible.</p>;
  }

  return (
    <div className="rich-description">
      {description.blocks.map((block, blockIndex) => {
        const key = `${block.type}-${blockIndex}`;
        if (block.type === "list") {
          const List = block.ordered ? "ol" : "ul";
          return (
            <List key={key}>
              {block.items.map((item, itemIndex) => (
                <li key={`${key}-${itemIndex}`}>{renderNodes(item)}</li>
              ))}
            </List>
          );
        }
        if (block.type === "quote") {
          return <blockquote key={key}>{renderNodes(block.children, false)}</blockquote>;
        }
        const isHeading = block.children.length === 1
          && block.children[0]?.type === "text"
          && block.children[0].marks?.includes("strong");
        return <p className={isHeading ? "description-heading" : undefined} key={key}>{renderNodes(block.children)}</p>;
      })}
    </div>
  );
}

function renderNodes(nodes: RichInlineNode[], highlight = true): ReactNode[] {
  return nodes.map((node, index) => {
    if (node.type === "icon") {
      return (
        <span className="semantic-icon" title={node.alt} key={`${node.sourceName}-${index}`}>
          ◆ <span className="sr-only">{node.alt}</span>
        </span>
      );
    }

    let value: ReactNode = highlight ? highlightText(node.value, index) : renderLines(node.value, index);
    if (node.marks?.includes("em")) value = <em>{value}</em>;
    if (node.marks?.includes("strong")) value = <strong>{value}</strong>;
    return <span key={`text-${index}`}>{value}</span>;
  });
}

function highlightText(value: string, nodeIndex: number): ReactNode[] {
  const result: ReactNode[] = [];
  let cursor = 0;

  for (const match of value.matchAll(HIGHLIGHT_PATTERN)) {
    const index = match.index;
    if (index > cursor) result.push(...renderLines(value.slice(cursor, index), `${nodeIndex}-${cursor}`));
    result.push(
      <strong
        className={match.groups?.value ? "description-value" : "description-term"}
        key={`${nodeIndex}-${index}`}
      >
        {match[0]}
      </strong>
    );
    cursor = index + match[0].length;
  }

  if (cursor < value.length) result.push(...renderLines(value.slice(cursor), `${nodeIndex}-${cursor}`));
  return result;
}

function renderLines(value: string, key: string | number): ReactNode[] {
  return value.split("\n").flatMap((line, index) =>
    index === 0 ? [line] : [<br key={`${key}-br-${index}`} />, line]
  );
}

const HIGHLIGHT_PATTERN = /(?<value>[+-]?\d+(?:[,.]\d+)?(?:\s*\/\s*[+-]?\d+(?:[,.]\d+)?)*(?:\s*(?:%|mètres?|secondes?|jetons?))?)|(?<term>rayon de terreur|temps de recharge|portes? de sortie|murs? destructibles?|tests? d['’]habileté|vitesse(?: d['’]action| de transport| de franchissement| de régression)?|auras?|générateurs?|palettes?|crochets?(?: du fléau)?|obsession|entité|indétectable|exposé|exposition|épuisement|hémorragie|blessé|mourant|inconscient|hâte|totems?|casiers?|soif de sang)/giu;
