import { $convertFromMarkdownString, $convertToMarkdownString, TRANSFORMERS } from '@lexical/markdown';

export const MARKDOWN_TRANSFORMERS = TRANSFORMERS;

export function importMarkdown(markdown: string): void {
  $convertFromMarkdownString(markdown, MARKDOWN_TRANSFORMERS);
}

export function exportMarkdown(): string {
  return $convertToMarkdownString(MARKDOWN_TRANSFORMERS);
}
