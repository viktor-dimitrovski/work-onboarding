"use client";

import {
  FORMAT_ELEMENT_COMMAND,
  FORMAT_TEXT_COMMAND,
  REDO_COMMAND,
  UNDO_COMMAND,
} from 'lexical';
import { INSERT_ORDERED_LIST_COMMAND, INSERT_UNORDERED_LIST_COMMAND, REMOVE_LIST_COMMAND } from '@lexical/list';
import { TOGGLE_LINK_COMMAND } from '@lexical/link';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const TOOLBAR_BUTTON = 'h-8 px-2 text-xs';

export function EditorToolbar() {
  const [editor] = useLexicalComposerContext();

  const insertLink = () => {
    const url = window.prompt('Link URL');
    if (url === null) return;
    if (url.trim() === '') {
      editor.dispatchCommand(TOGGLE_LINK_COMMAND, null);
      return;
    }
    editor.dispatchCommand(TOGGLE_LINK_COMMAND, url.trim());
  };

  return (
    <div className='flex flex-wrap items-center gap-1 rounded-md border bg-white px-2 py-1'>
      <Button
        type='button'
        variant='ghost'
        className={cn(TOOLBAR_BUTTON)}
        onClick={() => editor.dispatchCommand(UNDO_COMMAND, undefined)}
      >
        Undo
      </Button>
      <Button
        type='button'
        variant='ghost'
        className={cn(TOOLBAR_BUTTON)}
        onClick={() => editor.dispatchCommand(REDO_COMMAND, undefined)}
      >
        Redo
      </Button>
      <div className='h-5 w-px bg-muted' />
      <Button
        type='button'
        variant='ghost'
        className={cn(TOOLBAR_BUTTON, 'font-semibold')}
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold')}
      >
        B
      </Button>
      <Button
        type='button'
        variant='ghost'
        className={cn(TOOLBAR_BUTTON, 'italic')}
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic')}
      >
        I
      </Button>
      <Button
        type='button'
        variant='ghost'
        className={cn(TOOLBAR_BUTTON, 'underline')}
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'underline')}
      >
        U
      </Button>
      <div className='h-5 w-px bg-muted' />
      <Button
        type='button'
        variant='ghost'
        className={cn(TOOLBAR_BUTTON)}
        onClick={() => editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, 'h2')}
      >
        H2
      </Button>
      <Button
        type='button'
        variant='ghost'
        className={cn(TOOLBAR_BUTTON)}
        onClick={() => editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, 'h3')}
      >
        H3
      </Button>
      <div className='h-5 w-px bg-muted' />
      <Button
        type='button'
        variant='ghost'
        className={cn(TOOLBAR_BUTTON)}
        onClick={() => editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined)}
      >
        • List
      </Button>
      <Button
        type='button'
        variant='ghost'
        className={cn(TOOLBAR_BUTTON)}
        onClick={() => editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined)}
      >
        1. List
      </Button>
      <Button
        type='button'
        variant='ghost'
        className={cn(TOOLBAR_BUTTON)}
        onClick={() => editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined)}
      >
        Clear List
      </Button>
      <div className='h-5 w-px bg-muted' />
      <Button type='button' variant='ghost' className={cn(TOOLBAR_BUTTON)} onClick={insertLink}>
        Link
      </Button>
    </div>
  );
}
