//! Focused domain state structures for the Windows native workspace.
use serde_json::Value;
use std::collections::BTreeSet;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OpenTab {
    pub id: String,
    pub path: String,
    pub title: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum SearchMode {
    #[default]
    Filter,
    FullText,
}

#[derive(Default)]
pub struct ExplorerState {
    pub mode: SearchMode,
    pub space_filter: String,
    pub collapsed_folders: BTreeSet<String>,
    pub search_results: Vec<Value>,
    pub searched_query: String,
    pub searching: bool,
}

#[derive(Default)]
pub struct EditorToolsState {
    pub find_open: bool,
    pub find_query: String,
    pub replace_text: String,
    pub rename_open: bool,
    pub rename_path: String,
    pub link_picker_open: bool,
    pub link_filter: String,
    pub focus_editor: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum InspectorTab {
    #[default]
    Context,
    Properties,
    Extensions,
    History,
}

#[derive(Default)]
pub struct InspectorState {
    pub tab: InspectorTab,
    pub context: Value,
    pub context_note_id: String,
}

#[derive(Default)]
pub struct PaletteState {
    pub open: bool,
    pub just_opened: bool,
    pub query: String,
    pub selected: usize,
}

#[derive(Default)]
pub struct ThemeCache {
    pub applied_pref: String,
    pub applied_dark: Option<bool>,
}

/// Hierarchical folder tree built from flat `/` vault note paths.
#[derive(Default)]
pub struct FolderNode {
    pub name: String,
    pub full_path: String,
    pub children: Vec<FolderNode>,
    pub notes: Vec<Value>,
}

impl FolderNode {
    pub fn build(notes: &[Value]) -> Self {
        let mut root = FolderNode::default();
        let mut sorted = notes.to_vec();
        sorted.sort_by(|a, b| {
            let pa = a["path"].as_str().unwrap_or("");
            let pb = b["path"].as_str().unwrap_or("");
            pa.to_lowercase().cmp(&pb.to_lowercase())
        });
        for note in sorted {
            let path = note["path"].as_str().unwrap_or("").to_string();
            let parts: Vec<&str> = path.split('/').collect();
            if parts.len() <= 1 {
                root.notes.push(note);
            } else {
                root.insert(&parts[..parts.len() - 1], "", note);
            }
        }
        root
    }

    fn insert(&mut self, folders: &[&str], prefix: &str, note: Value) {
        let head = folders[0];
        let next_path = if prefix.is_empty() {
            head.to_string()
        } else {
            format!("{prefix}/{head}")
        };
        let pos = self
            .children
            .iter()
            .position(|c| c.name.eq_ignore_ascii_case(head));
        let child = match pos {
            Some(idx) => &mut self.children[idx],
            None => {
                self.children.push(FolderNode {
                    name: head.to_string(),
                    full_path: next_path.clone(),
                    children: Vec::new(),
                    notes: Vec::new(),
                });
                self.children.last_mut().expect("inserted folder")
            }
        };
        if folders.len() == 1 {
            child.notes.push(note);
        } else {
            child.insert(&folders[1..], &next_path, note);
        }
    }

    pub fn total_notes(&self) -> usize {
        self.notes.len() + self.children.iter().map(Self::total_notes).sum::<usize>()
    }
}
