# Extensions and reading appearance

Helious API 1 extensions are **declarative editor commands**, available in the browser and native 0.9 apps. They do not load JavaScript, WebAssembly, native libraries or remote packages. This intentionally small sandbox has two permissions: `editor:read` for the current draft and `editor:write` for proposing a changed draft. There is no network, vault enumeration, filesystem, credential, secret resolution or background execution capability.

## Install and run

In a browser note expand **Extensions → Manage extensions**. On Windows/macOS open **Settings → Extensions**. Paste JSON or choose **Use example manifest**, review its permissions, check the explicit grant, then install. Replacing an installed ID requires a fresh review/grant. At most ten extensions are installed on a device/browser account. You can disable or remove them immediately.

Choose an **Extension command** in the editor and **Preview command**. Read the proposed Markdown, then **Apply proposal to draft**. Nothing is written until you use the ordinary Save control. If the note/draft changes during review, preview again. Read-only commands such as word count return a message without modifying the draft. Nothing runs on note open, sync or startup.

Grants are local preferences, not server agent tokens. Browser installations belong to the signed-in account in that browser; native installations belong to that desktop profile/device. Sync does not install extensions. Source text is visible to a granted command, including literal secret-reference placeholders, but actual server secret values are never resolved. Export only manifests you intend to share; a manifest can itself contain text you entered.

## API 1 manifest

```json
{
  "api": 1,
  "id": "project-tools",
  "name": "Project tools",
  "version": "1.0.0",
  "permissions": ["editor:read", "editor:write"],
  "commands": [
    {
      "id": "checklist",
      "name": "Append review checklist",
      "steps": [{ "op": "append", "text": "\n\n- [ ] Review decisions\n- [ ] Update runbook\n" }]
    }
  ]
}
```

See the complete [meeting-tools example](https://github.com/RavoxX/helious-apps/blob/main/packages/core/examples/meeting-tools.json) and [shared browser/native contract fixtures](https://github.com/RavoxX/helious-apps/blob/main/packages/core/examples/extension-contract.json).

| Operation           | Fields         | Behavior                                                                      |
| ------------------- | -------------- | ----------------------------------------------------------------------------- |
| `append`, `prepend` | `text`         | Add literal template-expanded text                                            |
| `replace`           | `find`, `text` | Replace a nonempty literal, at most 1,000 matches; no regex                   |
| `setProperty`       | `key`, `value` | Set a JSON-compatible typed YAML property through the guarded property editor |
| `countWords`        | none           | Count whitespace-separated draft words                                        |

Editing operations require `editor:write`; every manifest requires `editor:read`. Template variables use the current file title and local clock, as described in [authoring](./authoring). Unknown variables remain literal. No code is evaluated. Malformed YAML prevents property edits instead of discarding unfamiliar data.

Unknown fields/operations/permissions are rejected. IDs use lowercase letters, digits and hyphens, start with a letter and are at most 64 characters. A manifest is at most 64 KiB, with 1–20 commands and 1–20 steps per command. Step text is limited to 20,000, replacement literals to 1,000 and draft/output to 1,000,000 (native limits use UTF-8 bytes). No loops, recursion, regular expressions or external resources are available. An extension requiring capabilities outside this API cannot be installed; there is no unsafe override.

## Browser reading CSS snippets

Expand **Reading appearance** in the workspace sidebar. Save a snippet such as:

```css
.markdown-reading h1 {
  color: #2878ba;
  font-size: 32px;
}
.markdown-reading p {
  line-height: 1.8;
}
```

Snippets are local to the account/browser and apply to Reading/Live preview content in both panes. **Reset reading appearance** removes them. Invalid stored values are ignored. They cannot style the account screen, editor controls or other UI.

This is a small CSS dialect: selectors begin with `.markdown-reading` and use up to four ordinary content elements (`h1`–`h6`, paragraphs, links, lists, tables, code, quotes, emphasis and rules). Supported properties are color/background-color, font size/weight/style/family, line height, letter/word spacing, text alignment/decoration/transform, border color/radius, padding and block margin. Values are simple bounded literals. Imports, at-rules, pseudo/attribute selectors, comments, escapes, CSS variables, resource URLs, arbitrary functions and positioning are refused. Limits: 16 KiB, 40 rules, 24 declarations per rule. Native apps use their own theme/text-size/wrap settings rather than CSS.
