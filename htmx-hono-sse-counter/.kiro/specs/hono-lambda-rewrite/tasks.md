# Implementation Plan: Hono Lambda Rewrite

## Overview

This plan converts the existing two Lambda functions into a single Hono-based application with Lambda Web Adapter support. Tasks are ordered to build incrementally, starting with the service layer, then routes, then Docker configuration, and finally CDK updates.

## Tasks

- [x] 1. Set up Hono application project structure
  - Create `src/hono-app/` directory with `package.json`, `tsconfig.json`
  - Install dependencies: `hono`, `@hono/node-server`, `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`
  - Install dev dependencies: `typescript`, `vitest`, `fast-check`, `aws-sdk-client-mock`
  - _Requirements: 1.1, 1.5_

- [x] 2. Implement Counter Service
  - [x] 2.1 Create `src/hono-app/src/services/counter.ts`
    - Implement `getCounterValue()` function that reads from DynamoDB
    - Implement `incrementCounter()` function with atomic ADD operation
    - Use `TABLE_NAME` environment variable
    - Return 0 when no record exists
    - _Requirements: 4.1, 4.2, 4.3, 4.4_
  - [ ]* 2.2 Write property test for Counter Service consistency
    - **Property 5: Counter Service Get/Set Consistency**
    - **Validates: Requirements 4.1, 4.2**

- [x] 3. Implement Increment Route
  - [x] 3.1 Create `src/hono-app/src/routes/increment.ts`
    - Handle `POST /increment` endpoint
    - Call `incrementCounter()` and return JSON response
    - Return 500 on errors with error message
    - _Requirements: 2.1, 2.2, 2.3_
  - [ ]* 3.2 Write property test for Increment Response Format
    - **Property 2: Increment Response Format**
    - **Validates: Requirements 2.2, 2.4**

- [x] 4. Implement SSE Events Route
  - [x] 4.1 Create `src/hono-app/src/routes/events.ts`
    - Handle `GET /events` endpoint with SSE streaming
    - Send initial counter value immediately on connection
    - Poll DynamoDB every 1 second and send updates on change
    - Format events as `event: counter\ndata: <div id="counter">{count}</div>\n\n`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_
  - [ ]* 4.2 Write property test for SSE Event Format
    - **Property 3: SSE Event Format**
    - **Validates: Requirements 3.1, 3.4**
  - [ ]* 4.3 Write property test for SSE Initial Value
    - **Property 4: SSE Initial Value**
    - **Validates: Requirements 3.2, 4.3**

- [x] 5. Create Hono App Entry Point
  - [x] 5.1 Create `src/hono-app/src/index.ts`
    - Initialize Hono app with CORS middleware
    - Add health check route `GET /` returning "OK"
    - Mount increment route at `/api`
    - Mount events route at `/api`
    - Start server on port 8080
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_
  - [ ]* 5.2 Write unit tests for endpoint routing
    - Test `GET /` returns 200 with "OK"
    - Test `POST /api/increment` is routed correctly
    - Test `GET /api/events` returns SSE headers
    - _Requirements: 1.1, 1.2, 1.3_

- [x] 6. Checkpoint - Verify Hono app works locally
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Create Dockerfile
  - [x] 7.1 Create `src/hono-app/Dockerfile`
    - Multi-stage build: Node.js builder → distroless runtime
    - Copy Lambda Web Adapter from `public.ecr.aws/awsguru/aws-lambda-adapter:0.8.4`
    - Set `AWS_LWA_INVOKE_MODE=response_stream`
    - Expose port 8080
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [x] 8. Update CDK Stack
  - [x] 8.1 Update `iac/htmx-hono-sse-counter-cdk/lib/const.ts`
    - Add `HONO_APP_ROOT` constant pointing to `src/hono-app`
    - _Requirements: 6.1_
  - [x] 8.2 Update `iac/htmx-hono-sse-counter-cdk/lib/htmx-hono-sse-counter-cdk-stack.ts`
    - Replace two Node.js Lambdas with single `DockerImageFunction`
    - Set timeout to 15 minutes (900 seconds)
    - Configure Lambda integration with `responseTransferMode: STREAM`
    - Grant read/write access to DynamoDB table
    - Update API Gateway routes to use proxy integration
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_
  - [ ]* 8.3 Update CDK snapshot tests
    - Verify infrastructure configuration matches expectations
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

- [-] 9. Clean up old Lambda code
  - [x] 9.1 Remove `src/lambda/increment/` directory
    - Delete old increment Lambda implementation
  - [-] 9.2 Remove `src/lambda/sse/` directory
    - Delete old SSE Lambda implementation

- [x] 10. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
