import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, normalize, relative, resolve } from "node:path";

const port = Number(process.env.PORT ?? 4173);
const publicRoot = resolve(process.cwd(), "public");

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8"
};

createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const requestPath = url.pathname === "/" ? "/debugger.html" : url.pathname;
  const filePath = resolve(publicRoot, normalize(requestPath).replace(/^[/\\]+/, ""));
  const relativePath = relative(publicRoot, filePath);

  if (relativePath.startsWith("..") || relativePath === "" || relativePath.includes(":")) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      response.writeHead(404).end("Not found");
      return;
    }

    response.writeHead(200, {
      "content-type": contentTypes[extname(filePath)] ?? "application/octet-stream",
      "cache-control": "no-store, must-revalidate"
    });
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404).end("Not found");
  }
}).listen(port, () => {
  console.log(`Cabin Pressure debugger: http://localhost:${port}`);
});
