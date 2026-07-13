FROM public.ecr.aws/docker/library/node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . ./src

EXPOSE 8080 9000

CMD ["node", "src/microvm-runtime.mjs"]


