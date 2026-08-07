# T26 — calaos/calaos_base PR: Dockerfile fetches the release asset (supersedes T23)

**Milestone**: M7 · **Deps**: plan approval; merge gated on first published release · **Agent**: sonnet / medium effort / gh

## Goal
The Dockerfile's webapp block downloads the git-tag SOURCE archive and expects a committed dist/ — broken for any tag after dist/ left git. Switch it to the release ASSET with an overridable ARG. The embedded copy stays as the fallback for standalone Docker users; on Calaos-OS the calaos-web-app deb's bind-mount shadows it.

## Work (in a clone of calaos/calaos_base)
Replace the block (lines ~28-33) with:

```dockerfile
ARG WEBAPP_VERSION=3.1.0
RUN curl -fL https://github.com/calaos/calaos-web-app/releases/download/${WEBAPP_VERSION}/calaos-web-app-${WEBAPP_VERSION}.tar.gz --output webapp.tar.gz && \
    mkdir -p /opt/share/calaos/app && \
    tar xzf webapp.tar.gz -C /opt/share/calaos/app && \
    rm -f webapp.tar.gz
```

(`curl -f`: a 404 must fail the build.) Mind ARG scoping: the ARG must be declared in (or before) the stage that uses it. Open the PR as **DRAFT** with an explicit note: "do not merge until calaos-web-app release ${WEBAPP_VERSION} exists with its asset" — the default version will be finalized at merge time.

## Acceptance criteria
- [ ] The block is the only Dockerfile change; ARG scoping correct for the multi-stage layout.
- [ ] Draft PR open with the rationale (delivery decoupling, deb shadows via bind-mount) and the merge gate stated.
