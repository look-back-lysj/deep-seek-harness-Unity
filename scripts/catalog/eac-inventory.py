"""Offline inventory and deterministic material preparation, never an installer.

Only reads exact Git objects and an official source archive. Git lazy fetching is
disabled. No npm, author scripts, network, source imports, or profile writes.
Repacking uses Python's standard library; original package bytes are preserved
unless a specifically authorized, visibly named derived skin is selected.
"""
from __future__ import annotations

import argparse
import base64
from collections import Counter
from datetime import datetime, timezone
import gzip
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import platform
import re
import subprocess
import sys
import tarfile

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'catalog-source/eac-inventory'
PREFIX = 'dsh-desktop/assets/plugins/'


def digest(data):
    return 'sha256:' + hashlib.sha256(data).hexdigest()


def git_digest(data):
    return hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()


def encoded(data):
    return {'contentBase64': base64.b64encode(data).decode(), 'sha256': digest(data)}


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode('utf-8')


def save(path, data):
    """An interrupted/repeated run may reuse identical bytes, never replace them."""
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if path.read_bytes() != data:
            raise ValueError('Refusing to overwrite different evidence: ' + str(path))
    else:
        with path.open('xb') as stream:
            stream.write(data)


def save_json(path, value):
    save(path, json_bytes(value))


def safe_name(name):
    p = PurePosixPath(name)
    if (not name or p.is_absolute() or '..' in p.parts or '\\' in name
            or ':' in name or '\0' in name):
        raise ValueError('Unsafe material path: ' + name)
    return p.as_posix().removeprefix('./')


def unpack(data):
    """Bounded in-memory read; no tar.extract / author code / filesystem links."""
    files, seen, total = {}, set(), 0
    if len(data) > 200 * 1024 * 1024:
        raise ValueError('Archive exceeds compressed limit')
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
        for i, member in enumerate(archive):
            name = safe_name(member.name)
            if i >= 20000 or not name.startswith('package/') or not (member.isfile() or member.isdir()):
                raise ValueError('Unsafe archive member: ' + name)
            if member.isdir():
                continue
            name = name[len('package/'):]
            if name.lower() in seen:
                raise ValueError('Case-colliding archive paths')
            seen.add(name.lower())
            total += member.size
            if member.size > 100 * 1024 * 1024 or total > 500 * 1024 * 1024:
                raise ValueError('Archive exceeds expanded limit')
            files[name] = archive.extractfile(member).read()
    if 'package.json' not in files:
        raise ValueError('Archive lacks package.json')
    return files


def pack(files):
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode='w', format=tarfile.USTAR_FORMAT) as archive:
        for path, data in sorted(files.items()):
            name = safe_name(path)
            info = tarfile.TarInfo('package/' + name)
            info.mode, info.mtime, info.size = 0o644, 0, len(data)
            archive.addfile(info, io.BytesIO(data))
    return gzip.compress(stream.getvalue(), compresslevel=9, mtime=0)


def synchronize_skin_version(client, old_version, new_version, skin_id):
    """Patch only the runtime registration identity; refuse ambiguous context.

    The client passes SKIN_META directly to registerSkin. Its version is a live
    identity checked by SkinCenter, not merely a display label.
    """
    if len(re.findall(rb'(?m)^var SKIN_META\s*=', client)) != 1:
        raise ValueError('Expected exactly one SKIN_META declaration')
    objects = list(re.finditer(rb'(?ms)^var SKIN_META = \{\r?\n(.*?)^\};', client))
    if len(objects) != 1:
        raise ValueError('Expected one bounded SKIN_META object')
    obj = objects[0]
    body = obj.group(1)
    versions = list(re.finditer(rb'(?m)^  version: "([^"\r\n]+)",\r?$', body))
    if len(versions) != 1 or len(re.findall(rb'\bversion\s*:', body)) != 1:
        raise ValueError('Expected exactly one literal SKIN_META.version')
    version = versions[0]
    if version.group(1) != old_version.encode('ascii'):
        raise ValueError('Unexpected upstream runtime version')
    if client.count(b'var SKIN_ID = "' + skin_id.encode('ascii') + b'";') != 1 or body.count(b'id: SKIN_ID,') != 1:
        raise ValueError('Runtime skin identity context differs')
    registrations = list(re.finditer(rb'(?ms)ctx\.uiSkinLoader\.registerSkin\(\{\r?\n(.*?)^  \}\);', client))
    if len(registrations) != 1:
        raise ValueError('Expected exactly one registerSkin call')
    registration = registrations[0].group(1)
    if not registration.startswith(b'    ...SKIN_META,') or re.search(rb'\bversion\s*:', registration):
        raise ValueError('registerSkin no longer consumes SKIN_META.version directly')
    start, end = (obj.start(1) + position for position in version.span(1))
    patched = client[:start] + new_version.encode('ascii') + client[end:]
    return patched, {'object': 'SKIN_META', 'field': 'version', 'matches': 1,
                     'line': client[:start].count(b'\n') + 1, 'byteOffset': start,
                     'from': old_version, 'to': new_version,
                     'upstreamSha256': digest(client), 'derivedSha256': digest(patched),
                     'upstreamGitBlob': git_digest(client), 'derivedGitBlob': git_digest(patched)}


class GitObjects:
    def __init__(self, repo, blob_cache=None):
        self.repo = repo
        self.blob_cache = Path(blob_cache).resolve() if blob_cache else None
        self.cache_sources = {}
        self.env = dict(os.environ, GIT_NO_LAZY_FETCH='1', GIT_TERMINAL_PROMPT='0', GIT_OPTIONAL_LOCKS='0')
        self.cache = {}

    def command(self, *args):
        return subprocess.check_output(['git', '-C', self.repo, *args], env=self.env, timeout=60)

    def tree(self, ref):
        result = {}
        for row in self.command('ls-tree', '-r', '-z', ref).split(b'\0'):
            if not row:
                continue
            info, path = row.split(b'\t', 1)
            mode, kind, sha = info.decode().split()
            if kind == 'blob':
                result[path.decode('utf-8')] = {'path': path.decode('utf-8'), 'sha': sha, 'type': kind, 'mode': mode}
        return result

    def preload(self, shas):
        pending = sorted(set(shas) - self.cache.keys())
        if not pending:
            return
        process = subprocess.run(['git', '-C', self.repo, 'cat-file', '--batch'],
                                 input=('\n'.join(pending) + '\n').encode(), capture_output=True,
                                 env=self.env, timeout=60, check=True)
        stream = io.BytesIO(process.stdout)
        for sha in pending:
            header = stream.readline().decode().strip().split()
            if header == [sha, 'missing']:
                self.cache[sha] = None
                if self.blob_cache:
                    for filename in [sha, sha + '.blob', sha + '.bin', sha + '.raw', sha + '.json']:
                        path = self.blob_cache / filename
                        if not path.is_file():
                            continue
                        data = path.read_bytes()
                        if git_digest(data) != sha and data.lstrip().startswith(b'{'):
                            envelope = json.loads(data)
                            if envelope.get('sha') != sha or envelope.get('encoding') != 'base64':
                                raise ValueError('Unexpected cached Git blob envelope: ' + str(path))
                            data = base64.b64decode(envelope['content'])
                        if git_digest(data) != sha:
                            raise ValueError('Cached blob digest mismatch: ' + str(path))
                        self.cache[sha] = data
                        self.cache_sources[sha] = path.as_posix()
                        break
                continue
            if len(header) != 3 or header[0] != sha or header[1] != 'blob':
                raise ValueError('Unexpected Git batch response')
            data = stream.read(int(header[2]))
            if stream.read(1) != b'\n' or git_digest(data) != sha:
                raise ValueError('Corrupt Git object: ' + sha)
            self.cache[sha] = data

    def read(self, tree, path, required=False):
        entry = tree.get(path)
        if entry is None:
            if required:
                raise ValueError('Missing source path: ' + path)
            return None
        if entry['mode'] not in ('100644', '100755'):
            raise ValueError('Only regular Git blobs may be exported')
        self.preload([entry['sha']])
        data = self.cache[entry['sha']]
        if data is None and required:
            raise ValueError('Missing local blob: ' + path + ' ' + entry['sha'])
        return data


def official_inventory(config):
    root = Path(config['officialSource'])
    paths = sorted(set((root / 'packages').glob('*/*/package.json'))
                   | set((root / 'apps').glob('*/package.json'))
                   | set((root / 'vendor').glob('*/package.json')))
    records, metadata = {}, {}
    for path in paths:
        data = path.read_bytes()
        item = json.loads(data)
        name = item['name']
        metadata[name] = item
        records[name] = {'packageName': name, 'version': item.get('version'),
                         'path': path.relative_to(root).as_posix(), 'packageJsonDigest': digest(data),
                         'description': item.get('description'), 'license': item.get('license')}
    desktop = json.loads((root / 'apps/desktop/package.json').read_bytes())
    cli = json.loads((root / 'apps/cli/package.json').read_bytes())
    if desktop['version'] != config['officialVersion'] or cli['version'] != config['officialVersion']:
        raise ValueError('Official source version differs from the pinned baseline')
    closure, pending = set(), [cli['name']]
    while pending:
        name = pending.pop()
        if name in closure or name not in metadata:
            continue
        closure.add(name)
        pending.extend(metadata[name].get('dependencies', {}))
        pending.extend(metadata[name].get('optionalDependencies', {}))
    patches = []
    for part in ['base', 'web-app']:
        path = root / f'packages/bundle/{part}/cordis.patch.yml'
        data = path.read_bytes()
        references = re.findall(r'^\s*name:\s*[\'"]?([^\s\'"#]+)', data.decode('utf-8'), re.M)
        patches.append({'path': path.relative_to(root).as_posix(), 'sha256': digest(data), 'packageReferences': references})
    for name, item in records.items():
        item['cliDependencyClosure'] = name in closure
        item['defaultPatchReferences'] = [{'path': p['path'], 'name': ref} for p in patches
                                          for ref in p['packageReferences'] if ref == name or ref.startswith(name + '/')]
    return {'schemaVersion': '1', 'version': desktop['version'], 'sourcePath': root.as_posix(),
            'requestedPath': config['officialRequestedPath'], 'gitCommit': None,
            'provenance': 'Local source archive without Git; dependency/default patch analysis, not a running profile.',
            'defaultPatches': patches, 'packages': sorted(records.values(), key=lambda x: x['packageName'])}, records


def code_evidence(files):
    hits, imports = [], set()
    pattern = re.compile(r'window\.dshDesktop|DSH_EAC_BRIDGE_(?:URL|TOKEN)|DSH_DESKTOP_PROFILE|web-desktop')
    for path, data in files.items():
        if not path.endswith(('.js', '.mjs', '.ts', '.tsx')):
            continue
        text = data.decode('utf-8', errors='replace')
        for i, line in enumerate(text.splitlines(), 1):
            if pattern.search(line):
                hits.append({'path': path, 'line': i, 'excerpt': line.strip()[:320]})
        imports.update(re.findall(r'(?:from\s+|require\(\s*)[\'"]([^\'"]+)[\'"]', text))
    return {'bridgeAndProfileReferences': hits, 'externalImports': sorted(x for x in imports if not x.startswith(('.', 'node:'))),
            'method': 'Static text evidence; comments and guarded fallbacks are not automatically treated as mandatory dependencies.'}


def license_review(package, files, expected=None):
    notices = [p for p in files if re.search(r'(^|/)(LICENSE[^/]*|NOTICE[^/]*|THIRD-PARTY-NOTICES[^/]*)$', p, re.I)]
    text_present = any(PurePosixPath(p).name.upper().startswith('LICENSE') for p in notices)
    declared = package.get('license') if package else None
    restricted = bool(declared and 'NC' in declared)
    return {'declared': declared, 'expectedByRegistry': expected,
            'status': ('conditional-noncommercial' if restricted else 'notice-present') if text_present else 'unverified-no-license-text',
            'canRedistribute': ('conditional' if restricted else True) if text_present else False,
            'conditions': (['仅限非商业用途', '保留作者署名、许可证和来源链', '改作遵守相同方式共享'] if restricted
                           else ['保留原版权、许可证、NOTICE 和第三方声明']) if text_present else ['需取得实际许可证文本或明确授权，声明/expected 字段本身不够'],
            'evidence': [{'path': p, 'sha256': digest(files[p])} for p in sorted(notices)],
            'assetRightsAudit': '包内声明已保留；未重新认证每张第三方图像的完整权利链。' if package and package.get('dsh', {}).get('skin') else None}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True)
    parser.add_argument('--write-source', action='store_true', help='Also save reviewable generated JSON below catalog-source/eac-inventory')
    parser.add_argument('--blob-cache', help='Read exact-SHA missing blobs from an independent directory; never write the Git repository')
    args = parser.parse_args()
    output = Path(args.output).resolve()
    allowed = [Path('D:/eac-market-verify/distribution-20260928/' + name).resolve() for name in ['inventory', 'inventory-v2', 'inventory-v3']]
    if not any(output == directory or directory in output.parents for directory in allowed):
        raise ValueError('Evidence output must stay inside the authorized inventory directory')
    config = json.loads((SOURCE / 'sources.json').read_bytes())
    notes = json.loads((SOURCE / 'review-notes.json').read_bytes())
    git = GitObjects(config['repository'], args.blob_cache)
    tree_bytes = Path(config['betaTree']).read_bytes()
    document = json.loads(tree_bytes)
    if document['sha'] != config['beta'] or document.get('truncated') is not False:
        raise ValueError('Need a complete tree for the exact beta commit')
    tree = {x['path']: x for x in document['tree'] if x['type'] == 'blob'}
    pack_tree, skins_tree = git.tree(config['betaPack']), git.tree(config['betaSkins'])
    wanted = [x['sha'] for p, x in tree.items() if p.startswith((PREFIX, '.sync/', 'handover/dsh-eac-pack-installer-src/'))
              or p.endswith('.tgz') or p in ['LICENSE', 'dsh-desktop/package.json', 'dsh-desktop/package-lock.json']]
    wanted += [x['sha'] for p, x in pack_tree.items() if p.startswith('mojobox/catalog/') and p.endswith('.json')]
    wanted += [skins_tree['.verify/pkgs-v1.1.0-final/SHA256SUMS.txt']['sha']]
    git.preload(wanted)
    run_file = output / 'run.json'
    run = json.loads(run_file.read_bytes()) if run_file.exists() else {
        'generatedAt': datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z'),
        'python': platform.python_version(), 'network': False, 'thirdPartyCodeExecuted': False,
        'operation': 'Read Git objects; deterministic tar repack; write inventory evidence only.'}
    save_json(run_file, run)
    save(output / 'sources/generator.py', Path(__file__).read_bytes())
    save(output / 'sources/inventory-config.json', (SOURCE / 'sources.json').read_bytes())
    save(output / 'sources/review-notes.json', (SOURCE / 'review-notes.json').read_bytes())
    save(output / 'sources/latest-beta-tree.json', tree_bytes)
    save(output / 'sources/previous-source-review.md', Path(config['previousReview']).read_bytes())
    registry = json.loads(git.read(tree, '.sync/plugins.json', True))
    registry_lock_bytes = git.read(tree, '.sync/plugins.lock.json')
    registry_lock = json.loads(registry_lock_bytes).get('plugins', {}) if registry_lock_bytes else {}
    distribution = json.loads(git.read(tree, '.sync/plugin-distribution.json', True))
    dist = {x['id']: x for x in distribution['plugins']}
    manifests = {}
    for path in sorted(pack_tree):
        if path.startswith('mojobox/catalog/') and path.endswith('.json'):
            raw = git.read(pack_tree, path, True)
            save(output / 'sources/beta-pack' / path, raw)
            if path.startswith('mojobox/catalog/plugins/'):
                meta = json.loads(raw)
                manifests[meta['name']] = {'path': path, 'raw': raw, 'value': meta}
    for path in ['.sync/plugins.json', '.sync/plugin-distribution.json', '.sync/plugin-inventory-history.json', '.sync/plugins.lock.json']:
        data = git.read(tree, path)
        if data is not None:
            save(output / 'sources/beta' / path, data)
    for path in ['dsh-desktop/package.json', 'dsh-desktop/package-lock.json']:
        data = git.read(tree, path)
        if data is not None:
            save(output / 'sources/beta' / path, data)
    official, official_by_name = official_inventory(config)
    save_json(output / 'official-inventory.json', official)
    catalog_snapshot = json.loads(git.read(tree, PREFIX + 'dsh-unified-market/data/catalog-snapshot.json', True))
    descriptions = {x['name']: x.get('desc') for x in catalog_snapshot['plugins']}
    items, raw_by_name, files_by_name = [], {}, {}
    for registration in registry['plugins']:
        name, directory = registration['packageName'], registration['path']
        refs = {p[len(directory) + 1:]: x for p, x in tree.items() if p.startswith(directory + '/')}
        raw = git.read(tree, directory + '/package.json')
        pkg = json.loads(raw) if raw is not None else None
        if pkg and pkg['name'] != name:
            raise ValueError('Registry/package identity mismatch')
        files = {p: git.cache[x['sha']] for p, x in refs.items() if git.cache.get(x['sha']) is not None}
        files_by_name[name] = files
        if raw is not None:
            raw_by_name[name] = raw
        public = manifests.get(name)
        review = notes['notes'].get(name, {})
        version = pkg['version'] if pkg else (public['value']['version'] if public else registration['request'].get('version'))
        lock_entry = registry_lock.get(registration['id'])
        locked_version = (lock_entry or {}).get('local', {}).get('packageVersion')
        if version is None and locked_version:
            version = locked_version
        description = (review.get('function') or (pkg or {}).get('description') or descriptions.get(name)
                       or notes['functionHints'].get(registration['id']) or '功能资料待原作者补充')
        current = official_by_name.get(name)
        official_status = {'sameNameInSource': current is not None, 'bundledByOfficialDependencyGraph': bool(current and current['cliDependencyClosure']),
                           'sameImplementation': False if current else None, 'evidence': current,
                           'conclusion': '同名冲突，EAC 旧实现不能覆盖官方组件' if current else '官方源码清单无此包名；不据此断言官方没有相似功能'}
        license_info = license_review(pkg, files, registration.get('license', {}).get('expected'))
        blockers = list(review.get('blockers', []))
        missing = [{'path': directory + '/' + p, 'blob': x['sha']} for p, x in refs.items() if git.cache.get(x['sha']) is None]
        if not refs:
            blockers.append('固定最新版 tree 无该目录制品；注册记录或旧公共 Manifest 不能替代作者包。')
        if missing:
            blockers.append('固定 tree 中部分 blob 不在本地；未下载、未使用历史文件替换。')
        if license_info['canRedistribute'] is False:
            blockers.append('缺实际许可证文本，暂停再分发和安装。')
        bundle = (pkg or {}).get('dsh', {}).get('bundle', {}).get('patch')
        if pkg and not bundle:
            blockers.append('无 dsh.bundle.patch；需作者提供标准 bundle 或经审核的独立包装。')
        runtime = code_evidence(files)
        api = review.get('api', 'skin-loader-convention-on-official-api' if name.startswith('@dsh-eac/skin-') else 'unknown-missing-source')
        state = 'hard-blocked' if current or review.get('blockers') and refs else ('missing-artifact' if not refs or missing else 'missing-bundle' if not bundle else 'needs-repair')
        pid = public['value']['id'] if public else 'dev.eac.' + registration['id']
        items.append({'id': pid, 'registryId': registration['id'], 'packageName': name, 'version': version,
                      'versionBasis': 'latest-beta-package-json' if pkg else 'beta-pack-catalog-only' if public else 'registry-lock-only' if locked_version and registration['request'].get('version') is None else 'registry-request-only' if version else 'unknown-floating-request',
                      'function': description, 'functionBasis': 'reviewed-metadata' if pkg else 'catalog-description' if descriptions.get(name) else 'editorial-label-from-registration-not-runtime-proof',
                      'scope': 'beta-registry', 'source': {'commit': config['beta'], 'path': directory, 'registration': registration,
                                                       'distribution': dist.get(registration['id']), 'lockEntry': lock_entry, 'treeSha256': digest(tree_bytes)},
                      'official': official_status, 'api': {'requirement': api, **runtime},
                      'local': {'builtFiles': [p for p in files if p.startswith('lib/') or p == 'index.js'],
                                'fileCount': len(refs), 'availableFileCount': len(files), 'missingBlobs': missing, 'artifacts': []},
                      'license': license_info, 'knownFixes': review.get('knownFixes', []),
                      'install': {'state': state, 'canInstall': False, 'reasons': blockers, 'runtimeVerification': 'not-tested'},
                      'publicManifest': {'commit': config['betaPack'], 'path': public['path'], 'sha256': digest(public['raw']), 'version': public['value']['version']} if public else None,
                      'buildMaterials': {'thirdPartyCommandsExecuted': False, 'scriptsDeclared': (pkg or {}).get('scripts', {}),
                                         'dependencies': (pkg or {}).get('dependencies', {}), 'peerDependencies': (pkg or {}).get('peerDependencies', {}),
                                         'engines': (pkg or {}).get('engines', {}), 'externalImports': runtime['externalImports'],
                                         'needed': ['固定作者源码 commit', '完整许可证与署名链', '精确版本的原始 tgz 及 SHA256；或锁文件、精确工具链和隔离构建配方', '官方 bundle 加载声明及运行依赖', '官方 Desktop 安装及业务验证'] if not refs else (['先修复已列阻碍；不可执行第三方未知构建脚本'] if blockers else [])}})
        for p, data in files.items():
            save(output / 'extracted/latest-beta' / directory / safe_name(p), data)
    named = {x['packageName'] for x in items}
    for name, public in manifests.items():
        if name in named:
            continue
        meta = public['value']
        items.append({'id': meta['id'], 'registryId': None, 'packageName': name, 'version': meta['version'],
                      'versionBasis': 'beta-pack-catalog-only', 'scope': 'beta-pack-only',
                      'function': descriptions.get(name) or notes['publicManifestFunctionHints'].get(name, '目录已列功能，待作者补充说明'),
                      'functionBasis': 'catalog-description-or-editorial-label-not-runtime-proof',
                      'source': {'commit': config['betaPack'], 'path': public['path'], 'declaration': meta.get('source'), 'artifactHint': meta.get('artifact')},
                      'official': {'sameNameInSource': name in official_by_name, 'bundledByOfficialDependencyGraph': False, 'sameImplementation': None, 'evidence': official_by_name.get(name)},
                      'api': {'requirement': 'unknown-missing-artifact'},
                      'local': {'builtFiles': [], 'fileCount': 0, 'availableFileCount': 0, 'missingBlobs': [], 'artifacts': []},
                      'license': license_review(None, {}, meta.get('license')), 'knownFixes': [],
                      'install': {'state': 'missing-artifact', 'canInstall': False, 'reasons': ['只有公共目录声明；本地没有制品/许可全文，不能安装。'], 'runtimeVerification': 'not-tested'},
                      'publicManifest': {'commit': config['betaPack'], 'path': public['path'], 'sha256': digest(public['raw']), 'version': meta['version']},
                      'buildMaterials': {'thirdPartyCommandsExecuted': False, 'needed': ['按公共目录版本取得原始 tgz；核对声明摘要', '原始 package.json、bundle patch、许可证全文和署名链', '若走源码路线，需完整 commit、锁文件和精确工具链；不可把 tag 当 commit']}})
    by_name = {x['packageName']: x for x in items}
    artifacts, artifact_files, releases, recipes = [], {}, [], []
    generated = run['generatedAt']

    def stage(name, data, kind, commit, source_path, eligible, derived_from=None, material_files=None):
        files = unpack(data)
        package = json.loads(files['package.json'])
        if package['name'] != name:
            raise ValueError('Artifact name mismatch')
        artifact_digest = digest(data)
        filename = name.removeprefix('@').replace('/', '-') + '-' + package['version'] + '.tgz'
        archive_path = 'artifacts/' + filename
        save(output / archive_path, data)
        record = {'filename': filename, 'path': archive_path, 'packageName': name, 'version': package['version'],
                  'bytes': len(data), 'sha256': artifact_digest, 'metadataDigest': digest(files['package.json']),
                  'kind': kind, 'commit': commit, 'sourcePath': source_path, 'installCandidate': eligible,
                  'runtimeVerification': 'not-tested', 'metadata': {'kind': 'official-bundle', 'packageJson': encoded(files['package.json']), 'files': sorted(files)}}
        slug = filename.removesuffix('.tgz')
        for p in files:
            if re.search(r'(^|/)(LICENSE[^/]*|NOTICE[^/]*|THIRD-PARTY-NOTICES[^/]*|EAC-DERIVATION.json|UPSTREAM-PACKAGE.json)$', p, re.I):
                save(output / 'licenses' / slug / safe_name(p), files[p])
        save(output / 'metadata' / (slug + '.package.json.raw'), files['package.json'])
        artifacts.append(record)
        artifact_files[artifact_digest] = files
        item = by_name[name]
        item['local']['artifacts'].append({k: record[k] for k in ['path', 'version', 'bytes', 'sha256', 'metadataDigest', 'kind', 'installCandidate']})
        auth_license = license_review(package, files)
        if auth_license['canRedistribute'] is False or item['license']['canRedistribute'] is False:
            return record
        auth = {'basis': 'license', 'reference': 'Bundled LICENSE/NOTICE/THIRD-PARTY-NOTICES retained; see licenses/' + slug + '. Noncommercial limitations remain where declared.', 'redistribution': True}
        repo_url = config['skinRepositoryUrl'] if kind == 'author-release' and commit == config['betaSkins'] else config['repositoryUrl']
        provenance = {'kind': 'author-release' if kind == 'author-release' else 'team-build', 'repositoryUrl': repo_url, 'commit': commit,
                      'license': package['license'], 'authorization': auth}
        if kind == 'author-release':
            provenance['releaseUrl'] = repo_url + '/blob/' + commit + '/' + source_path
        else:
            lock = {'kind': 'ExactBuiltBlobInputs', 'commit': commit, 'sourceSubdir': source_path,
                    'files': [{'path': p, 'sha256': digest(b), 'gitBlob': git_digest(b)} for p, b in sorted(material_files.items())],
                    'operation': 'Archive already-built bytes; do not execute upstream scripts.', 'derivedVersion': package['version'] if derived_from else None,
                    'generatorSha256': digest(Path(__file__).read_bytes())}
            lock_path = 'recipes/' + slug + '/material-lock.json'
            save_json(output / lock_path, lock)
            recipe = {'schemaVersion': '1', 'kind': 'TeamBuildRecipe', 'repositoryUrl': repo_url, 'commit': commit,
                      'sourceSubdir': source_path, 'lockFile': lock_path, 'lockDigest': digest(json_bytes(lock)),
                      'authorization': auth, 'toolchain': [{'name': 'python', 'version': run['python']}],
                      'target': {'os': 'win32', 'arch': 'x64'},
                      'steps': [{'executable': 'python', 'args': ['scripts/catalog/eac-inventory.py', '--output', output.as_posix() + '/reproduction']}],
                      'allowedLifecycleScripts': [], 'output': archive_path,
                      'limits': {'timeoutSeconds': 300, 'memoryMiB': 2048, 'diskMiB': 2048}, 'credentials': 'none'}
            recipe_path = 'recipes/' + slug + '/build-recipe.json'
            save_json(output / recipe_path, recipe)
            recipes.append({'path': recipe_path, 'lockPath': lock_path, 'recipe': recipe})
            provenance.update({'sourceSubdir': source_path, 'lockDigest': recipe['lockDigest'], 'recipeDigest': digest(json_bytes(recipe)),
                               'toolchain': recipe['toolchain'], 'target': recipe['target'], 'buildRun': 'local-inventory-repack:' + generated + ':' + slug})
            if derived_from:
                provenance['derivedFrom'] = derived_from
            record['recipePath'] = recipe_path
        identity = [item['id'], name, package['version'], artifact_digest]
        release_id = 'release-' + hashlib.sha256(json.dumps(identity, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()
        release = {'schemaVersion': '1', 'releaseId': release_id, 'pluginId': item['id'], 'packageName': name,
                   'version': package['version'], 'artifactDigest': artifact_digest, 'metadataDigest': record['metadataDigest'], 'size': len(data), 'provenance': provenance}
        releases.append(release)
        record['releaseId'] = release_id
        save_json(output / 'releases' / (slug + '.json'), release)
        return record

    checksum_raw = git.read(skins_tree, '.verify/pkgs-v1.1.0-final/SHA256SUMS.txt', True)
    save(output / 'sources/skin-original-SHA256SUMS.txt', checksum_raw)
    originals = {}
    for line in checksum_raw.decode().splitlines():
        sha, filename = line.split(maxsplit=1)
        filename = safe_name(filename.lstrip('*'))
        data = (Path(config['originalSkins']) / filename).read_bytes()
        if digest(data) != 'sha256:' + sha:
            raise ValueError('Original archive checksum mismatch: ' + filename)
        files = unpack(data)
        package = json.loads(files['package.json'])
        name = package['name']
        originals[name] = files
        special = name in config['derivedClients']
        record = stage(name, data, 'author-release', config['betaSkins'], '.verify/pkgs-v1.1.0-final/' + filename, not special)
        item = by_name[name]
        if not special:
            item['install'] = {'state': 'bundle-installable', 'canInstall': True, 'reasons': [], 'runtimeVerification': 'not-tested',
                               'selectedArtifact': record['sha256'], 'selectedVersion': record['version'], 'mode': 'local-manual-unverified'}
        else:
            item['knownFixes'].append({'miku': '最新 beta 在激活失败后的 teardown/finally 恢复原 body 背景样式。',
                                       'trading': '最新 beta 移除第三方行情 JSONP/远程 script 执行通道，行情不可达时降级。'}[name.rsplit('-', 1)[1]])
    if len(originals) != 14:
        raise ValueError('Expected exactly fourteen original skin-system packages')
    for name, expected_blob in config['derivedClients'].items():
        item = by_name[name]
        base = files_by_name[name]
        if git_digest(base['lib/client.js']) != expected_blob or len(base) != item['local']['fileCount']:
            raise ValueError('Derived skin must use the complete fixed latest-beta tree')
        source_package = json.loads(base['package.json'])
        changed = dict(base)
        package = json.loads(base['package.json'])
        old_version = package['version']
        package['version'] = config['derivedVersion']
        package['dsh']['skin']['version'] = config['derivedVersion']
        changed['package.json'] = json_bytes(package)
        changed['lib/client.js'], runtime_patch = synchronize_skin_version(
            base['lib/client.js'], old_version, config['derivedVersion'], package['dsh']['skin']['id'])
        changed['UPSTREAM-PACKAGE.json'] = base['package.json']
        upstream_artifact = next(x for x in artifacts if x['packageName'] == name and x['kind'] == 'author-release')
        derivation = {'kind': 'EACLocalDerivedRepack', 'packageName': name, 'upstreamVersion': old_version, 'derivedVersion': config['derivedVersion'],
                      'upstreamArchiveDigest': upstream_artifact['sha256'], 'sourceCommit': config['beta'], 'sourcePath': item['source']['path'],
                      'builtClientGitBlob': expected_blob, 'originalPackageJsonDigest': digest(base['package.json']),
                      'changes': ['以固定最新 beta 的全部已构建文件为基底', 'package.json.version 与 dsh.skin.version 使用显式派生版本', '仅同步唯一 SKIN_META.version 字面量，使 registerSkin 真实登记版本与安装版本一致', '保留全部许可证与署名，添加本记录及上游 package.json 原字节'],
                      'upstreamPublishedRelease': False, 'runtimeVerification': 'not-tested',
                      'semverNotice': config['derivedVersion'] + ' 高于旧 1.1.0 和未上架的 .1 派生版；不是上游正式 1.1.1。',
                      'runtimeVersionPatch': runtime_patch,
                      'supersedesUnpublishedBrokenDerivative': '1.1.1-eac.dc22280.1'}
        changed['EAC-DERIVATION.json'] = json_bytes(derivation)
        data = pack(changed)
        if pack(changed) != data:
            raise ValueError('Non-deterministic repack')
        record = stage(name, data, 'derived-built-repack', config['beta'], item['source']['path'], True,
                       derived_from=name + '@' + old_version + ' ' + upstream_artifact['sha256'], material_files=base)
        item['version'] = config['derivedVersion']
        item['upstreamVersion'] = source_package['version']
        item['versionBasis'] = 'explicit-local-derivative-of-latest-beta-built'
        item['install'] = {'state': 'bundle-installable', 'canInstall': True, 'reasons': [], 'runtimeVerification': 'not-tested',
                           'selectedArtifact': record['sha256'], 'selectedVersion': record['version'], 'mode': 'local-manual-unverified',
                           'upgradeFrom': '1.1.0'}
        save_json(output / 'derivations' / (name.split('/')[-1] + '.json'), derivation)
    for name in ['dsh-compact', 'dsh-settings-scroll-fix', 'dsh-unified-market']:
        item, base = by_name[name], files_by_name[name]
        if len(base) != item['local']['fileCount']:
            continue
        eligible = name == 'dsh-settings-scroll-fix'
        record = stage(name, pack(base), 'built-repack', config['beta'], item['source']['path'], eligible, material_files=base)
        if eligible:
            item['install'] = {'state': 'bundle-installable', 'canInstall': True, 'reasons': [], 'runtimeVerification': 'not-tested',
                               'selectedArtifact': record['sha256'], 'selectedVersion': record['version'], 'mode': 'local-manual-unverified'}
    unresolved_archives = []
    for path in sorted(p for p in tree if p.endswith('.tgz')):
        data = git.read(tree, path)
        if data is None:
            unresolved_archives.append({'path': path, 'blob': tree[path]['sha'], 'packageName': None, 'version': None,
                                        'state': 'missing-artifact', 'canInstall': False, 'reason': 'tree 有归档但本地 blob 缺失；不从文件名伪造包内身份。'})
            continue
        files = unpack(data)
        pkg = json.loads(files['package.json'])
        name = pkg['name']
        if name in by_name:
            continue
        review = notes['notes'].get(name, {})
        item = {'id': 'dev.eac.' + name.split('/')[-1], 'registryId': None, 'packageName': name, 'version': pkg['version'],
                'versionBasis': 'latest-beta-retained-archive', 'scope': 'beta-retained-archive', 'function': review.get('function', pkg.get('description', name)),
                'source': {'commit': config['beta'], 'path': path}, 'official': {'sameNameInSource': name in official_by_name, 'bundledByOfficialDependencyGraph': False, 'sameImplementation': None},
                'api': {'requirement': review.get('api', 'unknown'), **code_evidence(files)},
                'local': {'builtFiles': [p for p in files if p.startswith('lib/')], 'fileCount': len(files), 'availableFileCount': len(files), 'missingBlobs': [], 'artifacts': []},
                'license': license_review(pkg, files), 'knownFixes': [],
                'install': {'state': 'hard-blocked', 'canInstall': False, 'reasons': review.get('blockers', ['历史归档，尚未完成当前宿主兼容审查。']), 'runtimeVerification': 'not-tested'},
                'publicManifest': None, 'buildMaterials': {'thirdPartyCommandsExecuted': False, 'scriptsDeclared': pkg.get('scripts', {}),
                    'dependencies': pkg.get('dependencies', {}), 'peerDependencies': pkg.get('peerDependencies', {}), 'engines': pkg.get('engines', {}),
                    'needed': ['先解决历史快照/宿主依赖问题；原始可安装结构不等于可以安全提供一键安装。']}}
        items.append(item)
        by_name[name] = item
        files_by_name[name], raw_by_name[name] = files, files['package.json']
        if name == '@dsh-eac/desktop-pack':
            item['license'].update({'status': 'aggregate-member-review-required', 'canRedistribute': False})
        stage(name, data, 'author-release', config['beta'], path, False)
        # Bundled members are not standalone standard bundles. Preserve every
        # actual identity, including renamed EAC implementations, without
        # substituting them for same-name latest-beta standalone files.
        for member_path in sorted(p for p in files if p.startswith('node_modules/') and p.endswith('/package.json')):
            member = json.loads(files[member_path])
            member_name = member['name']
            member_prefix = member_path[:-len('package.json')]
            member_files = {p[len(member_prefix):]: b for p, b in files.items() if p.startswith(member_prefix)}
            variant = {'parentPackage': name, 'parentVersion': pkg['version'], 'parentArtifactDigest': digest(data),
                       'path': member_prefix, 'packageName': member_name, 'version': member['version'],
                       'metadataDigest': digest(files[member_path]), 'separatelyInstallable': False,
                       'reason': '由聚合包唯一 patch 装配，不能作为独立发行包安装。'}
            if member_name in by_name:
                by_name[member_name].setdefault('bundledVariants', []).append(variant)
                continue
            new_item = {'id': 'dev.eac.bundled-' + member_name.split('/')[-1], 'registryId': None,
                        'packageName': member_name, 'version': member['version'], 'versionBasis': 'exact-aggregate-member-package-json',
                        'scope': 'beta-aggregate-member', 'function': member.get('description', member_name),
                        'source': {'commit': config['beta'], 'path': path, 'archiveMember': member_path},
                        'official': {'sameNameInSource': member_name in official_by_name, 'bundledByOfficialDependencyGraph': False, 'sameImplementation': None},
                        'api': {'requirement': 'aggregate-adapted-member-unverified', **code_evidence(member_files)},
                        'local': {'builtFiles': [p for p in member_files if p.startswith('lib/')], 'fileCount': len(member_files),
                                  'availableFileCount': len(member_files), 'missingBlobs': [], 'artifacts': [], 'containedIn': variant},
                        'license': license_review(member, member_files), 'knownFixes': ['聚合包提供的实际改名身份，不能与官方同名旧实现混淆；运行尚未验证。'],
                        'install': {'state': 'missing-bundle', 'canInstall': False, 'reasons': ['只有聚合包内嵌组件；无独立 bundle patch，许可归属和完整运行需随聚合包审查。'], 'runtimeVerification': 'not-tested'},
                        'publicManifest': None, 'buildMaterials': {'thirdPartyCommandsExecuted': False, 'dependencies': member.get('dependencies', {}),
                            'peerDependencies': member.get('peerDependencies', {}), 'needed': ['作者提供独立 bundle、许可证全文与官方 Desktop 验证；不能直接把嵌套目录改包名伪装发行。']}}
            items.append(new_item)
            by_name[member_name] = new_item
            files_by_name[member_name], raw_by_name[member_name] = member_files, files[member_path]
        if name == '@dsh-eac/desktop-pack':
            for archive_file in ['README.md', 'ACCEPTANCE.md', 'DEGRADATIONS.md', 'cordis.patch.yml']:
                if archive_file in files:
                    save(output / 'sources/aggregate-desktop-pack' / archive_file, files[archive_file])

    # Produce valid v2 records only when authentic metadata is actually present.
    # Missing package metadata cannot be "fixed" by inventing a package.json.
    index = {'schemaVersion': '2', 'revision': 'local-eac-inventory-' + config['beta'][:12], 'generatedAt': generated,
             'publication': {'sourceId': 'local-eac-inventory', 'sequence': 1}, 'plugins': [], 'presentations': [],
             'releases': releases, 'releaseStatuses': [], 'deliveries': [], 'packs': [], 'recommendations': [], 'collections': [], 'listings': []}
    for artifact in artifacts:
        if 'releaseId' not in artifact:
            continue
        index['releaseStatuses'].append({'releaseId': artifact['releaseId'], 'sequence': 1, 'status': 'active' if artifact['installCandidate'] else 'withdrawn',
                                        'reason': '仅本地手动试装候选；运行未验证' if artifact['installCandidate'] else '已知旧修复缺失或官方宿主安装阻碍；只作证据保留', 'effectiveAt': generated})
    listing_only = []
    for item in items:
        name = item['packageName']
        selected = next((a for a in artifacts if a['packageName'] == name and a['sha256'] == item['install'].get('selectedArtifact')), None)
        if selected:
            metadata, version = selected['metadata'], selected['version']
        elif name in raw_by_name:
            metadata = {'kind': 'official-bundle', 'packageJson': encoded(raw_by_name[name]), 'files': sorted(files_by_name[name])}
            version = json.loads(raw_by_name[name])['version']
        elif name in manifests:
            metadata = {'kind': 'dsh-std', 'manifest': encoded(manifests[name]['raw'])}
            version = manifests[name]['value']['version']
        else:
            item['catalogProjection'] = {'target': 'listing-only', 'reason': 'Use the separate v2 listings table; never invent package metadata or exact installed version.'}
            listing_only.append(item)
            listing = {'id': item['id'], 'name': item['packageName'], 'packageName': item['packageName'],
                       'summary': item['function'], 'reason': '；'.join(item['install']['reasons']),
                       'sourceUrl': config['repositoryUrl'] + '/blob/' + config['beta'] + '/.sync/plugins.json'}
            if item['version']:
                listing['requestedVersion'] = item['version']
            index['listings'].append(listing)
            continue
        pid = item['id']
        presentation_id = pid + '@inventory'
        author = json.loads(raw_by_name[name]).get('author') if name in raw_by_name else None
        if isinstance(author, dict):
            author = author.get('name')
        pkg = json.loads(raw_by_name[name]) if name in raw_by_name else {}
        author = pkg.get('dsh', {}).get('skin', {}).get('author') or author or '署名见原包/上游记录；未核实作者身份'
        display = pkg.get('dsh', {}).get('skin', {}).get('name') or name
        summary = item['function']
        blockers = item['install']['reasons']
        if blockers:
            summary += '；暂不可安装：' + '；'.join(blockers)
        if item['license']['canRedistribute'] == 'conditional':
            summary += '；素材许可限非商业用途，并需署名及相同方式共享。'
        url = config['repositoryUrl'] + '/tree/' + item['source']['commit'] + '/' + item['source']['path']
        plugin = {'id': pid, 'name': display, 'packageName': name, 'version': version, 'summary': summary, 'author': author,
                  'sourceUrl': url, 'distribution': 'unclassified', 'capabilityTier': 'appearance' if name.startswith('@dsh-eac/skin-') else 'feature',
                  'verification': 'unverified', 'installability': item['install']['state'], 'presentationId': presentation_id,
                  'categories': ['外观皮肤'] if name.startswith('@dsh-eac/skin-') else ['EAC 差异插件'], 'screenshots': [],
                  'enabledPolicy': 'default-on', 'requiresRestart': False if selected else True, 'requiresSetup': name.startswith('@dsh-eac/skin-'),
                  'largeExternalResource': False, 'metadata': metadata}
        license_name = pkg.get('license') or (manifests.get(name, {}).get('value', {}).get('license'))
        if license_name:
            plugin['license'] = license_name
        if selected:
            plugin.update({'artifactDigest': selected['sha256'], 'releaseId': selected['releaseId']})
            index['deliveries'].append({'pluginId': pid, 'packageName': name, 'version': version, 'artifactDigest': selected['sha256'],
                                        'sources': [{'kind': 'cache', 'ref': selected['sha256'], 'priority': 0, 'size': selected['bytes']}]})
        index['plugins'].append(plugin)
        markdown = '# ' + display + '\n\n' + summary + '\n\n'
        markdown += '当前仅完成固定来源与本地材料检查，官方 Desktop 运行验证尚未执行。\n\n'
        if name.startswith('@dsh-eac/skin-'):
            markdown += '先安装并启用 EAC 皮肤管理器，再在「设置 → 皮肤」选择此皮肤。安装不等于激活外观。\n\n'
        if name in config['derivedClients']:
            markdown += '本版本是以最新 beta 已构建代码制作的团队派生包，不是上游正式 1.1.1 发行；版本顺序高于旧 1.1.0，可纳入正常升级计划。\n\n'
        markdown += '许可：' + str(license_name or '未取得全文，禁止再分发') + '\n\n' + '\n\n'.join(item['license']['conditions'])
        markdown += '\n\n固定来源：' + url
        index['presentations'].append({'id': presentation_id, 'revision': 'inventory-' + config['beta'][:12], 'title': display,
                                       'summary': summary, 'markdown': markdown, 'media': [], 'sourceUrl': url, 'sourceCommit': item['source']['commit']})
        item['catalogProjection'] = {'target': 'v2', 'metadataKind': metadata['kind'], 'version': version}
    summary = {'registeredPlugins': len(registry['plugins']), 'betaAssetPackages': sum(x['scope'] == 'beta-registry' and x['local']['fileCount'] > 0 for x in items),
               'registryWithoutAssetDirectory': sum(x['scope'] == 'beta-registry' and not x['local']['fileCount'] for x in items),
               'betaPackManifests': len(manifests), 'betaPackOnlyPackages': sum(x['scope'] == 'beta-pack-only' for x in items),
               'retainedArchivePackages': sum(x['scope'] == 'beta-retained-archive' for x in items),
               'aggregateMemberOnlyPackages': sum(x['scope'] == 'beta-aggregate-member' for x in items), 'totalNamedPackages': len(items),
               'unresolvedArchives': len(unresolved_archives), 'preparedArchives': len(artifacts), 'localInstallCandidates': sum(x['install']['canInstall'] for x in items),
               'noncommercialCandidates': sum(x['install']['canInstall'] and x['license']['canRedistribute'] == 'conditional' for x in items),
               'v2Records': len(index['plugins']), 'listingOnlyRecords': len(listing_only), 'officialNameCollisions': [x['packageName'] for x in items if x['official']['sameNameInSource']],
               'installationStates': dict(Counter(x['install']['state'] for x in items)), 'published': False, 'runtimeTested': False}
    inventory = {'schemaVersion': '1', 'kind': 'EacPluginInventory', 'generatedAt': generated,
                 'sources': config, 'summary': summary, 'plugins': sorted(items, key=lambda x: x['packageName']),
                 'unresolvedArtifacts': unresolved_archives,
                 'scopeNotes': ['最新版 beta 注册清单与实际插件资产、beta-pack 47 份公共 Manifest、最新 tree 保留的 tgz 的并集。',
                                '旧市场通用生态搜索快照不等于 EAC 随包差异清单；只用于已入范围插件的描述。',
                                '全部读取固定对象；不遍历历史提交，不把 beta-pack Manifest/Parsed 当运行或制品验证。',
                                '官方是否自带来自源码包清单和 CLI 依赖闭包；相似功能不能推出同一实现。']}
    inputs = {'schemaVersion': '1', 'kind': 'EacInventoryGeneratorInput', 'inventory': 'inventory.json', 'v2Candidate': 'market-index.candidate.json',
              'recommendedFragment': 'catalog-fragment.json', 'evidenceRoot': output.as_posix(),
              'listingOnly': 'listing-only.json', 'artifactLedger': 'artifacts.json', 'officialInventory': 'official-inventory.json',
              'recommendedPolicy': {'showAllInventoryItems': True, 'neverInventVersionOrMetadata': True,
                                    'installOnlySelectedArtifacts': True, 'allowUnverifiedOnlyAfterExplicitUserChoice': True,
                                    'noncommercialPackagesNeedLicenseConditionsShown': True, 'retainKnownBadOriginalsAsEvidenceOnly': True},
              'listingContract': '主控新增 v2 listings 表承接缺元数据条目；requestedVersion 仅为登记要求，不是已安装/已发行证明。',
              'localOnly': True, 'productionPublishReady': False}
    save_json(output / 'inventory.json', inventory)
    save_json(output / 'summary.json', summary)
    save_json(output / 'generator-input.json', inputs)
    save_json(output / 'listing-only.json', {'kind': 'UninstallableInventoryListings', 'schemaVersion': '1', 'plugins': listing_only})
    save_json(output / 'market-index.candidate.json', index)
    save_json(output / 'artifacts.json', {'schemaVersion': '1', 'localOnly': True, 'artifacts': artifacts})
    save_json(output / 'recipe-index.json', recipes)
    save_json(output / 'blob-cache-used.json', git.cache_sources)
    save_json(output / 'missing-blobs.json', [{'path': p, 'blob': x['sha']} for p, x in tree.items() if x['sha'] in git.cache and git.cache[x['sha']] is None])
    save(output / 'SHA256SUMS.txt', ''.join(a['sha256'][7:] + '  ' + a['path'] + '\n' for a in artifacts).encode())
    if args.write_source:
        for name in ['inventory.json', 'summary.json', 'generator-input.json', 'listing-only.json', 'market-index.candidate.json', 'official-inventory.json', 'artifacts.json']:
            save(SOURCE / name, (output / name).read_bytes())
    print(json.dumps({'output': output.as_posix(), **summary}, ensure_ascii=False))


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()
