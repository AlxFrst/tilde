use std::{
    io::Write as _,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    thread,
    time::{Duration, Instant},
};

use parking_lot::Mutex;
use tilde_session::{
    FLUSH_BYTES, HIGH_WATERMARK, OutputSink, SessionError, SessionId, SessionManager, SessionSpec,
};

const TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Default)]
struct Recorder {
    bytes: Mutex<Vec<u8>>,
    received: AtomicUsize,
    exits: Mutex<Vec<Option<i32>>>,
}

impl Recorder {
    fn text(&self) -> String {
        String::from_utf8_lossy(&self.bytes.lock()).into_owned()
    }
}

impl OutputSink for Recorder {
    fn data(&self, bytes: Vec<u8>) {
        self.received.fetch_add(bytes.len(), Ordering::SeqCst);
        let mut buf = self.bytes.lock();
        // Keep memory bounded in the flood test; the tail is enough for text checks.
        if buf.len() < 1_000_000 {
            buf.extend_from_slice(&bytes);
        }
    }
    fn exited(&self, code: Option<i32>) {
        self.exits.lock().push(code);
    }
}

fn wait_until(what: &str, mut cond: impl FnMut() -> bool) {
    let start = Instant::now();
    while !cond() {
        assert!(start.elapsed() < TIMEOUT, "timed out waiting for {what}");
        thread::sleep(Duration::from_millis(20));
    }
}

fn shell() -> SessionSpec {
    let (command, args) = if cfg!(windows) { ("cmd.exe", vec![]) } else { ("/bin/sh", vec![]) };
    spec(command, &args)
}

fn spec(command: &str, args: &[&str]) -> SessionSpec {
    SessionSpec {
        command: command.into(),
        args: args.iter().map(|&a| a.to_owned()).collect(),
        cwd: None,
        env: std::collections::BTreeMap::default(),
        cols: 120,
        rows: 30,
    }
}

/// Opens a session and plays the terminal's part of the handshake: on Windows, `ConPTY`
/// asks for the cursor position (`ESC[6n`) and blocks until it gets an answer — xterm.js
/// answers it in the app.
fn open(mgr: &SessionManager, spec: SessionSpec, rec: &Arc<Recorder>) -> SessionId {
    let id = mgr.open(spec, rec.clone()).unwrap();
    if cfg!(windows) {
        wait_until("cursor position request", || rec.text().contains("\x1b[6n"));
        let _ = mgr.write(id, b"\x1b[1;1R");
    }
    id
}
/// Acks everything received so far, as the UI does after rendering.
fn ack_all(mgr: &SessionManager, id: SessionId, rec: &Recorder, acked: &mut usize) {
    let total = rec.received.load(Ordering::SeqCst);
    if total > *acked {
        mgr.ack(id, total - *acked).ok();
        *acked = total;
    }
}

#[test]
fn echo_roundtrip() {
    let mgr = SessionManager::new();
    let rec = Arc::new(Recorder::default());
    let id = open(&mgr, shell(), &rec);
    // The answer (42) never appears in the typed command, only in the output.
    let cmd: &[u8] = if cfg!(windows) { b"set /a 6*7\r" } else { b"echo $((6*7))\n" };
    mgr.write(id, cmd).unwrap();
    wait_until("42 in output", || rec.text().contains("42"));
    mgr.close(id).unwrap();
}

#[test]
fn env_vars_are_set() {
    let mgr = SessionManager::new();
    let rec = Arc::new(Recorder::default());
    let id = open(&mgr, shell(), &rec);
    let cmd: &[u8] = if cfg!(windows) {
        b"echo [%TERM_PROGRAM%] [%COLORTERM%]\r"
    } else {
        b"echo \"[$TERM_PROGRAM] [$COLORTERM]\"\n"
    };
    mgr.write(id, cmd).unwrap();
    wait_until("env values in output", || rec.text().contains("[Tilde] [truecolor]"));
    mgr.close(id).unwrap();
}

#[test]
fn exit_code_is_reported_and_session_removed() {
    let mgr = SessionManager::new();
    let rec = Arc::new(Recorder::default());
    let s = if cfg!(windows) {
        spec("cmd.exe", &["/c", "exit 3"])
    } else {
        spec("/bin/sh", &["-c", "exit 3"])
    };
    open(&mgr, s, &rec);
    wait_until("exit event", || !rec.exits.lock().is_empty());
    wait_until("session removed", || mgr.count() == 0);
    thread::sleep(Duration::from_millis(200));
    assert_eq!(*rec.exits.lock(), [Some(3)], "exited must be called exactly once");
}

#[test]
fn busy_while_child_runs_idle_otherwise() {
    let mgr = SessionManager::new();
    let rec = Arc::new(Recorder::default());
    let id = open(&mgr, shell(), &rec);
    wait_until("prompt", || rec.received.load(Ordering::SeqCst) > 0);
    thread::sleep(Duration::from_millis(300));
    assert!(!mgr.is_busy(id).unwrap(), "an idle shell is not busy");

    let cmd: &[u8] = if cfg!(windows) { b"ping -n 6 127.0.0.1\r" } else { b"sleep 6\n" };
    mgr.write(id, cmd).unwrap();
    wait_until("busy", || mgr.is_busy(id).unwrap());

    mgr.close(id).unwrap();
    assert_eq!(mgr.count(), 0);
}

#[test]
fn flood_is_backpressured_until_acked() {
    let dir = tempfile::TempDir::new().unwrap();
    let path = dir.path().join("big.txt");
    let mut f = std::fs::File::create(&path).unwrap();
    let line = b"0123456789012345678901234567890123456789012345678901234567890123456789\n";
    for _ in 0..=(8_000_000 / line.len()) {
        f.write_all(line).unwrap();
    }
    drop(f);
    let p = path.to_string_lossy().into_owned();
    let s =
        if cfg!(windows) { spec("cmd.exe", &["/c", "type", &p]) } else { spec("/bin/cat", &[&p]) };

    let mgr = SessionManager::new();
    let rec = Arc::new(Recorder::default());
    let id = open(&mgr, s, &rec);

    // Without acks the pump must stop after HIGH_WATERMARK (+ one in-flight chunk).
    thread::sleep(Duration::from_secs(1));
    let unacked = rec.received.load(Ordering::SeqCst);
    assert!(unacked > 0, "some output arrives");
    assert!(unacked <= HIGH_WATERMARK + FLUSH_BYTES, "{unacked} bytes sent without acks");

    // Acking as the UI renders lets the whole file through.
    let mut acked = 0;
    let start = Instant::now();
    while rec.exits.lock().is_empty() {
        assert!(start.elapsed() < Duration::from_secs(60), "flood did not finish");
        ack_all(&mgr, id, &rec, &mut acked);
        thread::sleep(Duration::from_millis(5));
    }
    let total = rec.received.load(Ordering::SeqCst);
    // ConPTY re-renders output rather than passing bytes through, so on Windows we only
    // require that flow resumed well past the watermark.
    let floor = if cfg!(windows) { 4 * HIGH_WATERMARK } else { 8_000_000 };
    assert!(total >= floor, "only {total} bytes received");
}

#[test]
fn write_to_unknown_session_errors() {
    let mgr = SessionManager::new();
    assert!(matches!(mgr.write(SessionId(999), b"x"), Err(SessionError::NotFound(_))));
}

#[test]
fn zero_size_resize_is_ignored() {
    let mgr = SessionManager::new();
    let rec = Arc::new(Recorder::default());
    let id = open(&mgr, shell(), &rec);
    assert!(mgr.resize(id, 0, 10).is_ok());
    assert!(mgr.resize(id, 100, 40).is_ok());
    mgr.close(id).unwrap();
}
