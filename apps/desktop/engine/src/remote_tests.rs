use crate::remote;
use std::{
    io::{Read, Write},
    net::TcpListener,
};
#[test]
fn accepts_only_canonical_tls_or_loopback_server_origins() {
    assert_eq!(
        remote::origin("https://knowledge.example/").unwrap(),
        "https://knowledge.example"
    );
    assert!(remote::origin("http://127.0.0.1:3000").is_ok());
    for invalid in [
        "http://remote.example",
        "https://user:password@host.example",
        "https://host.example/app/",
        "https://host.example?token=x",
        "file:///tmp/data",
    ] {
        assert!(remote::origin(invalid).is_err(), "{}", invalid);
    }
}
#[test]
#[ignore = "Requires an unlocked native OS credential store; run explicitly on a development machine."]
fn native_cookie_sessions_round_trip_through_the_os_keyring_without_frontend_credentials() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let origin = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
    let expected_origin = origin.clone();
    let server = std::thread::spawn(move || {
        for expected in ["/api/auth/csrf", "/api/auth/login", "/api/auth/me"] {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(std::time::Duration::from_secs(10)))
                .unwrap();
            let mut bytes = vec![];
            let mut chunk = [0; 4096];
            loop {
                let n = socket.read(&mut chunk).unwrap();
                assert!(n > 0);
                bytes.extend_from_slice(&chunk[..n]);
                if let Some(end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&bytes[..end]);
                    let length = headers
                        .lines()
                        .find_map(|line| {
                            line.to_lowercase()
                                .strip_prefix("content-length:")
                                .and_then(|value| value.trim().parse::<usize>().ok())
                        })
                        .unwrap_or(0);
                    if bytes.len() >= end + 4 + length {
                        break;
                    }
                }
            }
            let request = String::from_utf8_lossy(&bytes);
            assert!(request.lines().next().unwrap().contains(expected));
            assert!(request
                .to_lowercase()
                .contains(&format!("origin: {}", expected_origin)));
            let (cookie, body) = match expected {
                "/api/auth/csrf" => (
                    "Set-Cookie: helious_csrf=synthetic-csrf-cookie; HttpOnly\r\n",
                    r#"{"csrfToken":"synthetic-csrf-header"}"#,
                ),
                "/api/auth/login" => {
                    assert!(request.contains("synthetic-csrf-header"));
                    assert!(!request.contains("\"code\":null"));
                    ("Set-Cookie: helious_session=synthetic-session-not-a-real-account; HttpOnly\r\n",r#"{"user":{"id":"test-user"}}"#)
                }
                _ => {
                    assert!(
                        request.contains("helious_session=synthetic-session-not-a-real-account")
                    );
                    ("", r#"{"user":{"id":"test-user"}}"#)
                }
            };
            write!(socket,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n{}\r\n{}",body.len(),cookie,body).unwrap();
        }
    });
    tokio::runtime::Runtime::new().unwrap().block_on(async {
        let result = remote::connect(
            &origin,
            "synthetic@example.test",
            "synthetic-passphrase",
            None,
        )
        .await
        .unwrap();
        assert_eq!(result.status, 200);
        assert!(!serde_json::to_string(&result)
            .unwrap()
            .contains("synthetic-session"));
        let stored = remote::load(&origin).unwrap();
        assert_eq!(
            stored.cookies["helious_session"],
            "synthetic-session-not-a-real-account"
        );
        let read = remote::request(&origin, "/api/auth/me", "GET", serde_json::Value::Null)
            .await
            .unwrap();
        assert_eq!(read.status, 200);
        remote::forget(&origin).unwrap();
        assert!(remote::load(&origin).is_err());
    });
    server.join().unwrap();
}
