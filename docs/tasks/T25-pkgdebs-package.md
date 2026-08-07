# T25 — calaos/pkgdebs PR: the calaos-web-app deb + calaos-server integration

**Milestone**: M7 · **Deps**: plan approval (independent of T24 code) · **Agent**: opus / high effort / gh + docker

## Goal
Add the `calaos-web-app` package to pkgdebs following the exact house conventions, make the `calaos-server` deb depend on it and bind-mount its files into the container, and open the PR. Must merge BEFORE the first calaos-web-app master push (the dispatch needs the directory to exist).

## Work (in a clone of calaos/pkgdebs)
1. `calaos-web-app/Makefile`: `VERSION?=1.0.0`, `PKGNAME?=calaos-web-app`, `TAG=$(subst ~,-,$(VERSION))` (build_deb delivers the DEBIANIZED version — `3.0.2~dev.0` — but the GitHub tag keeps the dash), `TARBALL_URL?=https://github.com/calaos/calaos-web-app/releases/download/$(TAG)/calaos-web-app-$(TAG).tar.gz`, `build:` (curl -fL into a staging dir + extract), `clean:`, `install:` → files under `$(DESTDIR)/usr/share/calaos/webapp`.
2. `calaos-web-app/debian/`: control (single Package stanza: calaos-web-app, Section admin, Priority optional, Arch all, Maintainer Calaos Team <team@calaos.fr>, Build-Depends `debhelper (>= 11), curl, ca-certificates`, Standards-Version 4.6.2, Homepage https://calaos.fr), rules (minimal dh), changelog (LITERAL `1.2.3` placeholder — hard build_deb constraint), compat `11`, copyright (DEP-5 GPL-3.0+ like calaos-server's), source/format `3.0 (native)`, lintian-overrides if lintian (which FAILS the build) complains.
3. `calaos-server/debian/control`: Depends becomes `podman, calaos-container, calaos-web-app`.
4. `calaos-server/debian/calaos-server.service`: add `-v /usr/share/calaos/webapp:/opt/share/calaos/app:ro \` to the podman run mounts (the remote-ui firmwares precedent).
5. `.github/workflows/build_deb_manual.yml`: add `calaos-web-app` to the pkgname options.
6. Local verification via the repo's own harness: `make build-calaos-web-app PKGVERSION=<x.y.z> IMAGE_SRC=""` with `TARBALL_URL` overridden to a local tarball (no asset published yet — build one from this repo's dist/ and expose it via file:// inside the /work mount). Inspect: `dpkg -c` shows /usr/share/calaos/webapp/index.html + assets/, lintian clean.
7. Branch + PR on calaos/calaos-web... calaos/pkgdebs via gh (direct branch if write access, fork fallback), PR body explaining the new delivery chain and the calaos-server coupling.

## Acceptance criteria
- [ ] Local deb builds through pkgdebs' own Docker harness; lintian clean; dpkg -c inventory correct.
- [ ] calaos-server changes are exactly the Depends line + the one mount line.
- [ ] PR open with clear description; no other packages touched.
