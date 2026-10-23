//! `tcp-pipe <host> <port>`: relays stdin/stdout to a TCP connection, like `nc` — a portable
//! `ProxyCommand` for the integration tests.

use tokio::{
    io::{AsyncWriteExt, copy},
    net::TcpStream,
};

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let mut args = std::env::args().skip(1);
    let (Some(host), Some(port)) = (args.next(), args.next()) else {
        eprintln!("usage: tcp-pipe <host> <port>");
        std::process::exit(2);
    };
    let stream = match TcpStream::connect(format!("{host}:{port}")).await {
        Ok(s) => s,
        Err(e) => {
            eprintln!("tcp-pipe: connexion à {host}:{port} impossible : {e}");
            std::process::exit(1);
        }
    };
    let (mut rd, mut wr) = stream.into_split();
    let upload = async {
        let _ = copy(&mut tokio::io::stdin(), &mut wr).await;
        let _ = wr.shutdown().await;
    };
    let download = async {
        let mut out = tokio::io::stdout();
        let _ = copy(&mut rd, &mut out).await;
        let _ = out.flush().await;
    };
    tokio::join!(upload, download);
}
