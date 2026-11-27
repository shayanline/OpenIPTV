import { createElement, Fragment, useMemo, type ReactNode } from "react";

const FORMATTING = new Set(["b", "strong", "i", "em", "u", "ruby", "rt", "br"]);
const OMITTED = new Set(["script", "style", "iframe", "object", "svg", "math", "template"]);

function subtitleContent(cue: string): ReactNode {
  // Template content stays inert. Only these formatting elements reach the rendered tree.
  const template = document.createElement("template");
  template.innerHTML = cue;
  const childrenOf = (parent: Node): ReactNode[] =>
    Array.from(parent.childNodes, (node, index) => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent;
      if (node.nodeType !== Node.ELEMENT_NODE) return null;
      const tag = (node as Element).localName;
      if (OMITTED.has(tag)) return null;
      const children = childrenOf(node);
      return FORMATTING.has(tag)
        ? createElement(tag, { key: index }, ...(tag === "br" ? [] : children))
        : createElement(Fragment, { key: index }, ...children);
    });
  return childrenOf(template.content);
}

/**
 * The application's own subtitle text, inside the television safe area.
 *
 * Safe subtitle formatting inherits the app direction without provider attributes.
 * The layer renders nothing when subtitles are Off or there is no cue. Open playback
 * controls position it above their top edge, while other surfaces use the safe area.
 */
export interface SubtitleLayerProps {
  cue: string;
  hidden: boolean;
}

export function SubtitleLayer({ cue, hidden }: SubtitleLayerProps) {
  const content = useMemo(() => (hidden || !cue ? null : subtitleContent(cue)), [cue, hidden]);
  if (hidden || !cue) return null;
  return (
    <div className="subtitle-layer" aria-live="off">
      <p className="subtitle-cue">{content}</p>
    </div>
  );
}
