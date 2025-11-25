// Antigravity CAD - Geometry Server
// Rust backend for building design with Truck geometry kernel and Rhai scripting

mod domain;
mod store;
mod rhai_api;
mod geometry;
mod api;

use std::net::SocketAddr;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[tokio::main]
async fn main() {
    // Initialize tracing
    tracing_subscriber::registry()
        .with(tracing_subscriber::fmt::layer())
        .with(tracing_subscriber::EnvFilter::new(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "info,geometry_server=debug".into()),
        ))
        .init();

    tracing::info!("Antigravity CAD Geometry Server v{}", env!("CARGO_PKG_VERSION"));

    // Create application state
    let state = api::AppState::new();

    // Build router with all API routes
    let app = api::create_router(state);

    // Start server
    let addr = SocketAddr::from(([127, 0, 0, 1], 3001));
    tracing::info!("Listening on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
