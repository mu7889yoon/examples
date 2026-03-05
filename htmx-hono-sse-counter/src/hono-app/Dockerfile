# Build stage
FROM --platform=linux/arm64 public.ecr.aws/docker/library/node:24-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build


FROM --platform=linux/arm64 gcr.io/distroless/nodejs24-debian12
COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:0.9.1 /lambda-adapter /opt/extensions/lambda-adapter
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
ENV AWS_LWA_INVOKE_MODE=response_stream
ENV PORT=8080
EXPOSE 8080
CMD ["dist/index.js"]
