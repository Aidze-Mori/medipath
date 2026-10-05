import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readdir, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { resolveConfig } from 'vite';
import { digest, prepareAssets, projectRoot, readLocalFile } from './prepare-assets.mjs';
import { verifyBuild } from './verify-build.mjs';

const runFile = promisify(execFile);
async function run(command, args, cwd = projectRoot) {
  const result = await runFile(command, args, {
    cwd, maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, COPYFILE_DISABLE: '1' },
  });
  if (result.stderr.trim()) console.error(result.stderr.trim());
  return result.stdout;
}

async function filesIn(root, directory = '') {
  const files = [];
  for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
    const path = directory ? `${directory}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await filesIn(root, path));
    else if (entry.isFile()) files.push(path);
    else throw new Error(`Unsupported release entry: ${path}`);
  }
  return files.sort();
}

async function publish(path, bytes) {
  try {
    const existing = await lstat(path);
    if (!existing.isFile() || existing.isSymbolicLink() || existing.size && existing.blocks === 0) throw new Error(`Refusing to replace a nonregular or nonresident artifact: ${path}`);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
  await rename(temporary, path);
}

export async function packageRelease() {
  const stagingDirectory = await mkdtemp(join(process.platform === 'darwin' ? '/private/tmp' : tmpdir(), 'medipath-release-'));
  const staticRoot = join(stagingDirectory, 'dist');
  const serverPath = join(stagingDirectory, 'server.mjs');
  console.log(`Isolated release staging: ${stagingDirectory}`);
  const config = await resolveConfig({ root: projectRoot }, 'build');
  if (config.publicDir) throw new Error('Release requires publicDir:false for build; copying the public directory is forbidden.');
  await run(process.execPath, [resolve(projectRoot, 'node_modules/typescript/bin/tsc'), '--noEmit']);
  await run(process.execPath, [resolve(projectRoot, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', staticRoot, '--emptyOutDir', '--manifest']);
  await prepareAssets(staticRoot);
  const counts = await verifyBuild(staticRoot);
  const metafile = join(stagingDirectory, 'server-metafile.json');
  await run(resolve(projectRoot, 'node_modules/esbuild/bin/esbuild'), ['server/http.ts', '--bundle', '--platform=node', '--format=esm', '--packages=external', `--outfile=${serverPath}`, `--metafile=${metafile}`]);
  const serverMetadata = JSON.parse(await readLocalFile(metafile));
  const external = Object.values(serverMetadata.outputs).flatMap(output => output.imports ?? []).filter(item => item.external).map(item => item.path);
  if (external.some(path => !path.startsWith('node:'))) throw new Error(`Server requires an unpackaged dependency: ${external.filter(path => !path.startsWith('node:')).join(', ')}`);
  await run(process.execPath, ['--check', serverPath], stagingDirectory);
  const instructions = `# MediPath — локальный пакет для проверки

Требуется Node.js 22.13 или новее. Установка npm-зависимостей не нужна.
Запускайте команду из каталога с server.mjs и dist:

\`\`\`sh
node --env-file-if-exists=.env server.mjs
\`\`\`

Откройте http://127.0.0.1:3001/patient и http://127.0.0.1:3001/clinic.
Остановить сервер: Ctrl+C. Другой локальный порт:

\`\`\`sh
PORT=3010 node --env-file-if-exists=.env server.mjs
\`\`\`

По умолчанию доступны локальная обработка и учебные сценарии. Личные документы
обрабатываются в памяти вкладки, без отправки внешней модели. Онлайн-запись
и отправка сообщений в клинику не подключены.

Файл .env и ключи в архив не включены. Для отдельной проверки live учебных
примеров задайте OPENAI_API_KEY и OPENAI_MODEL в собственном .env; локальный
loopback-запуск дополнительно требует ALLOW_LOCAL_LIVE=1. Наличие этих
переменных не подтверждает успешное обращение к провайдеру.

Это локальный сборочный артефакт. Он не означает публикацию по HTTPS,
проверку на реальных телефонах или готовность к работе с реальными пациентами.
`;
  await writeFile(join(stagingDirectory, 'README.md'), instructions, 'utf8');
  const expectedFiles = ['README.md', 'server.mjs', ...(await filesIn(staticRoot)).map(path => `dist/${path}`)].sort();
  const expectedDirectories = new Set(['dist/']);
  for (const path of expectedFiles) {
    let directory = dirname(path);
    while (directory !== '.') { expectedDirectories.add(`${directory}/`); directory = dirname(directory); }
  }
  const stagedArchive = join(stagingDirectory, 'medipath-local-build.tar.gz');
  await run('tar', ['-czf', stagedArchive, '-C', stagingDirectory, 'dist', 'server.mjs', 'README.md']);
  const members = (await run('tar', ['-tzf', stagedArchive])).trim().split('\n').filter(Boolean);
  const expectedEntries = new Set([...expectedFiles, ...expectedDirectories]);
  if (new Set(members).size !== members.length || members.some(path => !expectedEntries.has(path)) || expectedFiles.some(path => !members.includes(path))) throw new Error('Archive content differs from the exact release allowlist.');
  const unpackedDirectory = await mkdtemp(join(stagingDirectory, 'roundtrip-'));
  await run('tar', ['-xzf', stagedArchive, '-C', unpackedDirectory]);
  const unpackedFiles = await filesIn(unpackedDirectory);
  if (JSON.stringify(unpackedFiles) !== JSON.stringify(expectedFiles)) throw new Error('Unpacked release file list changed.');
  for (const path of expectedFiles) {
    if (digest(await readLocalFile(join(stagingDirectory, path))) !== digest(await readLocalFile(join(unpackedDirectory, path)))) throw new Error(`Archive round-trip hash mismatch: ${path}`);
  }
  await verifyBuild(join(unpackedDirectory, 'dist'));
  await verifyBuild(staticRoot);
  const archiveBytes = await readLocalFile(stagedArchive);
  const archiveSha256 = digest(archiveBytes);
  const artifacts = resolve(projectRoot, 'artifacts');
  await mkdir(artifacts, { recursive: true });
  if ((await lstat(artifacts)).isSymbolicLink()) throw new Error('Artifacts directory cannot be a symlink.');
  const archivePath = join(artifacts, 'medipath-local-build.tar.gz');
  const receiptPath = join(artifacts, 'medipath-local-build.receipt.json');
  const receipt = {
    schemaVersion: 1, createdAt: new Date().toISOString(),
    archivePath, archiveSha256, archiveBytes: archiveBytes.length,
    stagingDirectory, staticRoot, serverPath, unpackedDirectory,
    counts: { ...counts, archiveFiles: expectedFiles.length },
    verification: { exactBuildAllowlist: true, archiveRoundTrip: true, staticAndRoundTripHashes: true, serverSyntax: true, serverExternalImports: [...new Set(external)].sort(), productionSmoke: false, hosted: false },
  };
  await publish(archivePath, archiveBytes);
  if (digest(await readLocalFile(archivePath)) !== archiveSha256) throw new Error('Published archive hash mismatch.');
  await publish(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ receiptPath, ...receipt }, null, 2));
  return receipt;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  packageRelease().catch(error => { console.error(error.message); process.exitCode = 1; });
}
