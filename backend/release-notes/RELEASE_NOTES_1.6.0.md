## 🎉 Monux 1.6.0

## ✨ New Features

- **Saved SSH Credentials**: Save per-host SSH credentials (username, password, or private key) so the web terminal auto-connects without prompting each time. Credentials are encrypted at rest and can be managed from the Terminal tab on the host detail page.

---

## 🔧 Improvements

- **Agent Auto-Release Workflow**: Fixed the GitHub Actions workflow so built agent binaries are correctly included in release artifacts.

---

## 🐛 Bug Fixes

- **Bare-Metal Nginx Caching**: The `setup.sh` nginx config now sends `no-cache` headers for `index.html`, preventing browsers from serving stale frontend bundles after running `setup.sh --update`. Old `dist/assets` are also cleaned before rebuilding.
- **Docker Nginx Caching**: Added matching `no-cache` headers for `index.html` in the Docker nginx config template.

---

## Thank you

I appreciate the whole community for helping with PRs and help testing areas of Monux <3
