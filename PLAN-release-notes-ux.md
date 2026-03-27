# Release Notes — Implementation-Ready UX Architecture

> Stack: Next.js 14 App Router · Tailwind CSS · Radix UI · Lexical (already installed) · lucide-react
> New dependency required: `@dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities`

---

## 1. Route Architecture

```
/release-notes                →  ReleaseNoteListPage
/release-notes/[id]           →  ReleaseNoteEditorPage
```

No `/new` route. Creation is a quick-create Sheet triggered from the list page.
After creation the user lands directly on the editor page.

---

## 2. New Dependencies

```bash
npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

Additional Radix primitives needed (add to existing UI component set):
- `@radix-ui/react-select`      → type picker dropdown
- `@radix-ui/react-popover`     → user picker for co-authors/approver
- `@radix-ui/react-tooltip`     → icon tooltips
- `@radix-ui/react-separator`   → section dividers
- `@radix-ui/react-avatar`      → author avatar stack
- `sonner`                      → undo toast (replaces any custom toast)

---

## 3. Item Type System

Central config — single source of truth used across all components:

```typescript
// lib/release-note-types.ts

export const ITEM_TYPES = [
  { value: 'feature',         label: 'Feature',         color: 'blue',   icon: 'Sparkles'    },
  { value: 'bug_fix',         label: 'Bug Fix',          color: 'amber',  icon: 'Bug'         },
  { value: 'security',        label: 'Security',         color: 'red',    icon: 'ShieldAlert' },
  { value: 'api_change',      label: 'API Change',       color: 'purple', icon: 'Webhook'     },
  { value: 'breaking_change', label: 'Breaking Change',  color: 'rose',   icon: 'AlertTriangle'},
  { value: 'config_change',   label: 'Config Change',    color: 'slate',  icon: 'Settings2'   },
] as const

export type ItemType = typeof ITEM_TYPES[number]['value']

// Tailwind color maps (must use full class strings — no dynamic construction)
export const TYPE_STYLES: Record<ItemType, { badge: string; border: string; bg: string }> = {
  feature:         { badge: 'bg-blue-100 text-blue-700',   border: 'border-l-blue-400',   bg: 'bg-blue-50/40'  },
  bug_fix:         { badge: 'bg-amber-100 text-amber-700', border: 'border-l-amber-400',  bg: 'bg-amber-50/40' },
  security:        { badge: 'bg-red-100 text-red-700',     border: 'border-l-red-400',    bg: 'bg-red-50/40'   },
  api_change:      { badge: 'bg-purple-100 text-purple-700',border: 'border-l-purple-400',bg: 'bg-purple-50/40'},
  breaking_change: { badge: 'bg-rose-100 text-rose-700',   border: 'border-l-rose-400',   bg: 'bg-rose-50/40'  },
  config_change:   { badge: 'bg-slate-100 text-slate-600', border: 'border-l-slate-300',  bg: 'bg-slate-50/40' },
}
```

---

## 4. List Page — `app/(app)/release-notes/page.tsx`

### Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  Release Notes                              [+ New Release Note] │
├──────────────────────────────────────────────────────────────────┤
│  [All] [Service] [Config]    [● Draft ×][Published][Approved]    │
│  ──────────────────────────────────────────  [🔍 Search...    ] │
├──────────────────────────────────────────────────────────────────┤
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  SERVICE  Open Banking Gateway · main · 2.4.1             │  │
│  │  ● Draft · 👤 Viktor  👤 Anna · 6 items · 2h ago          │  │
│  └────────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  CONFIG   ob-config · pl_pko · pl_pko_1.3.2               │  │
│  │  ✓ Published · 👤 Marek · 3 items · Yesterday             │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

### Component Breakdown

```
ReleaseNoteListPage
├── PageHeader
│   ├── Title ("Release Notes")
│   └── NewReleaseNoteButton → opens NewReleaseNoteSheet
│
├── FilterBar
│   ├── ComponentTypeToggle   — segmented control: All / Service / Config
│   ├── StatusFilterChips     — clickable chips (multi-select): Draft · Published · Approved
│   └── SearchInput           — debounced 300ms, searches repo + service_name + tag
│
├── ReleaseNoteList
│   ├── ReleaseNoteCard × N   — clickable row, navigates to /release-notes/[id]
│   │   ├── ComponentTypeBadge  ("SERVICE" / "CONFIG") — colored
│   │   ├── ServiceName         — bold
│   │   ├── BranchChip          — only shown for CONFIG type (e.g. "pl_pko")
│   │   ├── TagBadge            — monospace, muted
│   │   ├── StatusDot           — ● Draft / ✓ Published / ✓✓ Approved
│   │   ├── AuthorAvatarStack   — up to 3 avatars + overflow count
│   │   ├── ItemCountBadge      — "6 items"
│   │   └── RelativeTime        — "2h ago"
│   │
│   ├── EmptyState              — when no items match filter
│   ├── LoadingSkeleton × 4    — card-shaped skeletons
│   └── ErrorState              — with retry button
│
└── NewReleaseNoteSheet         — Radix Sheet (right side, 400px wide)
    ├── SheetHeader ("New Release Note")
    ├── RepoSelector            — Combobox: known repos from existing WO services
    ├── BranchField             — appears if CONFIG repo detected
    │   └── BranchSelector      — dropdown of known branches or free text
    ├── TagInput                — text input, format hint shown below
    ├── ServiceNameInput        — optional display name, auto-filled from repo
    ├── ValidationErrors
    └── CreateButton            — "Create & Edit" → POST /release-notes → navigate to [id]
```

### Empty State

```
┌───────────────────────────────────────────────────────┐
│                                                       │
│              📝  No release notes yet                 │
│                                                       │
│   Document changes per service or bank configuration  │
│   so they can be aggregated into release plans.       │
│                                                       │
│              [+ New Release Note]                     │
│                                                       │
└───────────────────────────────────────────────────────┘
```

---

## 5. Editor Page — `app/(app)/release-notes/[id]/page.tsx`

### Overall Layout

```
┌─────────────────────────────────────────────── FIXED HEADER (72px) ──┐
│  ← Release Notes  ›  Open Banking Gateway  ›  2.4.1                  │
│                                                                        │
│  [SERVICE] Open Banking Gateway        [main]  [2.4.1]   ● Draft      │
│  👤 Viktor  👤 Anna  [+ Author]                  ● Saved 2m ago  [Publish] │
└────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────── SCROLLABLE CONTENT ────────┐
│                                                                        │
│  ┌─ FEATURES ──────────────────────────────────────────── 3  [+] ──┐  │
│  │  ⠿  Feature  New consent API endpoint               🔗  ···    │  │
│  │     Two new endpoints: POST /consents and GET…                   │  │
│  │                                                                   │  │
│  │  ⠿  Feature  Multi-currency transaction support        ···      │  │
│  │     EUR, GBP, USD support for payment initiation…                │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                        │
│  ┌─ BUG FIXES ─────────────────────────────────────────── 1  [+] ──┐  │
│  │  ⠿  Bug Fix  Fixed timeout in consent polling          ···      │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                        │
│  ┌─ SECURITY ──────────────────────────────────────────── 0  [+] ──┐  │
│  │  ╌╌╌ No security items — click + to add ╌╌╌                     │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│  ... (remaining 3 sections)                                            │
└────────────────────────────────────────────────────────────────────────┘
```

### Fixed Header Component — `ReleaseNoteEditorHeader`

```
Row 1: Breadcrumb
  ← Release Notes  ›  {service_name}  ›  {tag}

Row 2: Identity + Status + Actions
  [ComponentTypeBadge] {service_name}    [BranchChip?]  [TagBadge]  [StatusPill]
  [AuthorAvatarStack] [AddAuthorButton]     [AutosaveIndicator]  [PrimaryActionButton]
```

**PrimaryActionButton** (context-driven, single prominent button — no menu):
- `status = draft`      → "Publish"        (only enabled if ≥ 1 item exists)
- `status = published`  → "Request Approval" → opens ApproverPickerPopover
- `status = approved`   → "✓ Approved by {name}" (read-only chip, no button)
- `canWrite = false`    → button hidden entirely

**AutosaveIndicator** (replaces traditional save button):
```
idle:    (nothing shown)
saving:  ○ Saving...     (animated pulse dot)
saved:   ● Saved 2m ago  (green dot, relative time)
error:   ✕ Save failed [Retry]  (red, clickable)
```

**ApproverPickerPopover** (triggered by "Request Approval"):
- Single user picker (search users by name)
- Confirm sends PATCH with `approved_by = userId`, `status = 'approved'`
- In future: could send a notification — keep the PATCH as the only action for now

---

## 6. Section Architecture — `ReleaseNoteSection`

One section per `ItemType` — **all 6 always rendered**, even if empty.
Sections are NOT collapsible — they are always open for fast scanning.

### Section Header (sticky while scrolling content)

```
position: sticky
top: 72px  ← header height
z-index: 10
background: white (or bg-background)

┌──────────────────────────────────────────────────────────────────┐
│ ████ FEATURES  ·  3 items                                   [+]  │
└──────────────────────────────────────────────────────────────────┘
```

- `████` = 4px colored left border accent (matches type color)
- Label is UPPERCASE, semibold, 12px tracking-wider — not a heading hierarchy, a label
- Item count: muted text, updates in real time
- `[+]` button: icon-only, tooltip "Add Feature", triggers inline AddItemRow at bottom of this section

### Section Empty State (inline, within section)

```
┌──────────────────────────────────────────────────────────────────┐
│ ████ SECURITY  ·  0 items                                   [+]  │
│                                                                  │
│   ╌╌ No security items. Click + to add. ╌╌                      │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

Dashed border text row — 36px height, muted — not a full empty state component.

---

## 7. Item Row — States and Transitions

### State: Collapsed (default)

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                              HOVER  │
│  ⠿  Feature  New Open Banking consent API endpoint    🔗   ···     │
│               Two new endpoints: POST /consents and…               │
└─────────────────────────────────────────────────────────────────────┘
```

- `⠿` DragHandle: hidden when not hovering the row. 24x24px, cursor: grab
- Type chip: colored badge, 60px min-width, always visible
- Title: truncated to 1 line, font-medium
- Description preview: truncated to 1 line, text-sm text-muted-foreground
- `🔗` MigrationStepIcon: `Link2` icon, 14px, shown only if `migration_step` is set. Tooltip: "Has deployment step"
- `···` MoreMenu: `MoreHorizontal` icon, hidden until hover. Opens dropdown: Delete only.
- **Entire row is clickable** → transitions to Expanded state

### State: Expanded (editing)

Triggered by single click anywhere on a collapsed row.
Only one item expanded at a time — clicking another row collapses the current.

```
┌─────────────────────────────────────────────────────────────────────┐
│  ⠿  [Feature ▾]                                               [×]  │
│  ───────────────────────────────────────────────────────────────── │
│                                                                     │
│  Title *                                                            │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ New Open Banking consent API endpoint                         │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  Description                                                        │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ Two new endpoints: POST /consents and GET /consents/{id}      │ │
│  │ for PSD2 compliant consent management.                        │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  Deployment Step                             [toggle: ON  ○──●]   │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ kubectl rollout restart deployment/ob-gateway -n production   │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  [🗑 Delete]                                          ● Saved      │
└─────────────────────────────────────────────────────────────────────┘
```

**[Feature ▾]** — Radix Select dropdown, inline. Changing type:
  1. Updates item's `item_type`
  2. Immediately triggers PATCH (autosave)
  3. Item visually moves to the correct section via animation (150ms slide out / in)
  4. No page scroll jump — smooth transition

**[×]** — collapses item without saving pending changes (changes are already autosaved on blur)

**Deployment Step toggle**:
  - Default OFF if `migration_step` is null/empty
  - Toggle ON → textarea appears with 120ms ease transition
  - Toggle OFF → textarea hides, `migration_step` set to null on next autosave

**Autosave triggers in expanded state**:
  - `onBlur` from Title input → PATCH `title`
  - `onBlur` from Description textarea → PATCH `description`
  - `onBlur` from Deployment Step textarea → PATCH `migration_step`
  - `onChange` on Type select → immediate PATCH `item_type`
  - `onChange` on Deployment Step toggle → immediate PATCH `migration_step: null`

Textarea auto-resizes height to content (no scrollbars).

### State: Add Item Row (inline, at bottom of section)

Triggered by clicking `[+]` in the section header. 
Collapses any currently expanded item first.

```
┌─────────────────────────────────────────────────────────────────────┐
│  ○  [Feature]                                                       │
│  ───────────────────────────────────────────────────────────────── │
│                                                                     │
│  Title *                                            [Ctrl+Enter ✓] │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ |  ← cursor here, auto-focused                                │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  Description                                (optional)             │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │                                                               │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  [+ Add deployment step]                                            │
│                                                                     │
│  [Cancel]                                                    [Add]  │
└─────────────────────────────────────────────────────────────────────┘
```

- The `○` placeholder is where the drag handle would be — not draggable until saved
- Type chip pre-set to the section's type (not changeable in add flow — change after via chip)
- Title field: auto-focused, pressing `Escape` → Cancel, pressing `Ctrl+Enter` → Add
- "Add deployment step" link → inline toggle, reveals textarea
- **[Cancel]**: discards, removes AddItemRow
- **[Add]**: validates title is non-empty → POST `/release-notes/{id}/items` → item appears at bottom of section, AddItemRow remains for fast consecutive adds
- After successful add, the AddItemRow stays open (clears and refocuses) so the user can add another item without clicking `+` again

### State: Deleted (undo window)

```
[Undo Toast — bottom center, 5 seconds]
┌──────────────────────────────────────────┐
│  Item deleted.             [Undo]   ×   │
└──────────────────────────────────────────┘
```

- Item is immediately removed from DOM (optimistic)
- API DELETE is NOT called until toast expires or is dismissed
- Clicking [Undo]: item reappears in its original position + order_index, toast dismissed
- Using `sonner` toast library: `toast('Item deleted', { action: { label: 'Undo', onClick: restore } })`

---

## 8. Drag and Drop

**Library**: `@dnd-kit/sortable`

**Scope**: Within-section reordering only. Items do NOT drag between sections.
To change type: use the Type chip dropdown in the expanded state.

**Implementation pattern**:

```tsx
// One DndContext + SortableContext per section
<DndContext onDragEnd={handleDragEnd} sensors={sensors} collisionDetection={closestCenter}>
  {ITEM_TYPES.map(type => (
    <ReleaseNoteSection key={type.value} type={type}>
      <SortableContext items={itemsOfType(type.value)} strategy={verticalListSortingStrategy}>
        {itemsOfType(type.value).map(item => (
          <SortableItem key={item.id} item={item} />
        ))}
      </SortableContext>
    </ReleaseNoteSection>
  ))}
</DndContext>
```

**handleDragEnd**:
1. Compute new `order_index` values for affected items
2. Optimistically update local state
3. PATCH `/release-notes/{rn_id}/items/reorder` with `{ items: [{id, order_index}] }` (batch update)
4. On error: revert local state, show error toast

**Drag UX**:
- Drag handle appears on row hover: `GripVertical` icon, 16px, `text-muted-foreground/40`
- Cursor: `grab` on handle, `grabbing` while dragging
- Dragging item: 90% opacity, slight scale (1.02), elevated shadow
- Drop target placeholder: dashed border row at insertion point
- Expanded item: cannot be dragged — collapse first (drag handle hidden when expanded)

**Sensors**: pointer sensor with 8px activation constraint (prevents accidental drags on click):
```tsx
const sensors = useSensors(
  useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
)
```

---

## 9. Page-Level State Model

```typescript
// State shape (can be React useState or a lightweight store)

type EditorState = {
  // Server data
  releaseNote: ReleaseNote | null
  items: ReleaseNoteItem[]

  // UI state
  saveState: 'idle' | 'saving' | 'saved' | 'error'
  lastSavedAt: Date | null
  expandedItemId: string | null
  addingToSection: ItemType | null

  // Pending delete (undo window)
  pendingDelete: {
    item: ReleaseNoteItem
    originalIndex: number
    timeoutId: ReturnType<typeof setTimeout>
  } | null
}
```

**Key state rules**:
- `expandedItemId` and `addingToSection` are mutually exclusive — only one interaction at a time
- Setting `addingToSection` collapses `expandedItemId` and vice versa
- `pendingDelete` blocks a second delete until the first is resolved

---

## 10. Autosave Architecture

```typescript
// hooks/useReleaseNoteAutosave.ts

const saveField = async (itemId: string, field: string, value: string | null) => {
  setSaveState('saving')
  try {
    await api.patch(`/release-notes/${rnId}/items/${itemId}`, { [field]: value }, accessToken)
    setSaveState('saved')
    setLastSavedAt(new Date())
  } catch {
    setSaveState('error')
    // Revert optimistic state
  }
}

// Used via onBlur on each field:
// <input onBlur={(e) => saveField(item.id, 'title', e.target.value)} />
```

No debounce needed — saving on blur is the right trigger.
Do NOT save on every keystroke.
Do NOT show a "Save" button in the editor — autosave replaces it entirely.

---

## 11. Full Component File Structure

```
frontend/
├── app/(app)/release-notes/
│   ├── page.tsx                          ← List page
│   └── [id]/
│       └── page.tsx                      ← Editor page
│
├── components/release-notes/
│   ├── release-note-list.tsx             ← Card list + skeleton + empty
│   ├── release-note-card.tsx             ← Single list card
│   ├── new-release-note-sheet.tsx        ← Creation sheet
│   ├── release-note-editor-header.tsx    ← Fixed header (breadcrumb + meta + actions)
│   ├── release-note-section.tsx          ← Section with sticky header
│   ├── release-note-item-row.tsx         ← Collapsed + Expanded state (one component, two views)
│   ├── release-note-add-item-row.tsx     ← Inline add form
│   ├── author-avatar-stack.tsx           ← Avatar cluster with add button
│   ├── approver-picker-popover.tsx       ← User search + select for approval
│   ├── autosave-indicator.tsx            ← Save state display
│   ├── item-type-badge.tsx               ← Colored badge (reused in list + editor)
│   └── item-type-select.tsx              ← Radix Select for type change
│
└── lib/
    └── release-note-types.ts             ← ITEM_TYPES config (Section 3 above)
```

---

## 12. Component Props Contracts (Implementation-Ready)

```typescript
// release-note-section.tsx
type ReleaseNoteSectionProps = {
  type: typeof ITEM_TYPES[number]
  items: ReleaseNoteItem[]
  expandedItemId: string | null
  addingToThisSection: boolean
  canWrite: boolean
  onItemExpand: (id: string) => void
  onItemCollapse: () => void
  onAddStart: () => void
  onAddCancel: () => void
  onAddConfirm: (data: NewItemData) => Promise<void>
  onItemChange: (id: string, field: string, value: string | null) => Promise<void>
  onItemDelete: (id: string) => void
  onReorder: (items: ReleaseNoteItem[]) => Promise<void>
}

// release-note-item-row.tsx
type ReleaseNoteItemRowProps = {
  item: ReleaseNoteItem
  isExpanded: boolean
  canWrite: boolean
  isDragging?: boolean
  dragHandleProps?: DraggableAttributes & SyntheticListenerMap
  onExpand: () => void
  onCollapse: () => void
  onFieldSave: (field: string, value: string | null) => Promise<void>
  onTypeChange: (type: ItemType) => Promise<void>
  onDelete: () => void
}

// release-note-add-item-row.tsx
type AddItemRowProps = {
  sectionType: ItemType
  onConfirm: (data: { title: string; description?: string; migration_step?: string }) => Promise<void>
  onCancel: () => void
}

// autosave-indicator.tsx
type AutosaveIndicatorProps = {
  state: 'idle' | 'saving' | 'saved' | 'error'
  lastSavedAt: Date | null
  onRetry: () => void
}

// author-avatar-stack.tsx
type AuthorAvatarStackProps = {
  authors: User[]
  canWrite: boolean
  onAddAuthor: (userId: string) => Promise<void>
  maxVisible?: number  // default 3
}
```

---

## 13. All Page States

### List Page

| State | What is shown |
|---|---|
| Loading | 4 skeleton cards (gray animated bars, same dimensions as real cards) |
| Empty (no data) | Illustration + text + "New Release Note" CTA button |
| Empty (filtered) | "No results for your filters" + "Clear filters" link |
| Error | Alert banner: "Failed to load release notes" + [Retry] button |
| Success | Card list |

### Editor Page

| State | What is shown |
|---|---|
| Loading header | Skeleton: breadcrumb bar + identity row + action button outline |
| Loading items | Per-section skeletons: 1–2 skeleton rows each (reveals sections in order) |
| Error loading | Full page error with back link |
| No permission | "You don't have access to edit this release note." |
| Empty section | Dashed "No items — click + to add" row (not a full empty state) |
| All sections empty | No special state — sections show their individual empty rows |
| Saving | AutosaveIndicator: "○ Saving..." pulse |
| Saved | AutosaveIndicator: "● Saved 2m ago" (green dot) |
| Save error | AutosaveIndicator: "✕ Save failed [Retry]" (red) |
| Approved | PrimaryActionButton replaced by "✓ Approved by {name}" green chip |
| canWrite=false | All interactive elements hidden. Description/title shown as read-only text. |

---

## 14. Interaction Flow Summary

### Flow: Add item to a section
1. User clicks `[+]` in section header
2. Any expanded item collapses (autosaves on collapse via blur)
3. `AddItemRow` appears at bottom of section with title input focused
4. User types title (required), optionally description + deployment step
5. Clicks `[Add]` or presses `Ctrl+Enter`
6. Optimistic: item appears immediately, `AddItemRow` clears and stays for next add
7. API: POST → server assigns `id` and `order_index`
8. On error: item removed, error toast, `AddItemRow` pre-filled with attempted data
9. User clicks `[Cancel]` or presses `Escape` to dismiss `AddItemRow`

### Flow: Edit an item
1. User clicks anywhere on a collapsed item row
2. Row transitions to expanded view (150ms ease) — fills content in-place
3. User edits title / description / deployment step / type
4. On blur from any field → autosave fires immediately
5. User clicks `[×]` or clicks another row → collapses
6. No explicit save needed. `AutosaveIndicator` confirms state.

### Flow: Change item type
1. In expanded state, user clicks the type chip `[Feature ▾]`
2. Radix Select dropdown opens (6 options with colored dots)
3. User selects new type
4. Item immediately PATCHes `item_type`
5. After 150ms: item slides out of current section, slides into correct section
6. New section scrolls into view if off-screen

### Flow: Reorder items within section
1. User hovers over item → drag handle appears (left side)
2. User grabs handle, drags up/down
3. Placeholder shows insertion point
4. User releases → order updates locally, PATCH fires
5. On error: order reverts, toast shown

### Flow: Delete item
1. User hovers item → `···` icon appears
2. Clicks `···` → dropdown: single option "Delete"
3. OR in expanded state: clicks `[🗑 Delete]` button
4. Item immediately removed from view
5. `sonner` toast appears: "Item deleted [Undo]" — 5 second auto-dismiss
6. If `[Undo]` clicked: item restored to original position, no API call made
7. If toast auto-dismisses: API DELETE fires
8. On API error: item reappears, error toast

### Flow: Publish
1. User clicks `[Publish]` in header (only enabled if ≥ 1 item exists)
2. PATCH `status = 'published'`
3. StatusPill updates to "✓ Published"
4. Button changes to "Request Approval"

### Flow: Request Approval
1. User clicks "Request Approval" in header
2. `ApproverPickerPopover` opens (inline below button)
3. User searches + selects a user
4. Clicks "Send Request"
5. PATCH `approved_by = userId`, `status = 'approved'`
6. StatusPill updates to "✓✓ Approved"
7. PrimaryActionButton replaced by "✓ Approved by {name}" chip

---

## 15. Key UX Decisions (with rationale)

| Decision | Rationale |
|---|---|
| Autosave on blur, not on keypress | Saves on every keystroke floods the API; blur is the natural "I'm done" signal |
| One item expanded at a time | Prevents cognitive overload; clicking another row naturally collapses current |
| AddItemRow stays open after add | Users rarely add just one item — keeping it open removes friction for consecutive adds |
| No modal for editing | Modals hide context; inline expansion keeps the full list visible while editing |
| Type change moves item to new section | The section grouping is the primary visual — an item must live in the right section |
| DnD within section only | Cross-section drag changes semantic meaning (type); type chip is clearer for this |
| Always show all 6 sections | Users need to see the full taxonomy to know where to add; empty sections act as prompts |
| Undo instead of confirm-delete | Confirm dialogs add friction; undo is faster and equally safe for reversible operations |
| Status progression is linear, one button | Reduces decision paralysis; one obvious next action at each status |
| Branch chip only shown for CONFIG | Services always use main; showing branch only for config reduces noise |
| Deployment step is optional + hidden by default | Most items won't have it; reveal-on-demand keeps the form clean |

---

## 16. Accessibility Notes

- All interactive elements have ARIA labels
- DnD is keyboard-accessible via @dnd-kit built-in keyboard sensor (arrow keys to move, Space to drop)
- Type Select is fully keyboard-navigable (Radix handles this)
- Escape closes expanded item / cancels add row
- Toast (sonner) is announced via aria-live region
- Color is never the only differentiator — each type has both color AND an icon
- Status is conveyed via text, not just color or icon
