# Daily notes, templates and properties

These tools are available in the **browser workspace for server vaults**. The native v0.8.1 interfaces do not yet expose these controls. Markdown files remain ordinary notes, so native clients and other editors can still read and edit their source.

## Daily notes

Open **Vaults → Daily notes & templates**. Choose a calendar date and select **Open daily note**. This opens or creates `Daily/YYYY-MM-DD.md`; opening it again never overwrites its content. New notes use the selected Space, or Personal when the filter is All spaces. If that path already belongs to another Space, select that Space before opening it. Paths are unique across the vault.

The built-in daily template contains Notes and Tasks headings. Choose a Markdown template to use a different structure for newly created daily notes. Changing templates does not rewrite existing days.

## Templates

Choose **Create template** to create an ordinary `.md` note under `Templates/`. Edit and save it using the normal editor. Then choose it in the Template selector, enter a destination path and select **Create from template**. Existing paths are refused; no note is silently replaced.

| Variable                        | Value                                                          |
| ------------------------------- | -------------------------------------------------------------- |
| <code v-pre>{{title}}</code>    | Destination file name without `.md`                            |
| <code v-pre>{{date}}</code>     | Chosen daily-note date, otherwise today's local calendar date  |
| <code v-pre>{{time}}</code>     | Actual creation time in the browser's local time zone, `HH:mm` |
| <code v-pre>{{datetime}}</code> | Actual creation instant as a UTC ISO timestamp                 |
| <code v-pre>{{cursor}}</code>   | Removed; no cursor placement is performed                      |

Substitution is literal, runs once and never evaluates code. Unknown variables and <code v-pre>{{secret:...}}</code> references stay untouched. The expanded note must fit the existing 1,000,000-character Markdown limit. Template discovery is bounded to 10,000 notes within the Templates folder; use the explorer for larger collections.

Templates may come from another Space you own. Their Space is labelled in the selector. Copying a Personal template into Code shares that copied content under Code's permissions; check its contents before choosing that destination.

## Typed properties

Expand **Properties** inside a note's Source or Live preview editor. Add, edit or remove values, then choose **Save note** to persist the change with the note's normal revision/history checks. Applying a property only updates the unsaved draft.

Supported controls are text, finite number, boolean, calendar date, one-string-per-line list, null and advanced JSON for nested arrays/objects. Dates remain ISO strings. Existing structured values open as JSON to preserve their types. Property names are limited to 100 characters; reserved prototype names, cycles, excessive nesting and oversized frontmatter are refused.

Unchanged YAML nodes and comments are retained. The Markdown body is preserved byte-for-byte as a JavaScript string, including its line endings. Malformed YAML, custom tags, anchors and aliases must be edited in Source mode; the property tool refuses a potentially lossy rewrite. New frontmatter uses LF; edits to existing CRLF frontmatter keep CRLF.

Draft content stays in this browser tab's memory. Save before reloading or closing the page; it is not crash recovery.
