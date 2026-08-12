use std::sync::OnceLock;

/// List the family names of all fonts installed on this system, sorted
/// case-insensitively. Enumeration is expensive (~100ms+), so the result is
/// computed once and cached for the lifetime of the process.
#[tauri::command]
pub fn list_system_fonts() -> Vec<String> {
    static FONTS: OnceLock<Vec<String>> = OnceLock::new();
    FONTS.get_or_init(enumerate_system_fonts).clone()
}

fn enumerate_system_fonts() -> Vec<String> {
    let mut db = fontdb::Database::new();
    db.load_system_fonts();

    let mut families: Vec<String> = db
        .faces()
        .flat_map(|face| face.families.iter())
        .map(|(name, _language)| name.clone())
        .collect();
    families.sort_unstable_by_key(|name| name.to_lowercase());
    families.dedup();
    families
}
