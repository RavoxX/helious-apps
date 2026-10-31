use base64::{engine::general_purpose::STANDARD, Engine};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashSet},
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
};
use unicode_normalization::UnicodeNormalization;

pub type Result<T> = std::result::Result<T, String>;
pub fn id() -> String {
    uuid::Uuid::new_v4().simple().to_string()[..24].to_string()
}
pub fn valid_id(value: &str) -> bool {
    value.len() == 24 && value.bytes().all(|b| b.is_ascii_hexdigit())
}
pub fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
pub fn now() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
pub const FILE_LIMIT: u64 = 20 * 1024 * 1024;
// Enumeration and every non-internal filesystem operation share this boundary.
// Remote sync must not create files that subsequent scans cannot see.
pub fn excluded_component(name: &str) -> bool {
    name.starts_with('.')
        || name.eq_ignore_ascii_case("node_modules")
        || name.eq_ignore_ascii_case("target")
}
pub fn logical(value: &str) -> Result<String> {
    let value: String = value.nfc().collect();
    if value.is_empty()
        || value.len() > 4096
        || value
            .chars()
            .any(|c| c.is_control() || "\\<>:\"|?*".contains(c))
    {
        return Err("Use a portable relative vault path.".into());
    }
    let parts: Vec<_> = value.split('/').collect();
    if parts.len() > 32
        || parts.iter().any(|p| {
            p.is_empty() || *p == "." || *p == ".." || p.len() > 255 || p.ends_with(['.', ' '])
        })
        || parts.iter().any(|p| excluded_component(p))
    {
        return Err("Invalid vault path.".into());
    }
    for part in &parts {
        let stem = part.split('.').next().unwrap_or("").to_ascii_lowercase();
        if ["con", "prn", "aux", "nul"].contains(&stem.as_str())
            || ((stem.starts_with("com") || stem.starts_with("lpt"))
                && stem.len() == 4
                && matches!(stem.as_bytes()[3], b'1'..=b'9'))
        {
            return Err("Reserved device path.".into());
        }
    }
    Ok(value)
}
fn linked(meta: &fs::Metadata) -> bool {
    if meta.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if meta.file_attributes() & 0x400 != 0 {
            return true;
        }
    }
    false
}
pub fn safe(root: &Path, relative: &str, internal: bool) -> Result<PathBuf> {
    if !internal {
        logical(relative)?;
    } else if !relative.starts_with(".helious/")
        || relative.split('/').any(|p| p == ".." || p.is_empty())
    {
        return Err("Invalid configuration path.".into());
    }
    let mut path = root.to_path_buf();
    for part in relative.split('/') {
        path.push(part);
        match fs::symlink_metadata(&path) {
            Ok(meta) if linked(&meta) => {
                return Err("Symbolic links and junctions are not followed.".into())
            }
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err("Cannot inspect vault path.".into()),
        }
    }
    Ok(path)
}
pub fn read(root: &Path, path: &str, internal: bool) -> Result<Option<Vec<u8>>> {
    let target = safe(root, path, internal)?;
    let limit = if internal {
        64 * 1024 * 1024
    } else {
        FILE_LIMIT
    };
    match File::open(&target) {
        Ok(file) => {
            if file.metadata().map_err(|_| "Cannot inspect file.")?.len() > limit {
                return Err("File exceeds the supported size.".into());
            }
            let mut bytes = Vec::new();
            file.take(limit + 1)
                .read_to_end(&mut bytes)
                .map_err(|_| "Cannot read vault file.")?;
            if bytes.len() as u64 > limit {
                return Err("File grew beyond the size limit.".into());
            }
            Ok(Some(bytes))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err("Cannot read vault file.".into()),
    }
}
pub fn atomic(root: &Path, path: &str, data: &[u8], internal: bool) -> Result<()> {
    let target = safe(root, path, internal)?;
    let parent = target.parent().ok_or("Missing parent folder.")?;
    // Inspect every component again after creating parents. No arbitrary frontend absolute paths.
    fs::create_dir_all(parent).map_err(|_| "Cannot create vault folder.")?;
    safe(root, path, internal)?;
    let mut file =
        tempfile::NamedTempFile::new_in(parent).map_err(|_| "Cannot stage vault file.")?;
    file.write_all(data)
        .map_err(|_| "Cannot stage vault contents.")?;
    file.as_file()
        .sync_all()
        .map_err(|_| "Cannot flush vault contents.")?;
    file.persist(&target)
        .map_err(|_| "Cannot replace vault file. It may be open in another application.")?;
    Ok(())
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Space {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub agent_access: String,
    pub revision: u64,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Record {
    pub id: String,
    pub path: String,
    pub hash: String,
    pub space_id: String,
    pub revision: u64,
    pub created_at: String,
    pub updated_at: String,
    pub kind: String,
    pub deleted: bool,
    pub size: u64,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub schema: u32,
    pub id: String,
    pub name: String,
    pub spaces: Vec<Space>,
    pub files: BTreeMap<String, Record>,
    #[serde(default)]
    pub sync: Value,
    #[serde(default)]
    pub activity: BTreeMap<String, BTreeMap<String, u64>>,
    #[serde(default)]
    pub activity_since: Option<String>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Operation {
    pub path: String,
    pub expected_hash: Option<String>,
    pub data: Option<String>,
    pub space_id: String,
    #[serde(default)]
    pub source_id: Option<String>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Version {
    #[serde(flatten)]
    record: Record,
    data: Option<String>,
    action: String,
    actor: Value,
    recorded_at: String,
}
struct CachedFile {
    modified: Option<std::time::SystemTime>,
    size: u64,
    path: String,
    hash: String,
    markdown: Option<String>,
}
pub struct Vault {
    pub root: PathBuf,
    pub config: Config,
    pub warnings: Vec<String>,
    cache: std::collections::HashMap<String, CachedFile>,
    pending_actions: std::collections::HashMap<String, &'static str>,
    _lock: File,
}
impl Vault {
    pub fn open(root: PathBuf) -> Result<Self> {
        let root = fs::canonicalize(root).map_err(|_| "Cannot open this folder.")?;
        if !root.is_dir() {
            return Err("Choose a folder.".into());
        }
        if let Ok(meta) = fs::symlink_metadata(root.join(".helious")) {
            if linked(&meta) {
                return Err(
                    "The .helious configuration folder cannot be a link or junction.".into(),
                );
            }
        }
        safe(&root, ".helious/lock", true)?;
        let is_new = read(&root, ".helious/vault.json", true)?.is_none();
        fs::create_dir_all(root.join(".helious"))
            .map_err(|_| "Cannot create vault configuration.")?;
        let lock = fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(false)
            .open(safe(&root, ".helious/lock", true)?)
            .map_err(|_| "Cannot open the vault lock.")?;
        fs2::FileExt::try_lock_exclusive(&lock)
            .map_err(|_| "This vault is already open in another Helious process.")?;
        let config = match read(&root, ".helious/vault.json", true)? {
            Some(bytes) => serde_json::from_slice::<Config>(&bytes).map_err(|_| {
                "Invalid vault configuration. Preserve .helious and restore it from backup."
            })?,
            None => Config {
                schema: 1,
                id: id(),
                name: root
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into(),
                spaces: vec![
                    Space {
                        id: id(),
                        name: "Personal".into(),
                        kind: "personal".into(),
                        agent_access: "none".into(),
                        revision: 1,
                    },
                    Space {
                        id: id(),
                        name: "Code".into(),
                        kind: "code".into(),
                        agent_access: "read-write".into(),
                        revision: 1,
                    },
                ],
                files: BTreeMap::new(),
                sync: Value::Null,
                activity: BTreeMap::new(),
                activity_since: None,
            },
        };
        if config.schema != 1
            || !valid_id(&config.id)
            || config.spaces.len() > 100
            || config.spaces.iter().any(|s| !valid_id(&s.id))
            || config.files.values().any(|f| {
                !valid_id(&f.id)
                    || logical(&f.path).is_err()
                    || !config.spaces.iter().any(|s| s.id == f.space_id)
            })
        {
            return Err("Unsupported or unsafe vault configuration.".into());
        }
        let mut vault = Self {
            root,
            config,
            warnings: vec![],
            cache: std::collections::HashMap::new(),
            pending_actions: std::collections::HashMap::new(),
            _lock: lock,
        };
        if is_new {
            vault.save()?;
        }
        vault.recover()?;
        vault.scan()?;
        Ok(vault)
    }
    pub fn save(&self) -> Result<()> {
        atomic(
            &self.root,
            ".helious/vault.json",
            &serde_json::to_vec(&self.config).map_err(|_| "Cannot encode vault settings.")?,
            true,
        )
    }
    fn version(&self, record: &Record, data: Option<&[u8]>, action: &str) -> Result<()> {
        let path = format!(".helious/history/{}/{}.json", record.id, record.revision);
        if read(&self.root, &path, true)?.is_some() {
            return Ok(());
        }
        let version = Version {
            record: record.clone(),
            data: if record.kind == "note" {
                data.map(|b| STANDARD.encode(b))
            } else {
                None
            },
            action: action.into(),
            actor: json!({"kind":"local","id":"this-device"}),
            recorded_at: record.updated_at.clone(),
        };
        atomic(
            &self.root,
            &path,
            &serde_json::to_vec(&version).map_err(|_| "Cannot encode history.")?,
            true,
        )
    }
    fn walk(
        &mut self,
        path: &Path,
        output: &mut Vec<(String, Option<std::time::SystemTime>, u64)>,
        depth: usize,
    ) -> Result<()> {
        if depth > 32 {
            return Ok(());
        }
        for entry in fs::read_dir(path).map_err(|_| "Cannot scan vault folder.")? {
            let entry = entry.map_err(|_| "Cannot inspect folder entry.")?;
            let name = entry.file_name().to_string_lossy().to_string();
            if excluded_component(&name) {
                continue;
            }
            let meta =
                fs::symlink_metadata(entry.path()).map_err(|_| "Cannot inspect folder entry.")?;
            if linked(&meta) {
                self.warnings.push(format!("Skipped link: {}", name));
                continue;
            }
            if meta.is_dir() {
                self.walk(&entry.path(), output, depth + 1)?
            } else if meta.is_file() {
                let relative = entry
                    .path()
                    .strip_prefix(&self.root)
                    .map_err(|_| "Path escaped vault.")?
                    .to_string_lossy()
                    .replace('\\', "/");
                if logical(&relative).is_err() || meta.len() > FILE_LIMIT {
                    self.warnings.push(format!(
                        "Skipped unsupported or oversized file: {}",
                        relative
                    ));
                    continue;
                }
                output.push((relative, meta.modified().ok(), meta.len()));
                if output.len() > 50000 {
                    return Err("Local vaults support up to 50,000 files.".into());
                }
            }
        }
        Ok(())
    }
    pub fn scan(&mut self) -> Result<Value> {
        self.warnings.clear();
        let mut entries = vec![];
        self.walk(&self.root.clone(), &mut entries, 0)?;
        entries.sort_by(|a, b| a.0.cmp(&b.0));
        let mut present = HashSet::new();
        let mut files = vec![];
        let mut bytes = 0usize;
        let mut dirty = false;
        let scan_started = std::time::SystemTime::now();
        let personal = self
            .config
            .spaces
            .iter()
            .find(|s| s.kind == "personal")
            .ok_or("Missing Personal Space.")?
            .id
            .clone();
        for (path, modified, disk_size) in entries {
            let key = path.to_lowercase();
            if !present.insert(key.clone()) {
                return Err(
                    "Two file paths differ only by case. Rename one before opening this vault."
                        .into(),
                );
            }
            let previous = self.config.files.get(&key).cloned();
            let note = path.to_ascii_lowercase().ends_with(".md");
            let cached_hit = match (&previous, self.cache.get(&key), modified) {
                (Some(prev), Some(cached), Some(mtime))
                    if !prev.deleted
                        && prev.path == path
                        && prev.hash == cached.hash
                        && cached.path == path
                        && cached.size == disk_size
                        && cached.modified == Some(mtime)
                        && scan_started
                            .duration_since(mtime)
                            .is_ok_and(|age| age.as_secs() >= 2) =>
                {
                    Some((cached.hash.clone(), cached.size, cached.markdown.clone()))
                }
                _ => None,
            };
            let (fingerprint, size, markdown, raw_bytes) =
                if let Some((fingerprint, size, markdown)) = cached_hit {
                    if let Some(ref md) = markdown {
                        bytes += md.len();
                        if bytes > 64 * 1024 * 1024 {
                            return Err("Indexed Markdown is limited to 64 MiB per vault.".into());
                        }
                    }
                    (fingerprint, size, markdown, None)
                } else {
                    let data = read(&self.root, &path, false)?
                        .ok_or("A file changed during indexing. Retry.")?;
                    let fingerprint = hash(&data);
                    let size = data.len() as u64;
                    let markdown = if note {
                        bytes += data.len();
                        if bytes > 64 * 1024 * 1024 {
                            return Err("Indexed Markdown is limited to 64 MiB per vault.".into());
                        }
                        Some(
                            String::from_utf8(data.clone())
                                .map_err(|_| format!("Markdown must be UTF-8: {}", path))?,
                        )
                    } else {
                        None
                    };
                    self.cache.insert(
                        key.clone(),
                        CachedFile {
                            modified,
                            size,
                            path: path.clone(),
                            hash: fingerprint.clone(),
                            markdown: markdown.clone(),
                        },
                    );
                    (fingerprint, size, markdown, Some(data))
                };
            let changed = previous
                .as_ref()
                .is_none_or(|p| p.hash != fingerprint || p.deleted || p.path != path);
            let record = Record {
                id: previous.as_ref().map_or_else(id, |p| p.id.clone()),
                path: path.clone(),
                hash: fingerprint,
                space_id: previous
                    .as_ref()
                    .map_or_else(|| personal.clone(), |p| p.space_id.clone()),
                revision: previous
                    .as_ref()
                    .map_or(1, |p| p.revision + u64::from(changed)),
                created_at: previous.as_ref().map_or_else(now, |p| p.created_at.clone()),
                updated_at: if changed {
                    now()
                } else {
                    previous.as_ref().unwrap().updated_at.clone()
                },
                kind: if note { "note" } else { "attachment" }.into(),
                deleted: false,
                size,
            };
            if changed {
                dirty = true;
                if note {
                    self.record_activity(&record.space_id);
                }
                let action = self
                    .pending_actions
                    .remove(&key)
                    .unwrap_or(if previous.is_some() {
                        "external-edit"
                    } else {
                        "import"
                    });
                self.version(&record, raw_bytes.as_deref(), action)?;
                self.config.files.insert(key, record.clone());
            } else {
                self.pending_actions.remove(&key);
            }
            let mut item =
                serde_json::to_value(&record).map_err(|_| "Cannot encode local index.")?;
            if let Some(markdown) = markdown {
                item["markdown"] = json!(markdown)
            }
            files.push(item);
        }
        self.cache.retain(|k, _| present.contains(k));
        let missing: Vec<_> = self
            .config
            .files
            .iter()
            .filter(|(key, file)| !present.contains(*key) && !file.deleted)
            .map(|(k, f)| (k.clone(), f.clone()))
            .collect();
        for (key, mut record) in missing {
            dirty = true;
            if record.kind == "note" {
                self.record_activity(&record.space_id);
            }
            record.deleted = true;
            record.revision += 1;
            record.updated_at = now();
            let action = self
                .pending_actions
                .remove(&key)
                .unwrap_or("external-delete");
            self.version(&record, None, action)?;
            self.config.files.insert(key, record);
        }
        self.pending_actions.clear();
        if dirty {
            self.save()?;
        }
        Ok(
            json!({"id":self.config.id,"name":self.config.name,"path":self.root.to_string_lossy(),"spaces":self.config.spaces,"files":files,"deletedFiles":self.config.files.values().filter(|f|f.deleted).collect::<Vec<_>>(),"warnings":self.warnings,"sync":self.config.sync,"activity":self.config.activity,"activitySince":self.config.activity_since}),
        )
    }
    pub fn read_note(&mut self, note_id: &str) -> Result<Value> {
        if let Some(record) = self
            .config
            .files
            .values()
            .find(|r| !r.deleted && r.kind == "note" && r.id == note_id)
            .cloned()
        {
            if let Some(bytes) = read(&self.root, &record.path, false)? {
                if hash(&bytes) == record.hash {
                    let markdown = String::from_utf8(bytes)
                        .map_err(|_| format!("Markdown must be UTF-8: {}", record.path))?;
                    let mut item =
                        serde_json::to_value(&record).map_err(|_| "Cannot encode local note.")?;
                    item["markdown"] = json!(markdown);
                    return Ok(item);
                }
            }
        }
        let snapshot = self.scan()?;
        snapshot["files"]
            .as_array()
            .and_then(|files| {
                files
                    .iter()
                    .find(|n| n["kind"] == "note" && n["id"] == note_id)
            })
            .cloned()
            .ok_or("Note not found.".into())
    }
    fn record_activity(&mut self, space_id: &str) {
        let date = Utc::now().format("%Y-%m-%d").to_string();
        let cutoff = (Utc::now() - chrono::Duration::days(364))
            .format("%Y-%m-%d")
            .to_string();
        *self
            .config
            .activity
            .entry(date)
            .or_default()
            .entry(space_id.into())
            .or_default() += 1;
        self.config.activity.retain(|day, _| day >= &cutoff);
        if self.config.activity_since.is_none() {
            self.config.activity_since = Some(now());
        }
    }
    pub fn commit(&mut self, operations: Vec<Operation>) -> Result<Value> {
        if operations.is_empty() || operations.len() > 100 {
            return Err("Save between one and 100 file changes at a time.".into());
        }
        self.scan()?;
        let mut keys = HashSet::new();
        let mut total = 0;
        for op in &operations {
            logical(&op.path)?;
            if !keys.insert(op.path.to_lowercase())
                || !self.config.spaces.iter().any(|s| s.id == op.space_id)
            {
                return Err("Invalid or duplicate file change.".into());
            }
            let current = read(&self.root, &op.path, false)?;
            if current.as_deref().map(hash) != op.expected_hash {
                return Err(
                    "CONFLICT: This file changed outside Helious. Reload it before saving.".into(),
                );
            }
            if let Some(encoded) = &op.data {
                let data = STANDARD
                    .decode(encoded)
                    .map_err(|_| "Invalid file contents.")?;
                total += data.len();
                if data.len() as u64 > FILE_LIMIT || total > 32 * 1024 * 1024 {
                    return Err("This save exceeds the file or batch size limit.".into());
                }
                if op.path.to_lowercase().ends_with(".md")
                    && (data.len() > 1024 * 1024 || std::str::from_utf8(&data).is_err())
                {
                    return Err("Markdown must be UTF-8 and at most 1 MiB.".into());
                }
            }
            if let Some(source) = &op.source_id {
                if !valid_id(source) || !self.config.files.values().any(|f| f.id == *source) {
                    return Err("Unknown move source.".into());
                }
            }
        }
        atomic(
            &self.root,
            ".helious/pending.json",
            &serde_json::to_vec(&operations).map_err(|_| "Cannot write recovery journal.")?,
            true,
        )?;
        let conflicted = self.apply(&operations)?;
        fs::remove_file(safe(&self.root, ".helious/pending.json", true)?)
            .map_err(|_| "Cannot finish recovery journal.")?;
        let snapshot = self.scan()?;
        if conflicted {
            return Err("CONFLICT: Files changed during the coordinated save. Copies were preserved; reload and review before retrying.".into());
        }
        Ok(snapshot)
    }
    fn apply(&mut self, operations: &[Operation]) -> Result<bool> {
        // Recovery journals use the same policy, before replaying any member.
        for op in operations {
            logical(&op.path)?;
        }
        let mut conflicted = false;
        for op in operations {
            let key = op.path.to_lowercase();
            let data = op
                .data
                .as_ref()
                .map(|v| STANDARD.decode(v).map_err(|_| "Invalid recovery contents."))
                .transpose()?;
            let expected_new = data.as_deref().map(hash);
            let current = read(&self.root, &op.path, false)?;
            if current.as_deref().map(hash) != op.expected_hash
                && current.as_deref().map(hash) != expected_new
            {
                conflicted = true;
                if let Some(data) = data {
                    let path = Path::new(&op.path);
                    let stem = path.file_stem().unwrap_or_default().to_string_lossy();
                    let extension = path
                        .extension()
                        .map(|e| format!(".{}", e.to_string_lossy()))
                        .unwrap_or_default();
                    let name = format!(
                        "{}.conflict-{}-local-{}{}",
                        stem,
                        Utc::now().format("%Y%m%dT%H%M%SZ"),
                        &id()[..8],
                        extension
                    );
                    let conflict = path
                        .parent()
                        .unwrap_or(Path::new(""))
                        .join(name)
                        .to_string_lossy()
                        .replace('\\', "/");
                    atomic(&self.root, &conflict, &data, false)?;
                }
                self.warnings.push(format!(
                    "Recovery preserved a concurrently edited file: {}",
                    op.path
                ));
                continue;
            }
            let mut case_rename_from = None;
            if let Some(source) = &op.source_id {
                if let Some(record) = self
                    .config
                    .files
                    .values()
                    .find(|r| r.id == *source)
                    .cloned()
                {
                    if record.path.eq_ignore_ascii_case(&op.path) && record.path != op.path {
                        case_rename_from = Some(record.path.clone());
                    }
                    self.config.files.remove(&record.path.to_lowercase());
                    self.config.files.insert(key.clone(), record);
                }
            }
            if let Some(data) = data {
                atomic(&self.root, &op.path, &data, false)?;
                if let Some(old_path) = case_rename_from {
                    let old_parts: Vec<&str> = old_path.split('/').collect();
                    let new_parts: Vec<&str> = op.path.split('/').collect();
                    if old_parts.len() == new_parts.len() {
                        let mut dir = self.root.clone();
                        for (old_seg, new_seg) in old_parts.iter().zip(new_parts.iter()) {
                            if old_seg != new_seg && old_seg.eq_ignore_ascii_case(new_seg) {
                                let from = dir.join(old_seg);
                                let temp = dir.join(format!("~helious-case-{}", &id()[..8]));
                                let to = dir.join(new_seg);
                                if fs::rename(&from, &temp).is_ok() {
                                    let _ = fs::rename(&temp, &to);
                                }
                            }
                            dir.push(new_seg);
                        }
                    }
                }
            } else if current.is_some() {
                fs::remove_file(safe(&self.root, &op.path, false)?)
                    .map_err(|_| "Cannot remove vault file.")?;
            }
            let action = if op.data.is_none() {
                "local-delete"
            } else if op.source_id.is_some() {
                "local-move"
            } else if op.expected_hash.is_none() {
                "local-create"
            } else {
                "local-edit"
            };
            self.pending_actions.insert(key.clone(), action);
            self.cache.remove(&key);
            if op.data.is_some() {
                let record = self
                    .config
                    .files
                    .entry(key.clone())
                    .or_insert_with(|| Record {
                        id: id(),
                        path: op.path.clone(),
                        hash: String::new(),
                        space_id: op.space_id.clone(),
                        revision: 0,
                        created_at: now(),
                        updated_at: now(),
                        kind: if op.path.to_lowercase().ends_with(".md") {
                            "note"
                        } else {
                            "attachment"
                        }
                        .into(),
                        deleted: false,
                        size: 0,
                    });
                if record.space_id != op.space_id {
                    record.hash = String::new();
                    record.space_id = op.space_id.clone();
                }
            }
        }
        self.save()?;
        Ok(conflicted)
    }
    fn recover(&mut self) -> Result<()> {
        if let Some(bytes) = read(&self.root, ".helious/pending.json", true)? {
            let ops: Vec<Operation> = serde_json::from_slice(&bytes)
                .map_err(|_| "Invalid recovery journal. Preserve it and restore from backup.")?;
            self.apply(&ops)?;
            fs::remove_file(safe(&self.root, ".helious/pending.json", true)?)
                .map_err(|_| "Cannot finish interrupted recovery.")?;
        }
        Ok(())
    }
    pub fn history(&self, file_id: &str, revision: Option<u64>) -> Result<Value> {
        if !valid_id(file_id) {
            return Err("Invalid note ID.".into());
        }
        let record = self
            .config
            .files
            .values()
            .filter(|r| r.id == file_id)
            .max_by_key(|r| r.revision)
            .ok_or("Note not found.")?;
        if let Some(revision) = revision {
            let bytes = read(
                &self.root,
                &format!(".helious/history/{}/{}.json", file_id, revision),
                true,
            )?
            .ok_or("Revision not found.")?;
            let mut v: Value =
                serde_json::from_slice(&bytes).map_err(|_| "Cannot read history.")?;
            v["markdown"] = json!(String::from_utf8(
                STANDARD
                    .decode(v["data"].as_str().unwrap_or(""))
                    .map_err(|_| "Invalid history.")?
            )
            .map_err(|_| "This is not a Markdown revision.")?);
            v.as_object_mut().unwrap().remove("data");
            return Ok(json!({"version":v}));
        }
        let folder = safe(&self.root, &format!(".helious/history/{}", file_id), true)?;
        let mut versions = vec![];
        if folder.exists() {
            for entry in fs::read_dir(folder).map_err(|_| "Cannot read history.")? {
                let entry = entry.map_err(|_| "Cannot read history.")?;
                let name = entry.file_name().to_string_lossy().to_string();
                if !name.ends_with(".json") || name[..name.len() - 5].parse::<u64>().is_err() {
                    continue;
                }
                let bytes = read(
                    &self.root,
                    &format!(".helious/history/{}/{}", file_id, name),
                    true,
                )?
                .ok_or("Revision missing.")?;
                let mut v: Value =
                    serde_json::from_slice(&bytes).map_err(|_| "Invalid history.")?;
                v.as_object_mut().unwrap().remove("data");
                versions.push(v);
            }
        }
        versions.sort_by_key(|v| std::cmp::Reverse(v["revision"].as_u64().unwrap_or(0)));
        Ok(
            json!({"total":versions.len(),"versions":versions,"currentRevision":record.revision,"deleted":record.deleted,"currentPath":record.path,"currentSpaceId":record.space_id}),
        )
    }
    pub fn configure(&mut self, value: Value) -> Result<Value> {
        if let Some(name) = value["name"].as_str() {
            if name.trim().is_empty() || name.len() > 100 {
                return Err("Use a vault name under 100 characters.".into());
            }
            self.config.name = name.trim().into()
        }
        if let Some(spaces) = value.get("spaces") {
            let spaces: Vec<Space> =
                serde_json::from_value(spaces.clone()).map_err(|_| "Invalid Spaces.")?;
            if spaces.len() > 100
                || spaces
                    .iter()
                    .any(|s| !valid_id(&s.id) || s.name.is_empty() || s.name.len() > 80)
                || !spaces.iter().any(|s| s.kind == "personal")
                || self
                    .config
                    .files
                    .values()
                    .any(|f| !spaces.iter().any(|s| s.id == f.space_id))
            {
                return Err("Spaces must retain every file's current assignment.".into());
            }
            self.config.spaces = spaces;
        }
        if let Some(sync) = value.get("sync") {
            if serde_json::to_vec(sync)
                .map_err(|_| "Invalid sync state.")?
                .len()
                > 16 * 1024 * 1024
            {
                return Err("Sync state is too large.".into());
            }
            self.config.sync = sync.clone()
        }
        self.save()?;
        Ok(json!({"ok":true}))
    }
}
