# Requirements Document

## Introduction

This feature rewrites the existing Lambda functions (`increment` and `sse`) into a single Hono-based application deployed with Lambda Web Adapter. This enables 15-minute response streaming support via API Gateway REST API, removes Lambda-specific code dependencies, and improves application portability.

## Glossary

- **Hono_App**: A lightweight web framework application that handles HTTP routing and responses
- **Lambda_Web_Adapter**: An AWS-provided adapter that allows standard web applications to run on Lambda without Lambda-specific code
- **SSE_Handler**: The Server-Sent Events endpoint that streams counter updates to clients
- **Increment_Handler**: The endpoint that atomically increments the counter value in DynamoDB
- **Counter_Service**: The service layer responsible for DynamoDB operations (get/increment counter)
- **Docker_Container**: The container image built with Hono app and Lambda Web Adapter

## Requirements

### Requirement 1: Hono Application Structure

**User Story:** As a developer, I want a single Hono application that handles all API routes, so that I can maintain a portable codebase without Lambda-specific dependencies.

#### Acceptance Criteria

1. THE Hono_App SHALL expose a `GET /` endpoint that returns a health check response
2. THE Hono_App SHALL expose a `POST /api/increment` endpoint for counter increment operations
3. THE Hono_App SHALL expose a `GET /api/events` endpoint for SSE streaming
4. THE Hono_App SHALL NOT contain any Lambda-specific code (no `awslambda` global references)
5. THE Hono_App SHALL run on port 8080 by default for Lambda Web Adapter compatibility

### Requirement 2: Counter Increment Endpoint

**User Story:** As a user, I want to increment the counter by clicking a button, so that I can increase the shared counter value.

#### Acceptance Criteria

1. WHEN a POST request is received at `/api/increment`, THE Increment_Handler SHALL atomically increment the counter in DynamoDB using ADD operation
2. WHEN the increment succeeds, THE Increment_Handler SHALL return a JSON response with the new count value and HTTP status 200
3. IF a DynamoDB error occurs, THEN THE Increment_Handler SHALL return an error response with HTTP status 500
4. THE Increment_Handler SHALL include CORS headers in all responses

### Requirement 3: SSE Streaming Endpoint

**User Story:** As a user, I want to receive real-time counter updates via SSE, so that I can see changes made by other users immediately.

#### Acceptance Criteria

1. WHEN a GET request is received at `/api/events`, THE SSE_Handler SHALL establish an SSE connection with appropriate headers
2. THE SSE_Handler SHALL send the current counter value immediately upon connection
3. WHILE the SSE connection is open, THE SSE_Handler SHALL poll DynamoDB every 1 second for counter changes
4. WHEN the counter value changes, THE SSE_Handler SHALL send an SSE event with event name "counter" containing an HTML fragment `<div id="counter">{count}</div>`
5. THE SSE_Handler SHALL maintain the connection for up to 15 minutes (900 seconds)
6. IF a DynamoDB polling error occurs, THEN THE SSE_Handler SHALL log the error and continue polling

### Requirement 4: Counter Service Layer

**User Story:** As a developer, I want a clean service layer for DynamoDB operations, so that the code is testable and maintainable.

#### Acceptance Criteria

1. THE Counter_Service SHALL provide a `getCounterValue()` function that returns the current counter value from DynamoDB
2. THE Counter_Service SHALL provide an `incrementCounter()` function that atomically increments and returns the new value
3. WHEN no counter record exists, THE Counter_Service SHALL return 0 for `getCounterValue()`
4. THE Counter_Service SHALL use the `TABLE_NAME` environment variable for the DynamoDB table name

### Requirement 5: Docker Container Build

**User Story:** As a DevOps engineer, I want the Hono app packaged as a Docker container with Lambda Web Adapter, so that it can be deployed to Lambda with streaming support.

#### Acceptance Criteria

1. THE Docker_Container SHALL use a multi-stage build with Node.js for building and distroless for runtime
2. THE Docker_Container SHALL include the Lambda Web Adapter layer
3. THE Docker_Container SHALL set `AWS_LWA_INVOKE_MODE=response_stream` environment variable for streaming support
4. THE Docker_Container SHALL expose port 8080

### Requirement 6: CDK Infrastructure Updates

**User Story:** As a DevOps engineer, I want the CDK stack updated to deploy the containerized Hono app, so that I can leverage 15-minute streaming via API Gateway.

#### Acceptance Criteria

1. THE CDK_Stack SHALL deploy a single container Lambda function instead of two separate Node.js Lambdas
2. THE CDK_Stack SHALL configure the Lambda integration with `responseTransferMode: STREAM`
3. THE CDK_Stack SHALL set the Lambda timeout to 15 minutes (900 seconds)
4. THE CDK_Stack SHALL grant the Lambda function read/write access to the DynamoDB table
5. THE CDK_Stack SHALL configure API Gateway REST API with appropriate CORS settings
