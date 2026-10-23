//! Prints the shells detected on this machine: `cargo run -p tilde-pty --example list-shells`.

fn main() {
    for s in tilde_pty::detect_shells() {
        println!("{:<16} {:<24} {} {}", s.id, s.name, s.command, s.args.join(" "));
    }
}
