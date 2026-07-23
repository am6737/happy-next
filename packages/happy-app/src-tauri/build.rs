fn main() {
    println!("cargo:rerun-if-env-changed=HAPPY_UPDATER_TEST_MODE");
    tauri_build::build()
}
