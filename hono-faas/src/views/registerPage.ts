export const registerPageHtml = `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>FaaS Register</title>
    <script src="https://unpkg.com/htmx.org@1.9.12"></script>
    <style>
      :root {
        color-scheme: light;
        --bg: #f6f0e8;
        --panel: #ffffff;
        --ink: #1d1a16;
        --accent: #f26b3a;
        --accent-dark: #cc4f24;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "Space Grotesk", "Avenir Next", "Gill Sans", sans-serif;
        background: radial-gradient(circle at 20% 20%, #fff2e0, #f6f0e8 55%, #efe2d1);
        color: var(--ink);
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 32px;
      }
      main {
        width: min(640px, 100%);
        background: var(--panel);
        border: 2px solid var(--ink);
        box-shadow: 10px 10px 0 var(--ink);
        padding: 28px;
      }
      h1 {
        margin: 0 0 8px;
        font-size: 28px;
        letter-spacing: 0.02em;
      }
      p {
        margin: 0 0 20px;
        color: #4c4034;
      }
      form {
        display: grid;
        gap: 16px;
      }
      label {
        display: grid;
        gap: 6px;
        font-weight: 600;
      }
      input, select {
        font: inherit;
        padding: 10px 12px;
        border: 2px solid var(--ink);
        background: #fffaf2;
      }
      textarea {
        font: inherit;
        padding: 10px 12px;
        border: 2px solid var(--ink);
        background: #fffaf2;
        resize: vertical;
      }
      button {
        font: inherit;
        padding: 12px 16px;
        border: 2px solid var(--ink);
        background: var(--accent);
        color: #ffffff;
        cursor: pointer;
        font-weight: 700;
        transition: transform 0.15s ease, background 0.15s ease;
      }
      button:hover {
        background: var(--accent-dark);
        transform: translate(-2px, -2px);
      }
      .result {
        margin-top: 16px;
        padding: 10px 12px;
        border: 2px solid var(--ink);
        font-weight: 600;
      }
      .result.success {
        background: #dff3e4;
      }
      .result.error {
        background: #fde0d9;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Function Register</h1>
      <p>Register a Bun function with the FaaS runtime.</p>
      <form hx-post="/register" hx-target="#result" hx-swap="innerHTML">
        <label>
          Function name
          <input name="name" placeholder="prime-count" required />
        </label>
        <label>
          Docker image
          <select name="image">
            <option value="oven/bun:canary-alpine">oven/bun:canary-alpine</option>
          </select>
        </label>
        <label>
          Handler code (handler.js)
          <textarea name="code" rows="8" placeholder="export default async function handler(event) {&#10;  return { statusCode: 200, body: 'ok' };&#10;}"></textarea>
        </label>
        <button type="submit">Register</button>
      </form>
      <div id="result" aria-live="polite"></div>
    </main>
  </body>
</html>`;
