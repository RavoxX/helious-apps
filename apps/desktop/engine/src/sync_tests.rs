const CODE: &str = "111111111111111111111111";
use crate::{remote, vault, Engine};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    io::{Read, Write},
    net::TcpListener,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};

struct Server {
    origin: String,
    files: Arc<Mutex<BTreeMap<String, (Value, String)>>>,
    stop: Arc<AtomicBool>,
    worker: Option<std::thread::JoinHandle<()>>,
}
impl Server {
    fn start() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let origin = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
        let files = Arc::new(Mutex::new(BTreeMap::<String, (Value, String)>::new()));
        let stop = Arc::new(AtomicBool::new(false));
        let (data, done) = (files.clone(), stop.clone());
        let worker = std::thread::spawn(move || {
            while !done.load(Ordering::Relaxed) {
                let (mut socket, _) = match listener.accept() {
                    Ok(v) => v,
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(std::time::Duration::from_millis(3));
                        continue;
                    }
                    Err(e) => panic!("{e}"),
                };
                socket.set_nonblocking(false).unwrap();
                socket
                    .set_read_timeout(Some(std::time::Duration::from_secs(5)))
                    .unwrap();
                let mut bytes = Vec::new();
                let mut chunk = [0; 4096];
                let end = loop {
                    let n = socket.read(&mut chunk).unwrap();
                    assert!(n > 0);
                    bytes.extend_from_slice(&chunk[..n]);
                    if let Some(end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                        let headers = String::from_utf8_lossy(&bytes[..end]);
                        let length = headers
                            .lines()
                            .find_map(|l| {
                                l.to_ascii_lowercase()
                                    .strip_prefix("content-length:")
                                    .and_then(|v| v.trim().parse::<usize>().ok())
                            })
                            .unwrap_or(0);
                        if bytes.len() >= end + 4 + length {
                            break end;
                        }
                    }
                };
                let header = String::from_utf8_lossy(&bytes[..end]);
                let first = header.lines().next().unwrap();
                let mut fields = first.split_whitespace();
                let method = fields.next().unwrap();
                let path = fields.next().unwrap();
                assert!(header.contains("synthetic-sync-session"));
                let body: Value = if bytes.len() > end + 4 {
                    serde_json::from_slice(&bytes[end + 4..]).unwrap()
                } else {
                    Value::Null
                };
                let mut files = data.lock().unwrap();
                let mut status = 200;
                let result = if path == "/api/auth/me" {
                    json!({"user":{"id":"owner"}})
                } else if path.ends_with("/spaces") {
                    json!({"spaces":[{"id":CODE,"kind":"code","name":"Code"},{"id":"222222222222222222222222","kind":"personal","name":"Personal"}]})
                } else if path.contains("/sync/manifest?") {
                    assert!(path.ends_with(&format!("spaceIds={CODE}")));
                    json!({"files":files.values().map(|(v,_)|v.clone()).collect::<Vec<_>>()})
                } else if path.contains("/sync/file?") {
                    let url = url::Url::parse(&format!("http://localhost{path}")).unwrap();
                    let id = url
                        .query_pairs()
                        .find(|(k, _)| k == "id")
                        .unwrap()
                        .1
                        .into_owned();
                    let (file, text) = files.values().find(|(f, _)| f["id"] == id).unwrap();
                    json!({"file":file,"data":STANDARD.encode(text)})
                } else if method == "POST" && path.ends_with("/sync/file") {
                    assert!(header
                        .to_lowercase()
                        .contains("x-csrf-token: synthetic-csrf"));
                    let path = body["path"].as_str().unwrap().to_string();
                    let current = files
                        .get(&path)
                        .map(|(f, _)| f.clone())
                        .unwrap_or(Value::Null);
                    if current != body["expected"] {
                        status = 409;
                        json!({"error":"Changed"})
                    } else if body["data"].is_null() {
                        files.remove(&path);
                        json!({"file":null})
                    } else {
                        let text = String::from_utf8(
                            STANDARD.decode(body["data"].as_str().unwrap()).unwrap(),
                        )
                        .unwrap();
                        let file = json!({"id":path,"path":path,"kind":"note","spaceId":body["spaceId"],"hash":vault::hash(text.as_bytes()),"revision":current["revision"].as_u64().unwrap_or(0)+1});
                        files.insert(path, (file.clone(), text));
                        json!({"file":file})
                    }
                } else {
                    panic!("Unexpected request {first}")
                };
                let response = result.to_string();
                write!(socket,"HTTP/1.1 {status} OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",response.len(),response).unwrap();
            }
        });
        remote::save(&remote::Session {
            origin: origin.clone(),
            cookies: BTreeMap::from([("helious_session".into(), "synthetic-sync-session".into())]),
            csrf: Some("synthetic-csrf".into()),
        })
        .unwrap();
        Self {
            origin,
            files,
            stop,
            worker: Some(worker),
        }
    }
    fn edit(&self, path: &str, text: &str) {
        let mut files = self.files.lock().unwrap();
        let previous = files
            .get(path)
            .map(|(f, _)| f["revision"].as_u64().unwrap())
            .unwrap_or(0);
        files.insert(path.into(),(json!({"id":path,"path":path,"kind":"note","spaceId":CODE,"hash":vault::hash(text.as_bytes()),"revision":previous+1}),text.into()));
    }
}
impl Drop for Server {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        let _ = remote::forget(&self.origin);
        if let Some(worker) = self.worker.take() {
            if !std::thread::panicking() {
                worker.join().unwrap();
            }
        }
    }
}

#[test]
#[ignore = "Requires an unlocked OS credential store; uses only a synthetic local server/session."]
fn native_sync_preserves_personal_and_conflicts_and_refreshes_stale_choices() {
    let server = Server::start();
    let settings = tempfile::tempdir().unwrap();
    let folder = tempfile::tempdir().unwrap();
    std::fs::write(
        settings.path().join("registry.json"),
        json!({"server":server.origin}).to_string(),
    )
    .unwrap();
    std::fs::write(folder.path().join("Code.md"), "code one").unwrap();
    std::fs::write(folder.path().join("Private.md"), "personal").unwrap();
    let mut engine = Engine::new(settings.path().into()).unwrap();
    let snapshot = engine
        .execute(json!({"operation":"open_local","path":folder.path()}))
        .unwrap();
    let id = snapshot["id"].as_str().unwrap();
    let code = snapshot["spaces"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["kind"] == "code")
        .unwrap()["id"]
        .as_str()
        .unwrap();
    engine
        .local(id)
        .unwrap()
        .commit(vec![vault::Operation {
            path: "Code.md".into(),
            data: Some(STANDARD.encode("code one")),
            expected_hash: Some(vault::hash(b"code one")),
            space_id: code.into(),
            source_id: None,
        }])
        .unwrap();
    let config = json!({"schema":1,"serverOrigin":server.origin,"ownerId":"owner","vaultId":"333333333333333333333333","mappings":{code:CODE},"base":{},"conflicts":{},"auto":false});
    engine
        .execute(json!({"operation":"local_config","vaultId":id,"value":{"sync":config}}))
        .unwrap();
    let sync = json!({"operation":"sync","vaultId":id});
    engine.execute(sync.clone()).unwrap();
    assert_eq!(server.files.lock().unwrap().len(), 1);
    server.edit("Code.md", "code two");
    engine.execute(sync.clone()).unwrap();
    assert_eq!(
        std::fs::read_to_string(folder.path().join("Code.md")).unwrap(),
        "code two"
    );
    std::fs::write(folder.path().join("Code.md"), "local three").unwrap();
    server.edit("Code.md", "server four");
    let conflict = engine.execute(sync.clone()).unwrap();
    assert_eq!(
        conflict["configuration"]["conflicts"]
            .as_object()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        std::fs::read_to_string(folder.path().join("Code.md")).unwrap(),
        "local three"
    );
    server.edit("Code.md", "server five");
    let choice = json!({"operation":"resolve_sync","vaultId":id,"path":"Code.md","choice":"local"});
    assert!(engine.execute(choice.clone()).is_err());
    engine.execute(sync.clone()).unwrap();
    engine.execute(choice).unwrap();
    assert_eq!(server.files.lock().unwrap()["Code.md"].1, "local three");
    server.edit("Private.md", "must not overwrite personal");
    assert!(engine.execute(sync).is_err());
    assert_eq!(
        std::fs::read_to_string(folder.path().join("Private.md")).unwrap(),
        "personal"
    );
}
