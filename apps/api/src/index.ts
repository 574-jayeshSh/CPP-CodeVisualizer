import http from "node:http";

import express from "express";
import cors from "cors";
import helmet from "helmet";
import { Server } from "socket.io";

import { config } from "./config.js";
import { errorHandler, notFoundHandler } from "./http.js";
import { authRouter } from "./routes/auth.routes.js";
import { projectRouter } from "./routes/project.routes.js";
import { compileRouter } from "./routes/compile.routes.js";
import { runRouter } from "./routes/run.routes.js";
import { setupSocket } from "./socket.js";

const app = express();

app.disable("x-powered-by");
app.use(helmet());
app.use(cors({ origin: config.corsOrigin, credentials: true }));
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    env: config.env,
    sandboxMode: config.sandboxMode,
    language: "cpp",
    std: config.compile.std,
  });
});

app.use("/api/auth", authRouter);
app.use("/api/projects", projectRouter);
app.use("/api/compile", compileRouter);
app.use("/api/run", runRouter);

app.use(notFoundHandler);
app.use(errorHandler);

const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: config.corsOrigin,
    credentials: true,
  },
  maxHttpBufferSize: 1e6,
});

setupSocket(io);

httpServer.listen(config.port, () => {
  console.log(`CodeLens API listening on http://localhost:${config.port}`);
  console.log(`CORS origin: ${config.corsOrigin}`);
});
