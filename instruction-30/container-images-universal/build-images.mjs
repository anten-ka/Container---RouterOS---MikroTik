#!/usr/bin/env node
/*
 * Build RouterOS-compatible docker-archive images without modifying or
 * inheriting the original project images. The runtime is assembled from an
 * explicit set of digest-pinned Alpine APK payloads, our reviewed entrypoint,
 * and a reproducibly compiled sing-box binary. The result is one squashed
 * layer: no apk database/tools, no OpenSSL, and no inherited stale files.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Archive bytes must not depend on the caller's shell umask. APK payload modes
// are preserved separately with tar -p; generated files are chmod'ed below.
process.umask(0o022);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const VERSION = '1.13.12';
const SOURCE_COMMIT = '1086ab2563320e0da0c23b3a491d8dfa0939dff4';
const SOURCE_SHA256 = '8b0d61adec28a16dbc3fc346bb82ab36fd64b879c9531be5e82c6b2af7582649';
const GO_VERSION = '1.26.5';
const GO_ARCHIVE_SHA256 = 'efb87ff28af9a188d0536ef5d42e63dd52ba8263cd7344a993cc48dd11dedb6a';
const BUILD_TAGS = 'with_utls,badlinkname,tfogo_checklinkname0';
const ALPINE_RELEASE = '3.22.5';
const ALPINE_REPOSITORY = 'https://dl-cdn.alpinelinux.org/alpine/v3.22/main';

const ALPINE_PACKAGE_VERSIONS = {
  'alpine-release': '3.22.5-r0',
  'apk-tools': '2.14.10-r0',
  'busybox': '1.37.0-r20',
  'busybox-binsh': '1.37.0-r20',
  'ca-certificates-bundle': '20260611-r0',
  'iproute2-minimal': '6.15.0-r0',
  'iptables': '1.8.11-r1',
  'iptables-legacy': '1.8.11-r1',
  'libapk2': '2.14.10-r0',
  'libcap2': '2.78-r0',
  'libcrypto3': '3.5.7-r0',
  'libelf': '0.193-r0',
  'libip4tc': '1.8.11-r1',
  'libip6tc': '1.8.11-r1',
  'libmnl': '1.0.5-r2',
  'libssl3': '3.5.7-r0',
  'libxtables': '1.8.11-r1',
  'musl': '1.2.5-r12',
  'musl-utils': '1.2.5-r12',
  'ssl_client': '1.37.0-r20',
  'zlib': '1.3.2-r0',
  'zstd-libs': '1.5.7-r0'
};
const RUNTIME_PACKAGE_NAMES = [
  'busybox', 'busybox-binsh', 'ca-certificates-bundle', 'iproute2-minimal',
  'iptables', 'iptables-legacy', 'libcap2', 'libelf', 'libip4tc',
  'libip6tc', 'libmnl', 'libxtables', 'musl', 'zlib', 'zstd-libs'
];
const REMOVED_RUNTIME_COMPONENTS = [
  'apk-tools', 'libapk2', 'libcrypto3', 'libssl3', 'musl-utils',
  'scanelf', 'ssl_client', 'alpine-keys'
];

const ALPINE_PACKAGE_SHA256 = {
  aarch64: {
    'alpine-release': '8eefcc8d5ba44f2e9c843153e3c7ccb8c8fb4b2f3194a8d064b91df83539ff88',
    'apk-tools': 'd26e8d1580fa3b269e13e14cbbef1b02fefaae82eae62a6a6d4b095dcdee44a7',
    'busybox': '9d25af67564c92a4a4c603462efdbcd23019e90b8785f1ebcad640cbb1551c93',
    'busybox-binsh': '9180dcee3f67ea806fe45361cffab94f8ce7e417d5f373bb0d989e88eb609903',
    'ca-certificates-bundle': 'ae45c92eba28db3434058980c40930d3653663e5251cb04c9fd49a94ca00c93b',
    'iproute2-minimal': 'ce97b56e3fc4f0e9a38fdd82f94eb44bfa24d60be62dfee997b74b0f0b9cc75d',
    'iptables': '0a10fe634e3525082a1219487cd044d987ac4a55ed5aa551bf758e81223e1cfb',
    'iptables-legacy': '8beced6a354697e50014e2cebe0dcea3dc65d2dbbb708006a149999b3b029919',
    'libapk2': '6916d576d614a395c25095d538ecd2918c7fbdaf0c353d14b03896bee49ee849',
    'libcap2': 'de209aee8b76946849bff6bd97151c6af20889be5a96a2e28f9899255e252e3f',
    'libcrypto3': '40ab7ff1979ab730961f2a678b11f93ca5a00b40c8f2dadefff9d85ae0e5bec5',
    'libelf': 'cbc2cbd52e27a381f17892392417fecfbeaba354479d3acd923cf57967d1b25a',
    'libip4tc': '6418c50ff5287f6aca02ba7d8baab7cfe729a898793c9a8856cf8975b3f759c2',
    'libip6tc': '48ec17436d0e6fd754c8eb50862b5604e86e80ac7d19d7c7a48f9f622f305306',
    'libmnl': '213a7e87553bed3d9159b2e74d2627885c259883e61714b357949ca806eb1f8d',
    'libssl3': '8313f54b1bdb54b8ff88fac1e26f2d99bc28853c0fbcecce43f4bd5fdd2fadba',
    'libxtables': 'e84f0d6b69d4318f297056d00ccbe433e6c7d163fe6767405e373248c42e3e88',
    'musl': 'ac281d1e7f9e9c447c51e309317b975f48be6edaf3ab91ae73b959cf86703782',
    'musl-utils': '8469328fd69584a3d87b29d676ea3a284f9751896ae7ae3ec1073aaa11a03541',
    'ssl_client': 'f8196e626e8fd0b22198e279ef910bbe6847625281eb1f75a75d82ebee4865e3',
    'zlib': '7a39a917e4dab3c7a45537210ee5b5f17bf75f5e7777809a20cddd0afe074187',
    'zstd-libs': 'a0e92d2225941a514eb0b2325b137fe6444ef9171627aae8129b74a6ad934ac4'
  },
  armv7: {
    'alpine-release': '74189fa3f1ce3bc39966857b67b83b89ea77b54891d344d90ce115eb00bd28bf',
    'apk-tools': '11c88910e77bf692673f46835cf81716b644c15dfeea3ae539ce8ee39ba24597',
    'busybox': '3e3cd31e1167879c2c64bd1f10676242a34af2c7ab05645c0fe41cc12637b875',
    'busybox-binsh': '5b6a175835dce1b12c98b58463e4fe1efdbdebf3de411bcd42688888c2266b14',
    'ca-certificates-bundle': '60d8e2e39855a57f1201006b8a618cd463258db52ecfd6722674534f57c79e4a',
    'iproute2-minimal': 'af60e08ee582ccfe45a75b72d21927f108b30daa8a7e8ceee118f28acf8c387b',
    'iptables': '76f87f183595bcd5c5a328a1982d012b1e3be504bdeea72466c2be384f6ec9d4',
    'iptables-legacy': '8d9563ec504b5f30b30c462f8e13747800c4d967d22ca513480896114e816078',
    'libapk2': 'a69a6a36dd2654871599fb6697f94694bfd06ef3f475af95d2a815c729e05994',
    'libcap2': '25647748b846824e5f3768e0cf9bedab1742301cdaf88de08d806cb0c2424737',
    'libcrypto3': '16aa324a19d2ed64ff866068834d93ad6e417d578aa0a736464f46ba5507e646',
    'libelf': '4a58d0872c0ea089f8176ed5ea792712a34c9d9a4c04d257e7695945fbe8e629',
    'libip4tc': 'c3c1eca09995fa750a3da69c025542ff9c893acfb9ac886bc98839f144c67b40',
    'libip6tc': '13486e0a9c4fd7f97b0ce96b7c6306a2a6abd6bd574ef57be8aa0ec3639f40ea',
    'libmnl': 'c47b6ce56ed23d0a738f1db78551e1917f689ea01c8b4b00ec338ff8c7948db4',
    'libssl3': 'fe98b573abc9c5039b590689a17a918e73ad8aebe5231b42aa5f98125b1d2348',
    'libxtables': '6b852daca511e5c6e079e134a3cb6b2f5591051dca05a7c9562e486aad9e9a80',
    'musl': '28f1755c96ea4edc5e7c9feca84e47ab1659c7aedc755c670494aadbd569c8c9',
    'musl-utils': '9afb59ed83c4aa4ed507376331d88ea44053f1827c339e458df8075ac0aef784',
    'ssl_client': 'd88e1ef6c48e7352deac79a4f33f018f3abece66779072e10ef225a884bf5eb5',
    'zlib': 'f53281803a3ba31b97d900875587b0d793bb1b0f3c37d6b00a522e3544d81de0',
    'zstd-libs': '739d12b00c10623f92b5212066b98a89090a788df36095bac58256c763c54b03'
  },
  x86_64: {
    'alpine-release': '0b38cc5b0c5ba92cd62e11ff4db17d3877b94c31fa42582cc1180739edbf8e65',
    'apk-tools': '6d915a6ec2682fda0e850569919ddcb094d8def4ac52a94f2e7371cde06db218',
    'busybox': '7cc34c2dda2520b456ab4a55abc37fe245ac90f98ab9f1c7a9be3aec035df48e',
    'busybox-binsh': 'ad33d8d799ed80eab45bb68d63c14062165d3653f4fb52e73959cd31d032210e',
    'ca-certificates-bundle': 'a18fd1bd8bea03966ee5719aa61e44d9a810db2c8b6641b45f92b30e860f0927',
    'iproute2-minimal': 'fb761fe0df9d23926d20d9ef5d5ca3a6ba08338b16ce26beb02305eba5733382',
    'iptables': 'defe876173d08fe30b664b2d9f60d0237298a639e3a7d0e3f83ac637fd6519db',
    'iptables-legacy': 'aebfc932aa2e3b27e4895250aa4b73ead107116a3e8cd33ebf2d4036e46c043e',
    'libapk2': 'b7b8ccfeaf2396cf022e685b11365be682b3b97c074d4e2a9d73c67f5beec07d',
    'libcap2': '9850759bbb16f1ff6d1a49dc99947ef1401e1c10e5ca24f8380e69ba19f077c9',
    'libcrypto3': '4ae7959ca1501c78437ee8250a624e2149405955b05abe94f8cf68358ded05e9',
    'libelf': 'b8df03bd86f172aa1741790592056e6d6588247ddf6473920fa32cd7cc681f6a',
    'libip4tc': '3ca5cd36732d59374d970d937f781469969bf668ff5eb65207892f7cfcd27f02',
    'libip6tc': 'dc0e2aa34b2454bce4c8f6860484925fd6e5bea8eeb24e53d4b9526a24ed4c2c',
    'libmnl': 'e9dc63c95a0c8a263dc7f0705e6f7a2220d632a675ce85db798d33a40b1c1b0b',
    'libssl3': 'a3c2fa13023e88bf4f8dfe0e8847dcc1e2c1170be99969d761733e92b80dffa8',
    'libxtables': '5367f1f5c309a0aeede0a08d73af717f582f7a135ff97080aa0e5b7c72fd97af',
    'musl': '4990a5e0ba312e478f94cfe431a70efef1538004eb361c8ae424516848be45bb',
    'musl-utils': 'ee17c4904a3fbbee1e7451465ad5e61c16a3dc6f38dba6c8d61f1bc0e67ee31d',
    'ssl_client': '11b2a5f91caf8eb5daa9a0bc2586f93545de62897f3a704fd49533e1654b7a68',
    'zlib': '1f3d5f463f490dad3a68097376711bfe5e8156e9e8daff3070513aa4378cdeca',
    'zstd-libs': '1bdd6e57cfbfbfd6e8481cad37ddd5d199950715bec1879b3afb600272dbb09e'
  }
};
const CREATED = new Date('2026-07-09T00:00:00Z');
const CREATED_ISO = CREATED.toISOString();
const LICENSE_URL = `https://raw.githubusercontent.com/SagerNet/sing-box/v${VERSION}/LICENSE`;
const LICENSE_SHA256 = '650d5e3b99a446fb38e820fa87a49562e0c79eab868fff58618ac487a58e554c';
const ENTRYPOINT_FILE = path.join(HERE, 'entrypoint.sh');

const TARGETS = [
  {
    outputArch: 'arm64', goArch: 'arm64', dockerArch: 'arm64', alpineArch: 'aarch64'
  },
  {
    outputArch: 'arm', goArch: 'arm', goArm: '7', dockerArch: 'arm', dockerVariant: 'v7', alpineArch: 'armv7'
  },
  {
    outputArch: 'x86_64', goArch: 'amd64', dockerArch: 'amd64', alpineArch: 'x86_64'
  }
];

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', stdio: options.capture ? 'pipe' : 'inherit', ...options });
  if (result.status !== 0) {
    throw new Error(`${cmd} failed (${result.status}): ${result.stderr || ''}`.trim());
  }
  return result.stdout || '';
}

function sha256File(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(1024 * 1024);
  try {
    for (;;) {
      const read = fs.readSync(fd, buf, 0, buf.length, null);
      if (!read) break;
      hash.update(buf.subarray(0, read));
    }
  } finally { fs.closeSync(fd); }
  return hash.digest('hex');
}

function sha256Text(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value));
  fs.chmodSync(file, 0o644);
  fs.utimesSync(file, CREATED, CREATED);
}

function fetchPinned(url, dest, expected) {
  run('curl', ['-fL', '--retry', '3', '--connect-timeout', '20', '--output', dest, url]);
  const actual = sha256File(dest);
  if (actual !== expected) throw new Error(`digest mismatch for ${url}: expected ${expected}, got ${actual}`);
}

function prepareAlpinePackages(downloadDir) {
  const byTarget = new Map();
  for (const target of TARGETS) {
    const archDir = path.join(downloadDir, 'alpine', target.alpineArch);
    fs.mkdirSync(archDir, { recursive: true, mode: 0o755 });
    const packages = [];
    for (const name of RUNTIME_PACKAGE_NAMES) {
      const version = ALPINE_PACKAGE_VERSIONS[name];
      const expected = ALPINE_PACKAGE_SHA256[target.alpineArch]?.[name];
      if (!expected) throw new Error(`missing Alpine digest for ${target.alpineArch}/${name}`);
      const filename = `${name}-${version}.apk`;
      const file = path.join(archDir, filename);
      if (!fs.existsSync(file) || sha256File(file) !== expected) {
        fetchPinned(`${ALPINE_REPOSITORY}/${target.alpineArch}/${filename}`, file, expected);
      }
      packages.push({ name, version, sha256: expected, filename, file });
    }
    byTarget.set(target.outputArch, packages);
  }
  return byTarget;
}

function firstDirectory(dir) {
  const found = fs.readdirSync(dir, { withFileTypes: true }).find(ent => ent.isDirectory());
  if (!found) throw new Error(`no extracted directory in ${dir}`);
  return path.join(dir, found.name);
}

function prepareBuild(downloadDir) {
  const goArchive = path.join(downloadDir, `go${GO_VERSION}.darwin-arm64.tar.gz`);
  if (!fs.existsSync(goArchive) || sha256File(goArchive) !== GO_ARCHIVE_SHA256) {
    fetchPinned(`https://go.dev/dl/go${GO_VERSION}.darwin-arm64.tar.gz`, goArchive, GO_ARCHIVE_SHA256);
  }
  const sourceArchive = path.join(downloadDir, `sing-box-${SOURCE_COMMIT}.tar.gz`);
  if (!fs.existsSync(sourceArchive) || sha256File(sourceArchive) !== SOURCE_SHA256) {
    fetchPinned(`https://github.com/SagerNet/sing-box/archive/${SOURCE_COMMIT}.tar.gz`, sourceArchive, SOURCE_SHA256);
  }

  // Never trust an extracted/cached source tree or toolchain. Every invocation
  // builds in a fresh directory from the two archives verified above.
  const cleanRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vless-routeros-clean-build-'));
  const goExtract = path.join(cleanRoot, 'toolchain');
  const sourceExtract = path.join(cleanRoot, 'source');
  const cacheRoot = path.join(cleanRoot, 'go-cache');
  const buildDir = path.join(cleanRoot, 'bin');
  for (const dir of [goExtract, sourceExtract, path.join(cacheRoot, 'mod'), path.join(cacheRoot, 'build'), buildDir]) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
  }
  run('tar', ['-xzf', goArchive, '-C', goExtract]);
  run('tar', ['-xzf', sourceArchive, '-C', sourceExtract]);
  const goRoot = path.join(goExtract, 'go');
  const goBin = path.join(goRoot, 'bin/go');
  const sourceDir = firstDirectory(sourceExtract);
  if (!fs.existsSync(goBin) || !fs.existsSync(path.join(sourceDir, 'go.mod'))) {
    fs.rmSync(cleanRoot, { recursive: true, force: true });
    throw new Error('verified Go toolchain or sing-box source did not extract as expected');
  }
  const commonEnv = {
    ...process.env,
    PATH: `${path.dirname(goBin)}:${process.env.PATH || ''}`,
    GOENV: 'off',
    GOWORK: 'off',
    GOFLAGS: '',
    GOEXPERIMENT: '',
    GOAMD64: 'v1',
    GOARM64: 'v8.0',
    GOARM: '',
    GOTOOLCHAIN: 'local',
    GOMODCACHE: path.join(cacheRoot, 'mod'),
    GOCACHE: path.join(cacheRoot, 'build'),
    GOPROXY: 'https://proxy.golang.org,direct',
    GOSUMDB: 'sum.golang.org',
    CGO_ENABLED: '0',
    GOOS: 'linux'
  };

  const binaries = new Map();
  for (const target of TARGETS) {
    const output = path.join(buildDir, `sing-box-${VERSION}-${target.outputArch}`);
    const env = { ...commonEnv, GOARCH: target.goArch };
    if (target.goArm) env.GOARM = target.goArm;
    run(goBin, [
      'build', '-trimpath', '-tags', BUILD_TAGS,
      '-ldflags', `-X github.com/sagernet/sing-box/constant.Version=${VERSION} -X internal/godebug.defaultGODEBUG=multipathtcp=0 -checklinkname=0 -s -w -buildid=`,
      '-o', output, './cmd/sing-box'
    ], { cwd: sourceDir, env });
    fs.chmodSync(output, 0o755);
    const fileInfo = run('file', ['-b', output], { capture: true }).trim();
    if (!/statically linked/i.test(fileInfo)) throw new Error(`non-static output for ${target.outputArch}: ${fileInfo}`);
    const goVersionInfo = run(goBin, ['version', '-m', output], { capture: true });
    if (!goVersionInfo.includes(`-tags=${BUILD_TAGS}`)) throw new Error(`unexpected build tags for ${target.outputArch}`);
    binaries.set(target.outputArch, {
      file: output,
      sha256: sha256File(output),
      bytes: fs.statSync(output).size,
      fileInfo,
      goVersionInfo
    });
  }
  return { goBin, sourceDir, binaries, cleanup: () => removeReadOnlyTree(cleanRoot) };
}

function setTreeMtimePreserveModes(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    const stat = fs.lstatSync(full);
    if (stat.isSymbolicLink()) {
      if (typeof fs.lutimesSync === 'function') fs.lutimesSync(full, CREATED, CREATED);
    } else {
      if (stat.isDirectory()) setTreeMtimePreserveModes(full);
      fs.utimesSync(full, CREATED, CREATED);
    }
  }
  fs.utimesSync(dir, CREATED, CREATED);
}

function isApkControlPath(name) {
  const top = name.replace(/^\.\//, '').split('/')[0];
  return /^\.(?:SIGN\.|PKGINFO$|pre-|post-|trigger$)/.test(top);
}

function overlayPinnedRuntimePackages(root, packages) {
  const owners = new Map();
  for (const pkg of packages) {
    const entries = run('tar', ['-tf', pkg.file], { capture: true }).split(/\r?\n/).filter(Boolean);
    for (const raw of entries) {
      const rel = raw.replace(/^\.\//, '').replace(/\/$/, '');
      if (!rel || isApkControlPath(rel)) continue;
      if (!owners.has(rel)) owners.set(rel, new Set());
      owners.get(rel).add(pkg.name);
    }
    run('tar', ['-xpf', pkg.file, '-C', root]);
  }
  for (const name of fs.readdirSync(root)) {
    if (isApkControlPath(name)) fs.rmSync(path.join(root, name), { recursive: true, force: true });
  }
  return owners;
}

function describePath(root, rel, sourcePackages) {
  const full = path.join(root, rel);
  const stat = fs.lstatSync(full);
  const base = { path: rel, mode: `0${(stat.mode & 0o7777).toString(8)}`, sourcePackages: [...sourcePackages].sort() };
  if (stat.isSymbolicLink()) return { ...base, type: 'symlink', linkTarget: fs.readlinkSync(full) };
  if (stat.isDirectory()) return { ...base, type: 'directory' };
  if (stat.isFile()) return { ...base, type: 'file', sha256: sha256File(full), bytes: stat.size };
  return { ...base, type: 'other' };
}

function pathExists(file) {
  try { fs.lstatSync(file); return true; } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function readElfInterpreter(file) {
  const bytes = fs.readFileSync(file);
  if (bytes.length < 64 || bytes[0] !== 0x7f || bytes.subarray(1, 4).toString() !== 'ELF') return null;
  const elfClass = bytes[4];
  const little = bytes[5] === 1;
  if ((elfClass !== 1 && elfClass !== 2) || (!little && bytes[5] !== 2)) throw new Error(`unsupported ELF header: ${file}`);
  const u16 = offset => little ? bytes.readUInt16LE(offset) : bytes.readUInt16BE(offset);
  const u32 = offset => little ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset);
  const u64 = offset => Number(little ? bytes.readBigUInt64LE(offset) : bytes.readBigUInt64BE(offset));
  const phoff = elfClass === 2 ? u64(32) : u32(28);
  const phentsize = u16(elfClass === 2 ? 54 : 42);
  const phnum = u16(elfClass === 2 ? 56 : 44);
  for (let index = 0; index < phnum; index++) {
    const offset = phoff + index * phentsize;
    if (offset + phentsize > bytes.length) throw new Error(`truncated ELF program headers: ${file}`);
    if (u32(offset) !== 3) continue; // PT_INTERP
    const valueOffset = elfClass === 2 ? u64(offset + 8) : u32(offset + 4);
    const valueLength = elfClass === 2 ? u64(offset + 32) : u32(offset + 16);
    if (valueOffset + valueLength > bytes.length) throw new Error(`truncated ELF interpreter: ${file}`);
    return bytes.subarray(valueOffset, valueOffset + valueLength).toString().replace(/\0.*$/, '');
  }
  return '';
}

function verifyElfClosure(root) {
  const regular = [];
  const available = new Set();
  const walk = current => {
    for (const ent of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, ent.name);
      const stat = fs.lstatSync(full);
      available.add(ent.name);
      if (stat.isDirectory()) walk(full);
      else if (stat.isFile()) regular.push(full);
      else if (stat.isSymbolicLink()) {
        const target = fs.readlinkSync(full);
        const resolved = target.startsWith('/') ? path.join(root, target.slice(1)) : path.resolve(path.dirname(full), target);
        if (!resolved.startsWith(root + path.sep) || !fs.existsSync(resolved)) throw new Error(`broken/outside symlink: ${path.relative(root, full)} -> ${target}`);
      }
    }
  };
  walk(root);
  let elfCount = 0;
  for (const file of regular) {
    const interpreter = readElfInterpreter(file);
    if (interpreter === null) continue;
    elfCount++;
    if (interpreter) {
      if (!interpreter.startsWith('/')) throw new Error(`non-absolute ELF interpreter for ${path.relative(root, file)}: ${interpreter}`);
      const interpreterFile = path.join(root, interpreter.slice(1));
      if (!pathExists(interpreterFile)) throw new Error(`missing ELF interpreter ${interpreter} for ${path.relative(root, file)}`);
    }
    const result = spawnSync('objdump', ['-p', file], { encoding: 'utf8' });
    if (result.status !== 0 || !/file format elf/i.test(result.stdout || '')) {
      throw new Error(`objdump could not inspect ELF ${path.relative(root, file)}: ${result.stderr || ''}`.trim());
    }
    for (const match of (result.stdout || '').matchAll(/\bNEEDED\s+(\S+)/g)) {
      if (!available.has(match[1])) throw new Error(`missing ELF dependency ${match[1]} for ${path.relative(root, file)}`);
    }
  }
  if (!elfCount) throw new Error('no ELF files found in runtime rootfs');
  return elfCount;
}

function ensureDirectory(root, rel, mode, generated) {
  let current = root;
  let currentRel = '';
  for (const part of rel.split('/').filter(Boolean)) {
    current = path.join(current, part);
    currentRel = currentRel ? `${currentRel}/${part}` : part;
    if (!pathExists(current)) {
      fs.mkdirSync(current, { mode });
      generated.add(currentRel);
    }
  }
  fs.chmodSync(path.join(root, rel), mode);
}

function writeGeneratedFile(root, rel, contents, mode, generated) {
  ensureDirectory(root, path.dirname(rel), 0o755, generated);
  const full = path.join(root, rel);
  fs.writeFileSync(full, contents);
  fs.chmodSync(full, mode);
  generated.add(rel);
}

function createGeneratedSymlink(root, rel, target, generated) {
  ensureDirectory(root, path.dirname(rel), 0o755, generated);
  const full = path.join(root, rel);
  if (pathExists(full)) fs.rmSync(full, { recursive: true, force: true });
  fs.symlinkSync(target, full);
  generated.add(rel);
}

function createBusyboxApplets(root, generated) {
  const manifest = path.join(root, 'etc/busybox-paths.d/busybox');
  if (!fs.existsSync(manifest)) throw new Error('BusyBox applet manifest missing from pinned APK');
  for (const rel of fs.readFileSync(manifest, 'utf8').split(/\r?\n/).map(x => x.trim()).filter(Boolean)) {
    if (rel.startsWith('/') || rel.includes('..')) throw new Error(`unsafe BusyBox applet path: ${rel}`);
    const full = path.join(root, rel);
    if (!pathExists(full)) createGeneratedSymlink(root, rel, '/bin/busybox', generated);
  }
}

function prepareMinimalRuntime(root, packages, binary, licenseFile, entrypointFile, target) {
  fs.mkdirSync(root, { recursive: true, mode: 0o755 });
  fs.chmodSync(root, 0o755);
  const apkOwners = overlayPinnedRuntimePackages(root, packages);
  const generated = new Set();
  const discardedPayloadPaths = new Set();

  // The iptables APK supplies the extension modules required by legacy
  // REDIRECT/tcp rules, but its nft frontends are deliberately discarded.
  for (const [rel, owners] of apkOwners) {
    if (owners.has('iptables') && rel.startsWith('usr/sbin/') && pathExists(path.join(root, rel))) {
      fs.rmSync(path.join(root, rel), { recursive: true, force: true });
      discardedPayloadPaths.add(rel);
    }
  }
  const requiredXtablesPlugins = new Set([
    'libxt_tcp.so', 'libxt_standard.so', 'libxt_NAT.so', 'libxt_REDIRECT.so'
  ]);
  for (const [rel, owners] of apkOwners) {
    if (owners.has('iptables') && rel.startsWith('usr/lib/xtables/') && !requiredXtablesPlugins.has(path.basename(rel))) {
      if (pathExists(path.join(root, rel))) fs.rmSync(path.join(root, rel), { recursive: true, force: true });
      discardedPayloadPaths.add(rel);
    }
  }
  fs.rmSync(path.join(root, 'usr/bin/iptables-xml'), { force: true });
  discardedPayloadPaths.add('usr/bin/iptables-xml');
  for (const rel of ['lib/apk', 'etc/apk', 'var/cache/apk', 'sbin/apk', 'usr/share/apk']) {
    fs.rmSync(path.join(root, rel), { recursive: true, force: true });
  }

  createBusyboxApplets(root, generated);
  createGeneratedSymlink(root, 'usr/sbin/iptables', '/usr/sbin/iptables-legacy', generated);
  createGeneratedSymlink(root, 'usr/sbin/iptables-save', '/usr/sbin/iptables-legacy-save', generated);
  createGeneratedSymlink(root, 'usr/sbin/iptables-restore', '/usr/sbin/iptables-legacy-restore', generated);

  for (const [rel, mode] of [
    ['dev', 0o755], ['proc', 0o555], ['sys', 0o555], ['run', 0o755],
    ['tmp', 0o1777], ['var/tmp', 0o1777], ['root', 0o700], ['etc/sing-box', 0o755],
    ['usr/share/licenses/sing-box', 0o755], ['usr/share/vless-routeros', 0o755]
  ]) ensureDirectory(root, rel, mode, generated);
  createGeneratedSymlink(root, 'var/run', '/run', generated);

  writeGeneratedFile(root, 'etc/alpine-release', `${ALPINE_RELEASE}\n`, 0o644, generated);
  writeGeneratedFile(root, 'etc/os-release', `NAME="Alpine Linux"\nID=alpine\nVERSION_ID=${ALPINE_RELEASE}\nPRETTY_NAME="Alpine Linux v${ALPINE_RELEASE}"\nHOME_URL="https://alpinelinux.org/"\n`, 0o644, generated);
  writeGeneratedFile(root, 'etc/passwd', 'root:x:0:0:root:/root:/bin/sh\nnobody:x:65534:65534:nobody:/:/sbin/nologin\n', 0o644, generated);
  writeGeneratedFile(root, 'etc/group', 'root:x:0:\nnogroup:x:65534:\n', 0o644, generated);
  writeGeneratedFile(root, 'etc/hosts', '127.0.0.1 localhost\n::1 localhost\n', 0o644, generated);
  writeGeneratedFile(root, 'etc/resolv.conf', '', 0o644, generated);

  const entrypointTarget = path.join(root, 'entrypoint.sh');
  fs.copyFileSync(entrypointFile, entrypointTarget);
  fs.chmodSync(entrypointTarget, 0o755);
  generated.add('entrypoint.sh');
  run('/bin/sh', ['-n', entrypointFile]);
  const binaryTarget = path.join(root, 'bin/sing-box');
  fs.copyFileSync(binary.file, binaryTarget);
  fs.chmodSync(binaryTarget, 0o755);
  generated.add('bin/sing-box');
  const licenseTarget = path.join(root, 'usr/share/licenses/sing-box/LICENSE');
  fs.copyFileSync(licenseFile, licenseTarget);
  fs.chmodSync(licenseTarget, 0o644);
  generated.add('usr/share/licenses/sing-box/LICENSE');
  writeGeneratedFile(root, 'usr/share/sing-box-version', `${VERSION}\n`, 0o644, generated);

  const retainedApkPayload = [];
  const discardedApkPayload = [];
  for (const [rel, owners] of [...apkOwners.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (!discardedPayloadPaths.has(rel) && pathExists(path.join(root, rel))) retainedApkPayload.push(describePath(root, rel, owners));
    else discardedApkPayload.push({ path: rel, sourcePackages: [...owners].sort() });
  }
  const generatedRuntimeEntries = [...generated].sort().map(rel => {
    const item = describePath(root, rel, []);
    delete item.sourcePackages;
    return { ...item, source: 'vless-routeros-build' };
  });
  const sbom = {
    schema: 1,
    kind: 'from-scratch-minimal-squashed-runtime',
    alpine: { release: ALPINE_RELEASE, repository: ALPINE_REPOSITORY, arch: target.alpineArch },
    singBox: { version: VERSION, sourceCommit: SOURCE_COMMIT, sourceSha256: SOURCE_SHA256, binarySha256: binary.sha256, goVersion: GO_VERSION, buildTags: BUILD_TAGS },
    consumedApks: packages.map(({ name, version, filename, sha256 }) => ({ name, version, filename, sha256 })),
    partialPayloadPackages: [{ name: 'iptables', retainedPurpose: 'xtables extension modules for the legacy tcp/REDIRECT rules', discardedPurpose: 'nft frontends are not used by the RouterOS runtime' }],
    retainedApkPayload,
    discardedApkPayload,
    generatedRuntimeEntries,
    selfPath: 'usr/share/vless-routeros/runtime-sbom.json',
    removedComponents: REMOVED_RUNTIME_COMPONENTS,
    effectiveComponents: [
      ...packages.map(({ name, version }) => ({ name, version })),
      { name: 'vless-routeros-entrypoint', version: '1' },
      { name: 'sing-box', version: VERSION }
    ].sort((a, b) => a.name.localeCompare(b.name))
  };
  const sbomFile = path.join(root, sbom.selfPath);
  fs.writeFileSync(sbomFile, JSON.stringify(sbom, null, 2) + '\n');
  fs.chmodSync(sbomFile, 0o644);
  setTreeMtimePreserveModes(root);
  const elfCount = verifyElfClosure(root);
  for (const banned of ['lib/apk', 'etc/apk', 'sbin/apk', 'usr/bin/ssl_client', 'usr/lib/libcrypto.so.3', 'usr/lib/libssl.so.3']) {
    if (pathExists(path.join(root, banned))) throw new Error(`banned runtime path survived: ${banned}`);
  }
  for (const required of ['bin/sh', 'bin/cat', 'bin/grep', 'usr/bin/awk', 'usr/bin/cut', 'usr/bin/head', 'sbin/ip', 'usr/sbin/iptables', 'usr/lib/xtables/libxt_tcp.so', 'usr/lib/xtables/libxt_REDIRECT.so']) {
    if (!pathExists(path.join(root, required))) throw new Error(`required runtime path missing: ${required}`);
  }
  return { sbomFile, sbomSha256: sha256File(sbomFile), elfCount, sbom, entrypointSha256: sha256File(entrypointTarget) };
}

function removeReadOnlyTree(dir) {
  if (!fs.existsSync(dir)) return;
  const makeWritable = current => {
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) return;
    if (stat.isDirectory()) {
      fs.chmodSync(current, 0o700);
      for (const name of fs.readdirSync(current)) makeWritable(path.join(current, name));
    } else {
      fs.chmodSync(current, 0o600);
    }
  };
  makeWritable(dir);
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

function listTreeEntries(root) {
  const result = [];
  const walk = (current, parent = '') => {
    for (const ent of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = parent ? `${parent}/${ent.name}` : ent.name;
      result.push(rel);
      if (ent.isDirectory()) walk(path.join(current, ent.name), rel);
    }
  };
  walk(root);
  return result;
}

function writeDeterministicTar(root, output, work, listName) {
  const entries = listTreeEntries(root);
  if (!entries.length) throw new Error(`refusing to create empty archive from ${root}`);
  const listFile = path.join(work, `${listName}.list`);
  fs.writeFileSync(listFile, entries.join('\n') + '\n');
  run('tar', [
    '--format', 'ustar', '--no-recursion', '--uid', '0', '--gid', '0', '--uname', 'root', '--gname', 'root',
    '-cf', output, '-C', root, '-T', listFile
  ], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
  fs.chmodSync(output, 0o644);
  fs.utimesSync(output, CREATED, CREATED);
  return entries;
}

function verifyDeclaredRootfs(root, sbom) {
  const actual = new Set(listTreeEntries(root));
  const declared = new Set([
    ...sbom.retainedApkPayload.map(item => item.path),
    ...sbom.generatedRuntimeEntries.map(item => item.path),
    sbom.selfPath
  ]);
  const undeclared = [...actual].filter(item => !declared.has(item));
  const missing = [...declared].filter(item => !actual.has(item));
  if (undeclared.length || missing.length) {
    throw new Error(`runtime SBOM/rootfs mismatch; undeclared=${undeclared.slice(0, 8).join(',')} missing=${missing.slice(0, 8).join(',')}`);
  }
}

function buildSquashedTarget(target, build, licenseFile, alpinePackages) {
  const binary = build.binaries.get(target.outputArch);
  if (!binary) throw new Error(`compiled binary missing for ${target.outputArch}`);
  const packages = alpinePackages.get(target.outputArch);
  if (!packages?.length) throw new Error(`pinned Alpine package set missing for ${target.outputArch}`);
  if (!fs.existsSync(ENTRYPOINT_FILE)) throw new Error(`entrypoint missing: ${ENTRYPOINT_FILE}`);

  const work = fs.mkdtempSync(path.join(os.tmpdir(), `vless-routeros-squashed-${target.outputArch}-`));
  try {
    const rootfs = path.join(work, 'rootfs');
    const archiveDir = path.join(work, 'docker-archive');
    fs.mkdirSync(archiveDir, { mode: 0o755 });
    fs.chmodSync(archiveDir, 0o755);
    const runtime = prepareMinimalRuntime(rootfs, packages, binary, licenseFile, ENTRYPOINT_FILE, target);
    verifyDeclaredRootfs(rootfs, runtime.sbom);

    const layerTar = path.join(work, 'rootfs-layer.tar');
    writeDeterministicTar(rootfs, layerTar, work, 'rootfs');
    const diffId = sha256File(layerTar);
    const layerId = sha256Text(`vless-routeros-from-scratch:${VERSION}:${target.outputArch}:${diffId}`);
    const layerDir = path.join(archiveDir, layerId);
    fs.mkdirSync(layerDir, { mode: 0o755 });
    fs.chmodSync(layerDir, 0o755);
    fs.copyFileSync(layerTar, path.join(layerDir, 'layer.tar'));
    fs.chmodSync(path.join(layerDir, 'layer.tar'), 0o644);
    fs.writeFileSync(path.join(layerDir, 'VERSION'), '1.0');
    fs.chmodSync(path.join(layerDir, 'VERSION'), 0o644);
    writeJson(path.join(layerDir, 'json'), {
      id: layerId,
      created: CREATED_ISO,
      container_config: { Cmd: [`/bin/sh -c #(nop) ADD from-scratch sing-box ${VERSION} runtime`] },
      os: 'linux',
      architecture: target.dockerArch,
      ...(target.dockerVariant ? { variant: target.dockerVariant } : {})
    });

    const labels = {
      'org.opencontainers.image.title': 'VLESS sing-box tunnel for RouterOS',
      'org.opencontainers.image.version': VERSION,
      'org.opencontainers.image.source': 'https://github.com/SagerNet/sing-box',
      'org.opencontainers.image.licenses': 'GPL-3.0-or-later',
      'org.opencontainers.image.revision': SOURCE_COMMIT,
      'org.opencontainers.image.created': CREATED_ISO,
      'io.github.anten-ka.vless-routeros.runtime': 'from-scratch-single-layer',
      'io.github.anten-ka.vless-routeros.source.sha256': SOURCE_SHA256,
      'io.github.anten-ka.vless-routeros.go.version': GO_VERSION,
      'io.github.anten-ka.vless-routeros.build.tags': BUILD_TAGS,
      'io.github.anten-ka.vless-routeros.binary.sha256': binary.sha256,
      'io.github.anten-ka.vless-routeros.entrypoint.sha256': runtime.entrypointSha256,
      'io.github.anten-ka.vless-routeros.runtime-sbom.sha256': runtime.sbomSha256,
      'io.github.anten-ka.vless-routeros.alpine.release': ALPINE_RELEASE,
      'io.github.anten-ka.vless-routeros.alpine.packages.sha256': sha256Text(JSON.stringify(packages.map(({ name, version, sha256 }) => ({ name, version, sha256 }))))
    };
    const config = {
      created: CREATED_ISO,
      architecture: target.dockerArch,
      ...(target.dockerVariant ? { variant: target.dockerVariant } : {}),
      os: 'linux',
      config: {
        Env: ['PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', 'DISABLE_NFTABLES=true'],
        Entrypoint: ['/entrypoint.sh'],
        WorkingDir: '/',
        Labels: labels
      },
      rootfs: { type: 'layers', diff_ids: [`sha256:${diffId}`] },
      history: [{
        created: CREATED_ISO,
        created_by: `Reproducible from-scratch runtime: sing-box ${VERSION} on Alpine ${ALPINE_RELEASE}`,
        comment: `source ${SOURCE_COMMIT}; binary sha256 ${binary.sha256}; runtime SBOM sha256 ${runtime.sbomSha256}`
      }]
    };
    const configText = JSON.stringify(config);
    const configName = `${sha256Text(configText)}.json`;
    fs.writeFileSync(path.join(archiveDir, configName), configText);
    fs.chmodSync(path.join(archiveDir, configName), 0o644);
    fs.utimesSync(path.join(archiveDir, configName), CREATED, CREATED);

    const tag = `${VERSION}-${target.outputArch}`;
    writeJson(path.join(archiveDir, 'manifest.json'), [{
      Config: configName,
      RepoTags: [`anten-ka/vless-sing-box-routeros:${tag}`],
      Layers: [`${layerId}/layer.tar`]
    }]);
    writeJson(path.join(archiveDir, 'repositories'), {
      'anten-ka/vless-sing-box-routeros': { [tag]: layerId }
    });
    setTreeMtimePreserveModes(archiveDir);

    const output = path.join(HERE, `vless-routeros-${VERSION}-${target.outputArch}.tar`);
    writeDeterministicTar(archiveDir, output, work, 'docker-archive');

    const verifyArchive = path.join(work, 'verify-archive');
    const verifyRoot = path.join(work, 'verify-rootfs');
    fs.mkdirSync(verifyArchive);
    fs.mkdirSync(verifyRoot);
    run('tar', ['-xf', output, '-C', verifyArchive]);
    const verifyManifest = JSON.parse(fs.readFileSync(path.join(verifyArchive, 'manifest.json'), 'utf8'));
    if (verifyManifest.length !== 1 || verifyManifest[0].Layers.length !== 1) throw new Error(`image is not exactly one layer: ${output}`);
    const verifyConfigText = fs.readFileSync(path.join(verifyArchive, verifyManifest[0].Config), 'utf8');
    if (`${sha256Text(verifyConfigText)}.json` !== verifyManifest[0].Config) throw new Error(`config digest invalid: ${output}`);
    const verifyConfig = JSON.parse(verifyConfigText);
    if (verifyConfig.rootfs.diff_ids.length !== 1 || verifyConfig.rootfs.diff_ids[0] !== `sha256:${diffId}`) throw new Error(`rootfs diff ID invalid: ${output}`);
    if (verifyConfig.history.length !== 1) throw new Error(`history is not squashed: ${output}`);
    const verifyLayerDir = path.dirname(verifyManifest[0].Layers[0]);
    const verifyLayerJson = JSON.parse(fs.readFileSync(path.join(verifyArchive, verifyLayerDir, 'json'), 'utf8'));
    if ('parent' in verifyLayerJson) throw new Error(`squashed legacy layer unexpectedly has a parent: ${output}`);
    const embeddedLayer = path.join(verifyArchive, verifyManifest[0].Layers[0]);
    if (sha256File(embeddedLayer) !== diffId) throw new Error(`embedded layer digest invalid: ${output}`);
    run('tar', ['-xf', embeddedLayer, '-C', verifyRoot]);
    const verifySbomFile = path.join(verifyRoot, runtime.sbom.selfPath);
    if (sha256File(verifySbomFile) !== runtime.sbomSha256) throw new Error(`runtime SBOM digest invalid: ${output}`);
    if (sha256File(path.join(verifyRoot, 'bin/sing-box')) !== binary.sha256) throw new Error(`sing-box binary digest invalid: ${output}`);
    if (sha256File(path.join(verifyRoot, 'entrypoint.sh')) !== runtime.entrypointSha256) throw new Error(`entrypoint digest invalid: ${output}`);
    verifyDeclaredRootfs(verifyRoot, JSON.parse(fs.readFileSync(verifySbomFile, 'utf8')));
    const verifiedElfCount = verifyElfClosure(verifyRoot);
    if (verifiedElfCount !== runtime.elfCount) throw new Error(`ELF count changed after archive round-trip: ${output}`);

    return {
      file: path.basename(output), sha256: sha256File(output), bytes: fs.statSync(output).size,
      layerSha256: diffId, layerCount: 1, historyCount: 1,
      binarySha256: binary.sha256, binaryBytes: binary.bytes, buildTags: BUILD_TAGS,
      sourceCommit: SOURCE_COMMIT, sourceSha256: SOURCE_SHA256, goVersion: GO_VERSION,
      goArch: target.goArch, goArm: target.goArm || null, dockerArch: target.dockerArch,
      binaryFileInfo: binary.fileInfo, entrypointSha256: runtime.entrypointSha256,
      runtimeSbomSha256: runtime.sbomSha256, elfCount: runtime.elfCount,
      alpineRelease: ALPINE_RELEASE,
      alpinePackages: packages.map(({ name, version, sha256, filename }) => ({ name, version, sha256, filename }))
    };
  } finally {
    removeReadOnlyTree(work);
  }
}

fs.mkdirSync(HERE, { recursive: true });
const downloadDir = path.join(HERE, '.downloads');
fs.mkdirSync(downloadDir, { recursive: true });
const licenseFile = path.join(downloadDir, `sing-box-${VERSION}-LICENSE`);
if (!fs.existsSync(licenseFile) || sha256File(licenseFile) !== LICENSE_SHA256) {
  fetchPinned(LICENSE_URL, licenseFile, LICENSE_SHA256);
}

const alpinePackages = prepareAlpinePackages(downloadDir);
const build = prepareBuild(downloadDir);
let built;
try {
  built = TARGETS.map(target => buildSquashedTarget(target, build, licenseFile, alpinePackages));
} finally {
  build.cleanup();
}
fs.writeFileSync(path.join(HERE, 'SHA256SUMS.txt'), built.map(x => `${x.sha256}  ${x.file}`).join('\n') + '\n');
fs.chmodSync(path.join(HERE, 'SHA256SUMS.txt'), 0o644);
fs.writeFileSync(path.join(HERE, 'BUILD-MANIFEST.json'), JSON.stringify({
  schema: 1,
  created: CREATED_ISO,
  singBoxVersion: VERSION,
  sourceCommit: SOURCE_COMMIT,
  sourceArchiveSha256: SOURCE_SHA256,
  goVersion: GO_VERSION,
  goArchiveSha256: GO_ARCHIVE_SHA256,
  buildTags: BUILD_TAGS,
  alpineRelease: ALPINE_RELEASE,
  alpineRepository: ALPINE_REPOSITORY,
  buildScriptSha256: sha256File(fileURLToPath(import.meta.url)),
  singBoxLicenseSha256: LICENSE_SHA256,
  basePolicy: 'From-scratch reproducible runtime assembled only from digest-pinned upstream inputs.',
  images: built
}, null, 2) + '\n');
fs.chmodSync(path.join(HERE, 'BUILD-MANIFEST.json'), 0o644);

for (const item of built) console.log(`${item.file}\t${item.sha256}\t${item.bytes}`);
