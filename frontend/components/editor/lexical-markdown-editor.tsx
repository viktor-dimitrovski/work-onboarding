"use client";

import { useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { ListPlugin } from '@lexical/react/LexicalListPlugin';
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin';
import { TablePlugin } from '@lexical/react/LexicalTablePlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { MarkdownShortcutPlugin } from '@lexical/react/LexicalMarkdownShortcutPlugin';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import LexicalErrorBoundary from '@lexical/react/LexicalErrorBoundary';
import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import { ListItemNode, ListNode } from '@lexical/list';
import { TableCellNode, TableNode, TableRowNode } from '@lexical/table';
import { LinkNode } from '@lexical/link';
import { CodeNode } from '@lexical/code';

import { MARKDOWN_TRANSFORMERS, exportMarkdown, importMarkdown } from './markdown-bridge';
import { EditorToolbar } from './toolbar';
import { SlashMenu } from './slash-menu';
import { cn } from '@/lib/utils';

type LexicalMarkdownEditorProps = {
  value: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
  className?: string;
  contentEditableId?: string;
  contentEditableClassName?: string;
};

function MarkdownSyncPlugin({ value, lastValueRef }: { value: string; lastValueRef: MutableRefObject<string> }) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (value === lastValueRef.current) return;
    editor.update(() => {
      importMarkdown(value);
    });
    lastValueRef.current = value;
  }, [editor, value, lastValueRef]);

  return null;
}

export function LexicalMarkdownEditor({
  value,
  onChange,
  placeholder,
  className,
  contentEditableId,
  contentEditableClassName,
}: LexicalMarkdownEditorProps) {
  const lastValueRef = useRef(value);

  const initialConfig = useMemo(
    () => ({
      namespace: 'wo-lexical-editor',
      onError(error: Error) {
        throw error;
      },
      nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, TableNode, TableRowNode, TableCellNode, LinkNode, CodeNode],
      editorState: () => {
        importMarkdown(value);
        lastValueRef.current = value;
      },
    }),
    [],
  );

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div className={className}>
        <EditorToolbar />
        <div className='relative mt-2 rounded-md border bg-white p-3'>
          <SlashMenu />
          <RichTextPlugin
            contentEditable={
              <ContentEditable
                id={contentEditableId}
                className={cn('min-h-[240px] outline-none', contentEditableClassName)}
              />
            }
            placeholder={<div className='text-sm text-muted-foreground'>{placeholder || 'Start typing...'}</div>}
            ErrorBoundary={LexicalErrorBoundary}
          />
          <HistoryPlugin />
          <ListPlugin />
          <LinkPlugin />
          <TablePlugin />
          <MarkdownShortcutPlugin transformers={MARKDOWN_TRANSFORMERS} />
          <OnChangePlugin
            onChange={(editorState) => {
              editorState.read(() => {
                const markdown = exportMarkdown();
                if (markdown !== lastValueRef.current) {
                  lastValueRef.current = markdown;
                  onChange(markdown);
                }
              });
            }}
          />
          <MarkdownSyncPlugin value={value} lastValueRef={lastValueRef} />
        </div>
      </div>
    </LexicalComposer>
  );
}
