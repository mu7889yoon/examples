/**
 * Host-side Bedrock reverse proxy with AWS SDK SigV4 signing.
 *
 * Accepts unsigned HTTP requests from the VM on localhost, signs them
 * with host-side credentials using @smithy/signature-v4, and forwards
 * the raw HTTP response (including binary event streams) back to the VM.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { request as httpsRequest } from "node:https";
import { SignatureV4 } from "@smithy/signature-v4";
import { Sha256 } from "@aws-crypto/sha256-js";
import { HttpRequest } from "@smithy/protocol-http";

export interface BedrockProxyOptions {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  port?: number;
}

export interface BedrockProxy {
  port: number;
  close: () => Promise<void>;
}

export async function startBedrockProxy(
  options: BedrockProxyOptions,
): Promise<BedrockProxy> {
  const { region, accessKeyId, secretAccessKey, sessionToken } = options;
  const targetHost = `bedrock-runtime.${region}.amazonaws.com`;

  const signer = new SignatureV4({
    service: "bedrock",
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
      sessionToken,
    },
    sha256: Sha256,
  });

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", async () => {
      try {
        const body = Buffer.concat(chunks);
        const path = req.url ?? "/";

        // Build a smithy HttpRequest for signing
        const httpRequest = new HttpRequest({
          method: req.method ?? "POST",
          protocol: "https:",
          hostname: targetHost,
          port: 443,
          path,
          headers: {
            "content-type": req.headers["content-type"] ?? "application/json",
            host: targetHost,
          },
          body,
        });

        // Sign the request
        const signed = await signer.sign(httpRequest);

        // Forward to Bedrock with signed headers
        const proxyReq = httpsRequest(
          {
            hostname: targetHost,
            port: 443,
            path,
            method: req.method,
            headers: signed.headers,
          },
          (proxyRes) => {
            // Forward response as-is (including binary event stream)
            const responseHeaders: Record<string, string | string[]> = {};
            for (const [key, value] of Object.entries(proxyRes.headers)) {
              if (value !== undefined) {
                responseHeaders[key] = value as string | string[];
              }
            }
            res.writeHead(proxyRes.statusCode ?? 502, responseHeaders);
            proxyRes.pipe(res);
          },
        );

        proxyReq.on("error", (err) => {
          res.writeHead(502);
          res.end(`Proxy error: ${err.message}`);
        });

        if (body.length > 0) {
          proxyReq.write(body);
        }
        proxyReq.end();
      } catch (err: any) {
        res.writeHead(500);
        res.end(`Signing error: ${err.message}`);
      }
    });
  });

  return new Promise((resolve, reject) => {
    const port = options.port ?? 0;
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      const actualPort = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        port: actualPort,
        close: () => new Promise<void>((res) => server.close(() => res())),
      });
    });
    server.on("error", reject);
  });
}
