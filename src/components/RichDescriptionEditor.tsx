import { useEffect, useRef, useState, type MouseEvent } from "react";

import type { RichDescription as RichDescriptionValue } from "../domain/rich-description.js";
import {
  hasMeaningfulDescriptionContent,
  richDescriptionToEditableHtml,
  sanitizeDescriptionHtml,
} from "./rich-description-html.js";

interface RichDescriptionEditorProps {
  description: RichDescriptionValue | null;
  initialHtml: string | null;
  onSave: (html: string) => void;
  onCancel: () => void;
  onReset?: () => void;
}

type EditorCommand = "bold" | "italic" | "underline" | "insertUnorderedList" | "removeFormat" | "foreColor";

interface ToolbarAction {
  label: string;
  shortLabel: string;
  command: Exclude<EditorCommand, "foreColor">;
}

type EditableDocument = Document & {
  execCommand: (commandId: string, showUi?: boolean, value?: string) => boolean;
};

const FORMATTING_TAGS = new Set(["B", "EM", "FONT", "I", "SPAN", "STRONG", "U"]);
const STRUCTURAL_TAGS = new Set(["BLOCKQUOTE", "BR", "LI", "OL", "P", "UL"]);

const TOOLBAR_ACTIONS: readonly ToolbarAction[] = [
  { label: "Gras", shortLabel: "B", command: "bold" },
  { label: "Italique", shortLabel: "I", command: "italic" },
  { label: "Souligner", shortLabel: "U", command: "underline" },
  { label: "Liste", shortLabel: "Liste", command: "insertUnorderedList" },
];

const COLOR_PRESETS = [
  { label: "Rouge", value: "#f16c65" },
  { label: "Ambre", value: "#f0ca7f" },
  { label: "Bleu", value: "#79c7ff" },
  { label: "Vert", value: "#9ad7a0" },
  { label: "Blanc", value: "#f3f0eb" },
] as const;

const YELLOW_HIGHLIGHT_FOREGROUND = "#f0ca7f";
const YELLOW_HIGHLIGHT_BACKGROUND = "rgb(209 173 104 / 11%)";

export function RichDescriptionEditor({
  description,
  initialHtml,
  onSave,
  onCancel,
  onReset,
}: RichDescriptionEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [draftHtml, setDraftHtml] = useState("");

  useEffect(() => {
    const nextHtml = initialHtml?.trim()
      ? sanitizeDescriptionHtml(initialHtml)
      : richDescriptionToEditableHtml(description);

    setDraftHtml(nextHtml);
    if (editorRef.current) editorRef.current.innerHTML = nextHtml;
  }, [description, initialHtml]);

  useEffect(() => {
    editorRef.current?.focus();
  }, []);

  function keepSelection(event: MouseEvent<HTMLButtonElement>): void {
    event.preventDefault();
  }

  function syncDraft(): void {
    setDraftHtml(editorRef.current?.innerHTML ?? "");
  }

  function applyCommand(command: EditorCommand, value?: string): void {
    editorRef.current?.focus();
    (document as EditableDocument).execCommand(command, false, value);
    syncDraft();
  }

  function clearFormatting(): void {
    const editor = editorRef.current;
    if (!editor) return;

    editor.focus();
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    if (!selection || !range || !editor.contains(range.commonAncestorContainer)) {
      return;
    }

    const workingRange = range.cloneRange();
    if (workingRange.collapsed) {
      const inlineContainer = closestFormattingContainer(workingRange.startContainer, editor);
      if (!inlineContainer) {
        (document as EditableDocument).execCommand("removeFormat", false);
        syncDraft();
        return;
      }
      workingRange.selectNodeContents(inlineContainer);
    }

    const fragment = workingRange.extractContents();
    const cleanedFragment = stripFormattingFromFragment(fragment);
    const lastInsertedNode = cleanedFragment.lastChild;

    workingRange.insertNode(cleanedFragment);
    editor.normalize();

    selection.removeAllRanges();
    const nextRange = document.createRange();
    if (lastInsertedNode) {
      nextRange.setStartAfter(lastInsertedNode);
    } else {
      nextRange.selectNodeContents(editor);
      nextRange.collapse(false);
    }
    nextRange.collapse(true);
    selection.addRange(nextRange);
    syncDraft();
  }

  function applyYellowHighlight(): void {
    editorRef.current?.focus();

    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    if (!selection || !range || selection.isCollapsed || !editorRef.current?.contains(range.commonAncestorContainer)) {
      return;
    }

    const fragment = range.cloneContents();
    if (!fragment.textContent?.trim()) return;

    if (!containsBlockNode(fragment)) {
      const wrapper = document.createElement("span");
      wrapper.className = "description-value";
      wrapper.append(range.extractContents());
      range.insertNode(wrapper);

      selection.removeAllRanges();
      const nextRange = document.createRange();
      nextRange.selectNodeContents(wrapper);
      selection.addRange(nextRange);
      syncDraft();
      return;
    }

    const editableDocument = document as EditableDocument;
    editableDocument.execCommand("styleWithCSS", false, "true");

    const highlighted = editableDocument.execCommand("hiliteColor", false, YELLOW_HIGHLIGHT_BACKGROUND);
    if (!highlighted) editableDocument.execCommand("backColor", false, YELLOW_HIGHLIGHT_BACKGROUND);

    editableDocument.execCommand("foreColor", false, YELLOW_HIGHLIGHT_FOREGROUND);
    syncDraft();
  }

  function save(): void {
    const nextHtml = sanitizeDescriptionHtml(editorRef.current?.innerHTML ?? draftHtml);
    if (!hasMeaningfulDescriptionContent(nextHtml)) return;

    if (editorRef.current) editorRef.current.innerHTML = nextHtml;
    setDraftHtml(nextHtml);
    onSave(nextHtml);
  }

  return (
    <div className="description-editor">
      <p className="description-editor-note">Les changements sont enregistrés localement sur cet appareil.</p>

      <div className="description-editor-toolbar" role="toolbar" aria-label="Outils de mise en forme de la description">
        {TOOLBAR_ACTIONS.map((action) => (
          <button
            className="editor-tool-button"
            key={action.command}
            type="button"
            onMouseDown={keepSelection}
            onClick={() => applyCommand(action.command)}
            title={action.label}
            aria-label={action.label}
          >
            {action.shortLabel}
          </button>
        ))}

        <span className="editor-toolbar-label">Couleurs</span>
        {COLOR_PRESETS.map((preset) => (
          <button
            className="editor-color-button"
            key={preset.value}
            type="button"
            onMouseDown={keepSelection}
            onClick={() => applyCommand("foreColor", preset.value)}
            title={preset.label}
            aria-label={preset.label}
            style={{ background: preset.value }}
          />
        ))}

        <button
          className="editor-tool-button highlight-tool-button"
          type="button"
          onMouseDown={keepSelection}
          onClick={applyYellowHighlight}
          title="Surligner en jaune"
          aria-label="Surligner en jaune"
        >
          Surl.
        </button>

        <button
          className="editor-tool-button wide"
          type="button"
          onMouseDown={keepSelection}
          onClick={clearFormatting}
        >
          Nettoyer
        </button>
      </div>

      <div
        className="rich-description description-editor-surface"
        contentEditable
        data-placeholder="Ajoutez ici une description plus claire et plus concise."
        onBlur={syncDraft}
        onInput={syncDraft}
        ref={editorRef}
        suppressContentEditableWarning
      />

      <div className="description-editor-actions">
        {onReset && (
          <button className="text-button" type="button" onClick={onReset}>
            Réinitialiser
          </button>
        )}
        <button className="secondary-button compact-button" type="button" onClick={onCancel}>
          Annuler
        </button>
        <button
          className="primary-button compact-button"
          type="button"
          disabled={!hasMeaningfulDescriptionContent(draftHtml)}
          onClick={save}
        >
          Enregistrer
        </button>
      </div>
    </div>
  );
}

function containsBlockNode(fragment: DocumentFragment): boolean {
  return Array.from(fragment.childNodes).some((node) =>
    node.nodeType === Node.ELEMENT_NODE
    && ["BLOCKQUOTE", "LI", "OL", "P", "UL"].includes((node as HTMLElement).tagName.toUpperCase())
  );
}

function closestFormattingContainer(node: Node, root: HTMLElement): HTMLElement | null {
  let current: Node | null = node.nodeType === Node.ELEMENT_NODE ? node : node.parentNode;

  while (current && current !== root) {
    if (current instanceof HTMLElement && FORMATTING_TAGS.has(current.tagName.toUpperCase())) {
      return current;
    }
    current = current.parentNode;
  }

  return null;
}

function stripFormattingFromFragment(fragment: DocumentFragment): DocumentFragment {
  const cleaned = document.createDocumentFragment();
  for (const node of Array.from(fragment.childNodes)) {
    cleaned.append(...cloneNodesWithoutFormatting(node));
  }
  return cleaned;
}

function cloneNodesWithoutFormatting(node: Node): Node[] {
  if (node.nodeType === Node.TEXT_NODE) {
    return [document.createTextNode(node.textContent ?? "")];
  }

  if (!(node instanceof HTMLElement)) return [];

  const tag = node.tagName.toUpperCase();
  if (!FORMATTING_TAGS.has(tag) && !STRUCTURAL_TAGS.has(tag)) {
    return Array.from(node.childNodes).flatMap((child) => cloneNodesWithoutFormatting(child));
  }

  if (!STRUCTURAL_TAGS.has(tag)) {
    return Array.from(node.childNodes).flatMap((child) => cloneNodesWithoutFormatting(child));
  }

  const element = document.createElement(tag.toLowerCase());
  element.append(...Array.from(node.childNodes).flatMap((child) => cloneNodesWithoutFormatting(child)));
  return [element];
}