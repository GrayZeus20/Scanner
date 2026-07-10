# AGENTS.md

## Project Vision
A web-based document scanner with features for direct camera capture, file upload, and conversion to image/PDF formats, with support for local-only storage and deployment.

## Development & Deployment Notes
- **Hosting:** The application should be designed for simple deployment (e.g., static hosting, PWA support for offline capabilities).
- **Storage:** Prioritize `IndexedDB` or `File System Access API` for local document persistence.
- **Tools:** Use Web APIs for camera access (`navigator.mediaDevices.getUserMedia`) and client-side processing for conversion (e.g., `canvas`, `jsPDF`).

## Operational Gotchas
- **Permissions:** Always handle camera permission denials gracefully.
- **Local Storage:** Ensure data remains secure and private when storing on the user's device.
