FROM joseluisq/static-web-server:2

ENV SERVER_PORT 3000

COPY dist /public

EXPOSE 3000
