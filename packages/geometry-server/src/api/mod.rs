// HTTP API endpoints for the geometry server
// Provides REST endpoints for frontend interaction and script execution

use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use tower_http::cors::{Any, CorsLayer};

use geometry_core::domain::*;
use geometry_core::geometry::{self, MeshData, SolidCache};
use geometry_core::rhai_api;
use geometry_core::store::{self, SharedStore};

/// Application state shared across handlers
#[derive(Clone)]
pub struct AppState {
    pub store: SharedStore,
    pub solid_cache: SolidCache,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            store: crate::store::new_shared_store(),
            solid_cache: geometry::new_solid_cache(),
        }
    }
}

/// Create the router with all API routes
pub fn create_router(state: AppState) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    Router::new()
        // Health & info
        .route("/health", get(health_check))
        .route("/api/v1/info", get(api_info))

        // Script execution
        .route("/api/v1/execute", post(execute_script))
        .route("/api/v1/validate", post(validate_script))

        // Project endpoints
        .route("/api/v1/projects", get(list_projects))
        .route("/api/v1/projects", post(create_project))
        .route("/api/v1/projects/:id", get(get_project))

        // Building endpoints
        .route("/api/v1/projects/:project_id/buildings", post(add_building))
        .route("/api/v1/buildings/:id", get(get_building))
        .route("/api/v1/buildings/:id/stats", get(get_building_stats))
        .route("/api/v1/buildings/:id/grid", post(create_grid))
        .route("/api/v1/buildings/:id/grid", get(get_grid))
        .route("/api/v1/buildings/:id/grid/axes", post(add_grid_axis))

        // Level endpoints
        .route("/api/v1/buildings/:building_id/levels", post(add_level))
        .route("/api/v1/levels/:id", get(get_level))

        // Footprint endpoints
        .route("/api/v1/levels/:level_id/footprint", post(set_footprint))
        .route("/api/v1/levels/:level_id/footprint", get(get_footprint))

        // Geometry endpoints
        .route("/api/v1/levels/:level_id/mesh", get(get_level_mesh))

        // Events endpoint
        .route("/api/v1/projects/:project_id/events", get(get_project_events))

        .layer(cors)
        .with_state(state)
}

// ========== Response Types ==========

#[derive(Serialize)]
pub struct ApiResponse<T> {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<T>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl<T> ApiResponse<T> {
    pub fn success(data: T) -> Self {
        Self {
            success: true,
            data: Some(data),
            error: None,
        }
    }

    pub fn error(msg: impl Into<String>) -> Self {
        Self {
            success: false,
            data: None,
            error: Some(msg.into()),
        }
    }
}

// ========== Health & Info ==========

#[derive(Serialize)]
pub struct HealthResponse {
    pub status: String,
    pub system: String,
    pub version: String,
}

async fn health_check() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok".into(),
        system: "antigravity-rust".into(),
        version: env!("CARGO_PKG_VERSION").into(),
    })
}

#[derive(Serialize)]
pub struct ApiInfoResponse {
    pub name: String,
    pub version: String,
    pub endpoints: Vec<String>,
}

async fn api_info() -> Json<ApiInfoResponse> {
    Json(ApiInfoResponse {
        name: "Antigravity CAD Geometry Server".into(),
        version: env!("CARGO_PKG_VERSION").into(),
        endpoints: vec![
            "/api/v1/execute".into(),
            "/api/v1/projects".into(),
            "/api/v1/buildings".into(),
            "/api/v1/levels".into(),
        ],
    })
}

// ========== Script Execution ==========

#[derive(Deserialize)]
pub struct ExecuteRequest {
    pub script: String,
}

#[derive(Serialize)]
pub struct ExecuteResponse {
    pub success: bool,
    pub result: Option<serde_json::Value>,
    pub error: Option<String>,
    pub events_generated: usize,
}

async fn execute_script(
    State(state): State<AppState>,
    Json(req): Json<ExecuteRequest>,
) -> Json<ExecuteResponse> {
    let engine = rhai_api::create_engine(state.store.clone());
    let result = rhai_api::execute_script(&engine, &req.script, state.store);

    Json(ExecuteResponse {
        success: result.success,
        result: result.return_value.map(|v| {
            // Convert Rhai Dynamic to serde_json::Value
            serde_json::to_value(format!("{:?}", v)).unwrap_or(serde_json::Value::Null)
        }),
        error: result.error,
        events_generated: result.events_generated,
    })
}

#[derive(Serialize)]
pub struct ValidateResponse {
    pub valid: bool,
    pub error: Option<String>,
}

async fn validate_script(
    State(state): State<AppState>,
    Json(req): Json<ExecuteRequest>,
) -> Json<ValidateResponse> {
    let engine = rhai_api::create_engine(state.store);

    match rhai_api::compile_script(&engine, &req.script) {
        Ok(_) => Json(ValidateResponse {
            valid: true,
            error: None,
        }),
        Err(e) => Json(ValidateResponse {
            valid: false,
            error: Some(e.to_string()),
        }),
    }
}

// ========== Project Endpoints ==========

#[derive(Serialize)]
pub struct ProjectSummary {
    pub id: String,
    pub name: String,
    pub units: String,
    pub building_count: usize,
    pub created_at: String,
    pub modified_at: String,
}

async fn list_projects(
    State(state): State<AppState>,
) -> Json<ApiResponse<Vec<ProjectSummary>>> {
    let store = state.store.read().unwrap();
    let projects: Vec<ProjectSummary> = store
        .list_projects()
        .iter()
        .map(|p| ProjectSummary {
            id: p.id.to_string(),
            name: p.name.clone(),
            units: format!("{:?}", p.units),
            building_count: p.building_ids.len(),
            created_at: p.created_at.to_rfc3339(),
            modified_at: p.modified_at.to_rfc3339(),
        })
        .collect();

    Json(ApiResponse::success(projects))
}

#[derive(Deserialize)]
pub struct CreateProjectRequest {
    pub name: String,
    #[serde(default = "default_units")]
    pub units: String,
    #[serde(default = "default_code_region")]
    pub code_region: String,
}

fn default_units() -> String {
    "imperial".into()
}

fn default_code_region() -> String {
    "US_IRC_2021".into()
}

async fn create_project(
    State(state): State<AppState>,
    Json(req): Json<CreateProjectRequest>,
) -> Result<Json<ApiResponse<ProjectSummary>>, StatusCode> {
    let units = match req.units.to_lowercase().as_str() {
        "imperial" | "us" => UnitSystem::Imperial,
        "metric" | "si" => UnitSystem::Metric,
        _ => return Err(StatusCode::BAD_REQUEST),
    };

    let code_region = CodeRegion::us_irc_2021(); // Simplified for now

    let mut store = state.store.write().unwrap();
    match store.create_project(&req.name, units, code_region) {
        Ok(project_id) => {
            let project = store.get_project(project_id).unwrap();
            Ok(Json(ApiResponse::success(ProjectSummary {
                id: project.id.to_string(),
                name: project.name.clone(),
                units: format!("{:?}", project.units),
                building_count: 0,
                created_at: project.created_at.to_rfc3339(),
                modified_at: project.modified_at.to_rfc3339(),
            })))
        }
        Err(e) => Ok(Json(ApiResponse::error(e.to_string()))),
    }
}

async fn get_project(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<ProjectSummary>>, StatusCode> {
    let project_id: ProjectId = id.parse().map_err(|_| StatusCode::BAD_REQUEST)?;

    let store = state.store.read().unwrap();
    match store.get_project(project_id) {
        Some(project) => Ok(Json(ApiResponse::success(ProjectSummary {
            id: project.id.to_string(),
            name: project.name.clone(),
            units: format!("{:?}", project.units),
            building_count: project.building_ids.len(),
            created_at: project.created_at.to_rfc3339(),
            modified_at: project.modified_at.to_rfc3339(),
        }))),
        None => Err(StatusCode::NOT_FOUND),
    }
}

// ========== Building Endpoints ==========

#[derive(Deserialize)]
pub struct AddBuildingRequest {
    pub name: String,
}

#[derive(Serialize)]
pub struct BuildingSummary {
    pub id: String,
    pub name: String,
    pub level_count: usize,
}

async fn add_building(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    Json(req): Json<AddBuildingRequest>,
) -> Result<Json<ApiResponse<BuildingSummary>>, StatusCode> {
    let project_id: ProjectId = project_id.parse().map_err(|_| StatusCode::BAD_REQUEST)?;

    let mut store = state.store.write().unwrap();
    match store.add_building(project_id, &req.name) {
        Ok(building_id) => {
            let building = store.get_building(building_id).unwrap();
            Ok(Json(ApiResponse::success(BuildingSummary {
                id: building.id.to_string(),
                name: building.name.clone(),
                level_count: 0,
            })))
        }
        Err(e) => Ok(Json(ApiResponse::error(e.to_string()))),
    }
}

async fn get_building(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<BuildingSummary>>, StatusCode> {
    let building_id: BuildingId = id.parse().map_err(|_| StatusCode::BAD_REQUEST)?;

    let store = state.store.read().unwrap();
    match store.get_building(building_id) {
        Some(building) => Ok(Json(ApiResponse::success(BuildingSummary {
            id: building.id.to_string(),
            name: building.name.clone(),
            level_count: building.level_ids.len(),
        }))),
        None => Err(StatusCode::NOT_FOUND),
    }
}

#[derive(Serialize)]
pub struct BuildingStatsResponse {
    pub total_area: f64,
    pub level_count: usize,
}

async fn get_building_stats(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<BuildingStatsResponse>>, StatusCode> {
    let building_id: BuildingId = id.parse().map_err(|_| StatusCode::BAD_REQUEST)?;

    let store = state.store.read().unwrap();
    match store.get_building_stats(building_id) {
        Some(stats) => Ok(Json(ApiResponse::success(BuildingStatsResponse {
            total_area: stats.total_area,
            level_count: stats.level_count,
        }))),
        None => Err(StatusCode::NOT_FOUND),
    }
}

// ========== Grid Endpoints ==========

#[derive(Serialize)]
pub struct GridSummary {
    pub building_id: String,
    pub axis_count: usize,
    pub axes: Vec<GridAxisSummary>,
}

#[derive(Serialize)]
pub struct GridAxisSummary {
    pub name: String,
    pub direction: String,
    pub offset: f64,
}

async fn create_grid(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<GridSummary>>, StatusCode> {
    let building_id: BuildingId = id.parse().map_err(|_| StatusCode::BAD_REQUEST)?;

    let mut store = state.store.write().unwrap();
    match store.create_grid(building_id) {
        Ok(()) => {
            let grid = store.get_grid(building_id).unwrap();
            Ok(Json(ApiResponse::success(GridSummary {
                building_id: building_id.to_string(),
                axis_count: grid.axes.len(),
                axes: vec![],
            })))
        }
        Err(e) => Ok(Json(ApiResponse::error(e.to_string()))),
    }
}

async fn get_grid(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<GridSummary>>, StatusCode> {
    let building_id: BuildingId = id.parse().map_err(|_| StatusCode::BAD_REQUEST)?;

    let store = state.store.read().unwrap();
    match store.get_grid(building_id) {
        Some(grid) => Ok(Json(ApiResponse::success(GridSummary {
            building_id: building_id.to_string(),
            axis_count: grid.axes.len(),
            axes: grid.axes.iter().map(|a| GridAxisSummary {
                name: a.name.clone(),
                direction: format!("{:?}", a.direction),
                offset: a.offset,
            }).collect(),
        }))),
        None => Err(StatusCode::NOT_FOUND),
    }
}

#[derive(Deserialize)]
pub struct AddGridAxisRequest {
    pub name: String,
    pub direction: String,
    pub offset: f64,
}

async fn add_grid_axis(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<AddGridAxisRequest>,
) -> Result<Json<ApiResponse<GridAxisSummary>>, StatusCode> {
    let building_id: BuildingId = id.parse().map_err(|_| StatusCode::BAD_REQUEST)?;

    let direction = match req.direction.to_lowercase().as_str() {
        "horizontal" | "h" | "x" => GridDirection::Horizontal,
        "vertical" | "v" | "y" => GridDirection::Vertical,
        _ => return Err(StatusCode::BAD_REQUEST),
    };

    let axis = GridAxis {
        name: req.name.clone(),
        direction,
        offset: req.offset,
    };

    let mut store = state.store.write().unwrap();
    match store.add_grid_axis(building_id, axis) {
        Ok(()) => Ok(Json(ApiResponse::success(GridAxisSummary {
            name: req.name,
            direction: req.direction,
            offset: req.offset,
        }))),
        Err(e) => Ok(Json(ApiResponse::error(e.to_string()))),
    }
}

// ========== Level Endpoints ==========

#[derive(Deserialize)]
pub struct AddLevelRequest {
    pub name: String,
    pub elevation: f64,
    pub floor_to_floor: f64,
}

#[derive(Serialize)]
pub struct LevelSummary {
    pub id: String,
    pub name: String,
    pub elevation: f64,
    pub floor_to_floor: f64,
    pub has_footprint: bool,
}

async fn add_level(
    State(state): State<AppState>,
    Path(building_id): Path<String>,
    Json(req): Json<AddLevelRequest>,
) -> Result<Json<ApiResponse<LevelSummary>>, StatusCode> {
    let building_id: BuildingId = building_id.parse().map_err(|_| StatusCode::BAD_REQUEST)?;

    let mut store = state.store.write().unwrap();
    match store.add_level(building_id, &req.name, req.elevation, req.floor_to_floor) {
        Ok(level_id) => {
            let level = store.get_level(level_id).unwrap();
            Ok(Json(ApiResponse::success(LevelSummary {
                id: level.id.to_string(),
                name: level.name.clone(),
                elevation: level.elevation,
                floor_to_floor: level.floor_to_floor,
                has_footprint: level.footprint_id.is_some(),
            })))
        }
        Err(e) => Ok(Json(ApiResponse::error(e.to_string()))),
    }
}

async fn get_level(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<LevelSummary>>, StatusCode> {
    let level_id: LevelId = id.parse().map_err(|_| StatusCode::BAD_REQUEST)?;

    let store = state.store.read().unwrap();
    match store.get_level(level_id) {
        Some(level) => Ok(Json(ApiResponse::success(LevelSummary {
            id: level.id.to_string(),
            name: level.name.clone(),
            elevation: level.elevation,
            floor_to_floor: level.floor_to_floor,
            has_footprint: level.footprint_id.is_some(),
        }))),
        None => Err(StatusCode::NOT_FOUND),
    }
}

// ========== Footprint Endpoints ==========

#[derive(Deserialize)]
pub struct SetFootprintRequest {
    pub polygon: Vec<[f64; 2]>,
}

#[derive(Serialize)]
pub struct FootprintSummary {
    pub id: String,
    pub area: f64,
    pub perimeter: f64,
    pub vertex_count: usize,
}

async fn set_footprint(
    State(state): State<AppState>,
    Path(level_id): Path<String>,
    Json(req): Json<SetFootprintRequest>,
) -> Result<Json<ApiResponse<FootprintSummary>>, StatusCode> {
    let level_id: LevelId = level_id.parse().map_err(|_| StatusCode::BAD_REQUEST)?;

    let points: Vec<Point2> = req.polygon
        .iter()
        .map(|[x, y]| Point2::new(*x, *y))
        .collect();
    let polygon = Polygon2::new(points);

    let mut store = state.store.write().unwrap();
    match store.set_level_footprint(level_id, polygon) {
        Ok(footprint_id) => {
            let footprint = store.get_footprint(footprint_id).unwrap();
            Ok(Json(ApiResponse::success(FootprintSummary {
                id: footprint.id.to_string(),
                area: footprint.area(),
                perimeter: footprint.perimeter(),
                vertex_count: footprint.polygon.outer.len(),
            })))
        }
        Err(e) => Ok(Json(ApiResponse::error(e.to_string()))),
    }
}

async fn get_footprint(
    State(state): State<AppState>,
    Path(level_id): Path<String>,
) -> Result<Json<ApiResponse<FootprintSummary>>, StatusCode> {
    let level_id: LevelId = level_id.parse().map_err(|_| StatusCode::BAD_REQUEST)?;

    let store = state.store.read().unwrap();
    match store.get_level_footprint(level_id) {
        Some(footprint) => Ok(Json(ApiResponse::success(FootprintSummary {
            id: footprint.id.to_string(),
            area: footprint.area(),
            perimeter: footprint.perimeter(),
            vertex_count: footprint.polygon.outer.len(),
        }))),
        None => Err(StatusCode::NOT_FOUND),
    }
}

// ========== Geometry Endpoints ==========

async fn get_level_mesh(
    State(state): State<AppState>,
    Path(level_id): Path<String>,
) -> Result<Json<ApiResponse<MeshData>>, StatusCode> {
    let level_id: LevelId = level_id.parse().map_err(|_| StatusCode::BAD_REQUEST)?;

    let store = state.store.read().unwrap();
    let level = store.get_level(level_id).ok_or(StatusCode::NOT_FOUND)?;
    let footprint = store.get_level_footprint(level_id).ok_or(StatusCode::NOT_FOUND)?;

    // Generate mesh from footprint
    match geometry::extrude_polygon(&footprint.polygon, level.elevation, level.floor_to_floor) {
        Ok(solid) => {
            match geometry::solid_to_mesh(&solid, 0.1) {
                Ok(mesh) => Ok(Json(ApiResponse::success(mesh))),
                Err(e) => Ok(Json(ApiResponse::error(e.to_string()))),
            }
        }
        Err(e) => Ok(Json(ApiResponse::error(e.to_string()))),
    }
}

// ========== Events Endpoint ==========

#[derive(Serialize)]
pub struct EventSummary {
    pub id: u64,
    pub timestamp: String,
    pub event_type: String,
}

async fn get_project_events(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<Json<ApiResponse<Vec<EventSummary>>>, StatusCode> {
    let project_id: ProjectId = project_id.parse().map_err(|_| StatusCode::BAD_REQUEST)?;

    let store = state.store.read().unwrap();
    match store.get_event_log(project_id) {
        Some(log) => {
            let events: Vec<EventSummary> = log
                .events()
                .iter()
                .map(|e| EventSummary {
                    id: e.id,
                    timestamp: e.timestamp.to_rfc3339(),
                    event_type: format!("{:?}", std::mem::discriminant(&e.kind)),
                })
                .collect();
            Ok(Json(ApiResponse::success(events)))
        }
        None => Err(StatusCode::NOT_FOUND),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use tower::ServiceExt;

    fn test_app() -> Router {
        let state = AppState::new();
        create_router(state)
    }

    #[tokio::test]
    async fn test_health_check() {
        let app = test_app();
        let response = app
            .oneshot(Request::builder().uri("/health").body(Body::empty()).unwrap())
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn test_create_project() {
        let app = test_app();
        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/projects")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"name": "Test House"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
    }
}
