// Framing generation module - algorithms for wall framing layout
// Generates studs, plates, headers, and other framing members

pub mod generator;
pub mod regeneration;

pub use generator::FramingGenerator;
pub use regeneration::RegenerationManager;
