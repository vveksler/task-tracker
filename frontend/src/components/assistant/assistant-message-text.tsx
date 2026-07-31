/**
 * Safe plain-text formatting for assistant messages (no HTML from the model).
 * Supports newlines, "- " / "* " lists, and **bold** — nothing else.
 */

import { Fragment, type ReactNode } from 'react';

function renderInline(text: string): ReactNode[] {
  // Only paired **bold**; unpaired * are shown as plain text.
  const parts = text.split(/(\*\*[^*\n]+?\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={i} className="font-semibold text-gray-900">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

function isBullet(line: string): boolean {
  return /^\s*[-*•]\s+/.test(line);
}

function bulletBody(line: string): string {
  return line.replace(/^\s*[-*•]\s+/, '');
}

export function AssistantMessageText({
  text,
  placeholder,
}: {
  text: string;
  placeholder?: string;
}): React.ReactElement {
  const trimmed = text.trimEnd();
  if (!trimmed) {
    return (
      <p className="text-sm text-gray-800">{placeholder ?? ''}</p>
    );
  }

  const blocks = trimmed.split(/\n{2,}/);
  const nodes: ReactNode[] = [];

  blocks.forEach((block, blockIdx) => {
    const lines = block.split('\n');
    const allBullets =
      lines.length > 0 && lines.every((l) => !l.trim() || isBullet(l));

    if (allBullets) {
      nodes.push(
        <ul
          key={`ul-${blockIdx}`}
          className="my-2 list-disc space-y-1.5 pl-5 text-sm text-gray-800"
        >
          {lines
            .filter((l) => l.trim())
            .map((line, i) => (
              <li key={i} className="leading-relaxed">
                {renderInline(bulletBody(line))}
              </li>
            ))}
        </ul>,
      );
      return;
    }

    nodes.push(
      <p key={`p-${blockIdx}`} className="my-1.5 text-sm leading-relaxed text-gray-800">
        {lines.map((line, i) => (
          <Fragment key={i}>
            {i > 0 && <br />}
            {isBullet(line) ? (
              <>
                <span className="mr-1">•</span>
                {renderInline(bulletBody(line))}
              </>
            ) : (
              renderInline(line)
            )}
          </Fragment>
        ))}
      </p>,
    );
  });

  return <div className="space-y-0.5 break-words">{nodes}</div>;
}
