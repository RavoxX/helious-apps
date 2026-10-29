fn main() {
    #[cfg(windows)]
    {
        let mut resource = winresource::WindowsResource::new();
        resource.set_icon("../assets/icons/icon.ico");
        resource.set("ProductName", "Helious");
        resource.set("FileDescription", "Helious native knowledge workspace");
        resource
            .compile()
            .expect("Cannot embed Windows app resources");
    }
}
