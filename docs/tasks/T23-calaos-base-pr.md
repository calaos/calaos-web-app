# T23 — calaos_base PR: consume the release asset

**Milestone**: M6 · **Deps**: T22 + first published release with asset · **Agent**: sonnet / medium effort / gh CLI

## Work
On `calaos/calaos_base`, replace the webapp block of the Dockerfile (~line 29) with:

```dockerfile
ARG WEBAPP_VERSION=<first released version>
RUN curl -fL https://github.com/calaos/calaos-web-app/releases/download/${WEBAPP_VERSION}/calaos-web-app-${WEBAPP_VERSION}.tar.gz --output webapp.tar.gz && \
    mkdir -p /opt/share/calaos/app && \
    tar xzf webapp.tar.gz -C /opt/share/calaos/app && \
    rm -f webapp.tar.gz
```

(`curl -f`: a 404 must fail the build, not package an error page.) Branch + PR via `gh`, description explaining the new delivery channel. Old tags (3.0.1) stay consumable the old way — no breakage.

## Acceptance criteria
- [ ] The release asset URL resolves (`curl -fL … | tar tz` lists index.html).
- [ ] Docker build of at least the `dev` stage through the webapp block proves the app lands in `/opt/share/calaos/app`.
- [ ] PR open on calaos/calaos_base with the rationale.
