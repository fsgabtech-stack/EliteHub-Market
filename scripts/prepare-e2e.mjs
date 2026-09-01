import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { promisify } from "node:util";

const executar = promisify(execFile);
const baseUrl = process.env.ELITEHUB_E2E_BASE_URL ?? "http://localhost:8001";
const dockerDesktop = process.env.LOCALAPPDATA
  ? join(process.env.LOCALAPPDATA, "Programs", "DockerDesktop", "resources", "bin", "docker.exe")
  : "";
const docker = process.platform === "win32" && existsSync(dockerDesktop) ? dockerDesktop : "docker";
const ambiente = {
  ...process.env,
  ELITEHUB_DEVELOPMENT_RESET: "enabled",
  ELITEHUB_DEVELOPMENT_SEED: "enabled",
  ...(dockerDesktop ? { PATH: `${dirname(dockerDesktop)}${delimiter}${process.env.PATH ?? ""}` } : {}),
};

async function garantirProntidao() {
  const limite = Date.now() + 60_000;
  let ultimoStatus = "sem resposta";
  while (Date.now() < limite) {
    try {
      const response = await fetch(`${baseUrl}/api/v1/ready`);
      if (response.ok) return;
      ultimoStatus = `HTTP ${response.status}`;
    } catch (error) {
      ultimoStatus = error instanceof Error ? error.name : "erro desconhecido";
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`A API do Compose não ficou pronta em 60 segundos: ${ultimoStatus}.`);
}

async function executarCompose(servico) {
  const resultado = await executar(docker, ["compose", "--profile", "ferramentas", "run", "--rm", servico], {
    cwd: process.cwd(),
    env: ambiente,
  });
  if (resultado.stdout) process.stdout.write(resultado.stdout);
  if (resultado.stderr) process.stderr.write(resultado.stderr);
}

async function construirFerramentasE2E() {
  const resultado = await executar(docker, ["compose", "--profile", "ferramentas", "build", "reset", "seed"], {
    cwd: process.cwd(),
    env: ambiente,
  });
  if (resultado.stdout) process.stdout.write(resultado.stdout);
  if (resultado.stderr) process.stderr.write(resultado.stderr);
}

export default async function prepararE2E() {
  await garantirProntidao();
  await construirFerramentasE2E();
  await executarCompose("reset");
  await executarCompose("seed");
  await garantirProntidao();
}
