ARG build_arch=amd64

FROM multiarch/alpine:${build_arch}-v3.12

RUN addgroup -g 1000 node && adduser -u 1000 -G node -s /bin/sh -D node && apk add --no-cache nodejs

WORKDIR /home/node

COPY app.js package.json LICENSE /home/node/

RUN apk add --no-cache g++ git linux-headers make python3 eudev nodejs npm && \
    npm install && \
    apk del g++ git linux-headers make python3 npm


CMD [ "node", "." ]
