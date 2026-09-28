#!/usr/bin/env python3
"""离线保全 desktop-pack 成员，复用已冻结独立包；不改任何包内元数据。

只使用标准库，不导入/执行被检查的 JS，不下载、不安装、不访问用户 profile。
raw-components 是证据，不是安装入口。仅 ready/ 下的两份既有归档可供未验证试装。
不同内容的已有输出一律拒绝覆盖；--verify 运行一次材料级定向检查。
"""
from __future__ import annotations

import argparse
import difflib
import gzip
import hashlib
import io
import json
import platform
from pathlib import Path, PurePosixPath
import re
import tarfile
import zlib


DEFAULT_INVENTORY = Path('D:/eac-market-verify/distribution-20260928/inventory-v3')
DEFAULT_OUTPUT = Path('D:/eac-market-verify/pullability-20260928/components')
PARENT_SHA = '7a328030e4ba8472bc5f53e439bd969f8212f6affe73f339865cc9c95023d187'
FROZEN = {
    '@dsh-eac/ui-skin-loader': ('dsh-eac-ui-skin-loader-1.1.0.tgz',
                             'b926aad7d312c9573226414867049a48b6825e2bb15d8ba76a3d707095ef1ba6'),
    'dsh-settings-scroll-fix': ('dsh-settings-scroll-fix-2.0.2.tgz',
                              'e160298f49cc9064212fcedb6eea808a436bbaf585f38872dbcc20fb06b23204'),
}
# 这些是对固定摘要的人工静态判读，不是靠关键词自动推断兼容性。
REVIEWS = {
    '@dsh-eac/terminal': {
        'interface': 'webServer.register/registerUpgrade + slots conversation.view；客户端另请求 file-changes 的 session-cwd/ports 路由。',
        'blockers': ['无独立 bundle 声明和成员 patch', 'file-changes 路由依赖未声明为可安装组件关系', '外来伴侣源码的原版权通知仍需追溯；不以聚合根许可代替'],
        'sourceKind': 'external-companion', 'next': '补齐来源通知与组件依赖后再装配；保留 @dsh-eac/terminal 身份。',
    },
    'dsh-viewport-lock': {
        'interface': '标准 __ModuleLoader__ 客户端，DOM/CSS 修复；host no-op，无旧私桥调用。',
        'blockers': ['无独立 bundle 声明和成员 patch'],
        'sourceKind': 'eac-original', 'next': '可按聚合包已有 viewport-lock 行制作独立安装元数据；本轮禁止改 manifest，未实施。',
    },
    'dsh-eac-locale-compat': {
        'interface': '官方 locale.getLocale/subscribe + ctx.effect；DOM 翻译兼容层。',
        'blockers': ['无独立 bundle 声明和成员 patch'],
        'sourceKind': 'eac-original', 'next': '可按聚合包已有 eac-locale-compat 行制作独立安装元数据；本轮未实施。',
    },
    'dsh-compact': {
        'interface': 'settings、webServer、agents、agentPresets；agent.js 另挂压缩引擎。',
        'blockers': ['无 bundle 声明', '成员 patch 只修改 compact 行，不插入；默认 base/web-app 不存在该行', '聚合 patch 也未装配 agent.js；compact-now 要求 service.dshCompact，否则返回 409'],
        'sourceKind': 'external-with-license', 'next': '需真实装配 Agent 压缩预设，单补 package 字段仍不够。',
    },
    'dsh-eac-core-bridge': {
        'interface': '官方 defineTool/Agent 生命周期外加 DSH_EAC_BRIDGE_URL/TOKEN 指向的扩展宿主。',
        'blockers': ['无独立 bundle 声明和成员 patch', '扩展宿主私桥未提供；没有端点时仅记录日志并返回'],
        'sourceKind': 'eac-original', 'next': '仍不可开放安装；空转不等于功能兼容。',
    },
    '@dsh-eac/easy-setup': {
        'interface': '官方 TypertRemoteService/Remote/typert.register；客户端 remote.$mount、slots、locale、sessions、workspaces。',
        'blockers': ['无独立 bundle 声明和成员 patch', 'personaPath 仍固定读取 profiles/web/cordis.patch.yml；没有绑定官方 Desktop 当前 profile'],
        'sourceKind': 'eac-original', 'next': '官方通信接口已有依据，但须先修当前 profile 的配置读取。',
    },
    '@dsh-eac/file-changes': {
        'interface': '官方 sessionProjections.register + webServer.register；读取会话日志并提供文件/端口/工作目录路由。',
        'blockers': ['无独立 bundle 声明和成员 patch', '外来伴侣源码的原版权通知仍需追溯；不以聚合根许可代替'],
        'sourceKind': 'external-companion', 'next': '保留 @dsh-eac/file-changes 身份，补来源通知及独立安装声明。',
    },
    'dsh-settings-scroll-fix': {
        'interface': '标准 __ModuleLoader__ + DOM/CSS，host no-op；现成 insert patch。',
        'blockers': ['聚合成员移除了 bundle 声明'],
        'sourceKind': 'eac-with-license', 'next': '复用 inventory-v3 已冻结 2.0.2 独立归档；不产生同名同版本的新发行。',
    },
    'dsh-unified-market': {
        'interface': 'webServer 自定义路由；旧 EAC profile 写入逻辑和客户端 dshDesktop 功能包桥仍存在。',
        'blockers': ['无 bundle 声明', 'DSH_DESKTOP=1 时仍选择 web-desktop', '客户端仍调用旧功能包桥；未迁移为当前官方插件管理'],
        'sourceKind': 'external-with-license', 'next': '有独立许可仍不代表官方兼容；保留拦截。',
    },
    '@dsh-eac/plugin-manager': {
        'interface': '官方 slots 仅承载界面；实际 list/管理仍经 window.dshDesktop.pluginManager。',
        'blockers': ['无独立 bundle 声明和成员 patch', '官方 dshDesktop 不提供 pluginManager 子对象', '外来伴侣源码的原版权通知仍需追溯'],
        'sourceKind': 'external-companion', 'next': '已改名不等于接口迁移；不得改回官方包名，也不得开放安装。',
    },
    'dsh-plugin-shield': {
        'interface': '官方 slots/locale 承载页面，所有动作依赖 window.dshDesktop.guard.action。',
        'blockers': ['无独立 bundle 声明和成员 patch', '官方没有 guard 子对象；无桥时返回 no-bridge'],
        'sourceKind': 'eac-original', 'next': '检查/备份同样依赖旧桥，不能只标完整恢复降级。',
    },
    'dsh-file-drop-eac': {
        'interface': '官方 slots 与浏览器 FileReader 可用；磁盘路径和保存仍走旧 getPathForFile/fileDrop.save。',
        'blockers': ['无独立 bundle 声明和成员 patch', '官方提供 __DSH_HOST_PATHS__.pathFor，代码未接入；普通文件保存仍依赖不存在的 fileDrop.save'],
        'sourceKind': 'eac-with-license', 'next': '文本读取回退不能证明普通文件保存成立；私桥未解决，保留拦截。',
    },
    '@dsh-eac/client-file-changes': {
        'interface': '官方 conversation.view 与日志差异显示；文件浏览依赖 file-changes；还原依赖旧 revertFiles。',
        'blockers': ['无独立 bundle 声明和成员 patch', '官方没有 revertFiles/openPath/getInfo 这些旧方法', '外来伴侣源码的原版权通知仍需追溯'],
        'sourceKind': 'external-companion', 'next': '不能把只读显示误标成文件还原已迁移。',
    },
    '@dsh-eac/ui-skin-loader': {
        'interface': '官方 settings.configure、slots、ctx.provide/effect + React；uiSkinLoader 是 EAC 公约服务。',
        'blockers': ['聚合成员移除了 bundle 声明'],
        'sourceKind': 'eac-with-license', 'next': '复用 inventory-v3 已冻结 1.1.0 作者独立包，保留 LICENSE/NOTICE/THIRD-PARTY-NOTICES。',
    },
}


def sha(data: bytes) -> str:
    return 'sha256:' + hashlib.sha256(data).hexdigest()


def encode(value) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode('utf-8')


def save(path: Path, data: bytes):
    if path.exists():
        if path.read_bytes() != data:
            raise ValueError(f'拒绝覆盖不同内容: {path}')
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('xb') as stream:
        stream.write(data)


def unpack(data: bytes) -> dict[str, bytes]:
    """仅在内存读普通文件；拒绝路径逃逸、重复路径和链接。"""
    result = {}
    folded = set()
    total = 0
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
        for member in archive:
            path = PurePosixPath(member.name)
            if (not member.name.startswith('package/') or '\\' in member.name
                    or any(p in ('..', '.') or ':' in p for p in member.name.split('/'))):
                raise ValueError(f'不安全归档路径: {member.name}')
            if member.isdir():
                continue
            if not member.isfile() or len(result) >= 10000:
                raise ValueError(f'只接受普通文件: {member.name}')
            relative = str(path.relative_to('package'))
            if relative.casefold() in folded:
                raise ValueError(f'重复归档路径: {relative}')
            folded.add(relative.casefold())
            total += member.size
            if total > 64 * 1024 * 1024 or member.size < 0:
                raise ValueError('输入超过本批 64 MiB 上限')
            result[relative] = archive.extractfile(member).read()
    if 'package.json' not in result:
        raise ValueError('缺少 package.json')
    return result


def pack(files: dict[str, bytes]) -> bytes:
    """固定顺序、时间、权限和归属；同工具链重跑得到完全相同的压缩字节。"""
    output = io.BytesIO()
    with gzip.GzipFile(filename='', fileobj=output, mode='wb', mtime=0, compresslevel=9) as zipped:
        with tarfile.open(fileobj=zipped, mode='w', format=tarfile.USTAR_FORMAT) as archive:
            for path, data in sorted(files.items()):
                info = tarfile.TarInfo('package/' + path)
                info.size, info.mode, info.mtime = len(data), 0o644, 0
                info.uid = info.gid = 0
                info.uname = info.gname = ''
                archive.addfile(info, io.BytesIO(data))
    return output.getvalue()


def material(path: str, data: bytes) -> dict:
    git = hashlib.sha1(b'blob ' + str(len(data)).encode('ascii') + b'\0' + data).hexdigest()
    return {'path': path, 'bytes': len(data), 'sha256': sha(data), 'gitBlob': git}


def license_paths(files):
    return [p for p in sorted(files) if re.search(r'(^|/)(LICENSE|NOTICE|THIRD-PARTY)', p, re.I)]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inventory', type=Path, default=DEFAULT_INVENTORY)
    parser.add_argument('--output', type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument('--verify', action='store_true', help='一次材料级定向检查，不执行包内代码')
    args = parser.parse_args()
    root, output = args.inventory.resolve(), args.output.resolve()
    # 本任务输出只能写验收目录，避免误指 profile、工程或冻结输入目录。
    allowed = Path('D:/eac-market-verify/pullability-20260928').resolve()
    if output == allowed or not output.is_relative_to(allowed) or output.is_relative_to(root):
        raise ValueError('输出必须是 D:/eac-market-verify/pullability-20260928/ 内的独立子目录')
    archive_path = root / 'artifacts/dsh-eac-desktop-pack-1.0.0.tgz'
    original = archive_path.read_bytes()
    if sha(original) != 'sha256:' + PARENT_SHA:
        raise ValueError('聚合包摘要与本次判读材料不符；不能沿用本报告')
    parent = unpack(original)
    metadata = json.loads(parent['package.json'])
    if metadata['name'] != '@dsh-eac/desktop-pack' or metadata['version'] != '1.0.0':
        raise ValueError('聚合身份不符')
    names = metadata['bundledDependencies']
    if len(names) != 14 or set(names) != set(REVIEWS):
        raise ValueError('成员清单与本次判读不符')
    patch = parent['cordis.patch.yml'].decode('utf-8-sig')
    rows = re.findall(r"    - id: ([\w-]+)\r?\n      name: '([^']+)'", patch)
    if len(rows) != 14 or set(n for _, n in rows) != set(names):
        raise ValueError('聚合 patch 已变化')
    row_by_name = {n: row for row, n in rows}
    for path in ('LICENSE', 'package.json', 'dsh-plugin.json', 'cordis.patch.yml', 'README.md', 'ACCEPTANCE.md', 'DEGRADATIONS.md'):
        save(output / 'parent-evidence' / path, parent[path])

    report = {
        'kind': 'DesktopComponentStaticRecovery', 'source': str(archive_path),
        'sourceSha256': sha(original), 'sourceBytes': len(original),
        'sourceCommit': 'dc22280beb9d0a6338d1e02d99f5e5346f72f4f0',
        'network': False, 'packageCodeExecuted': False, 'metadataChanged': False,
        'runtimeVerification': 'not-tested', 'productionPublishReady': False,
        'toolchain': {'python': platform.python_version(), 'zlib': zlib.ZLIB_RUNTIME_VERSION},
        'generatorSha256': sha(Path(__file__).read_bytes()),
        'components': [], 'installCandidates': [],
    }
    component_files = {}
    artifacts = []
    for name in names:
        prefix = 'node_modules/' + name + '/'
        files = {p[len(prefix):]: b for p, b in parent.items() if p.startswith(prefix)}
        pkg = json.loads(files['package.json'])
        manifest = json.loads(files['dsh-plugin.json'])
        if pkg['name'] != name or manifest['name'] != name or manifest['version'] != pkg['version']:
            raise ValueError('组件身份不一致: ' + name)
        # 不补 bundle、版本、名字或 manifest，也不将原归档中的验收目标变成实测。
        if pkg.get('dsh', {}).get('bundle') is not None:
            raise ValueError('预期成员不声明 bundle，本次判读应重新审查: ' + name)
        slug = name.replace('@', '').replace('/', '-') + '-' + pkg['version']
        filename = 'raw-components/' + slug + '.tgz'
        data = pack(files)
        save(output / filename, data)
        component_files[name] = files
        artifact = {'path': filename, 'packageName': name, 'version': pkg['version'],
                    'sha256': sha(data), 'bytes': len(data), 'installCandidate': False,
                    'kind': 'exact-member-evidence-only', 'metadataDigest': sha(files['package.json'])}
        artifacts.append(artifact)
        local_name = 'dsh-' + name.split('/')[1] if name.startswith('@dsh-eac/') else name
        local_root = root / 'extracted/latest-beta/dsh-desktop/assets/plugins' / local_name
        comparison = []
        code_diff = []
        for path, content in sorted(files.items()):
            old = local_root / path
            prior = old.read_bytes() if old.is_file() else None
            comparison.append({**material(path, content), 'latestBetaPath': str(old),
                               'latestBetaSha256': sha(prior) if prior is not None else None,
                               'comparison': 'same' if prior == content else 'different' if prior is not None else 'absent'})
            if prior is not None and prior != content and path.endswith(('.js', '.mjs')):
                code_diff.extend(difflib.unified_diff(
                    prior.decode('utf-8-sig').splitlines(keepends=True),
                    content.decode('utf-8-sig').splitlines(keepends=True),
                    fromfile='latest-beta/' + local_name + '/' + path,
                    tofile='desktop-pack/' + name + '/' + path))
        if code_diff:
            save(output / 'built-diffs' / (slug + '.patch'), ''.join(code_diff).encode('utf-8'))
        review = REVIEWS[name]
        notices = license_paths(files)
        if 'LICENSE' in files:
            license_result = 'component-license-present'
        elif review['sourceKind'] == 'eac-original':
            if 'zouyuxuan122/DSH-Desktop-EAC' not in manifest.get('source', {}).get('repository', ''):
                raise ValueError('原研归属依据变化: ' + name)
            license_result = 'aggregate-MIT-with-explicit-original-source-attribution'
        else:
            license_result = 'upstream-copyright-notice-completeness-unresolved-not-a-no-rights-finding'
        evidence = []
        needles = re.compile(r'dshDesktop|DSH_EAC_BRIDGE_|web-desktop|profiles.*web|registerUpgrade|sessionProjections|typert.register|settings.configure|current preset does not use|locale.getLocale|locale.subscribe')
        for path, content in sorted(files.items()):
            if not path.endswith(('.js', '.mjs')):
                continue
            for number, line in enumerate(content.decode('utf-8-sig').splitlines(), 1):
                if needles.search(line):
                    evidence.append({'path': path, 'line': number, 'text': line.strip()[:500]})
        item = {'packageName': name, 'version': pkg['version'], 'rowId': row_by_name[name],
                'parentMemberPath': prefix, 'originalSource': manifest.get('source'),
                'sourceAttribution': manifest.get('x-eac'), 'review': review,
                'license': {'assessment': license_result, 'declared': pkg.get('license'),
                            'files': [material(p, files[p]) for p in notices],
                            'parentLicense': material('parent-evidence/LICENSE', parent['LICENSE']),
                            'rootLicenseDoesNotRelicenseExternalContent': True},
                'standaloneBundleAsIs': False, 'hasOwnPatch': 'cordis.patch.yml' in files,
                'artifact': artifact, 'files': comparison, 'evidence': evidence}
        report['components'].append(item)
        for path in notices:
            save(output / 'licenses' / slug / path, files[path])

    # 两份候选直接复制冻结归档，避免相同身份生成不同发行字节。
    ledger = json.loads((root / 'artifacts.json').read_text('utf-8'))
    for name, (filename, expected_sha) in FROZEN.items():
        data = (root / 'artifacts' / filename).read_bytes()
        frozen = next(a for a in ledger['artifacts'] if a['packageName'] == name and a['sha256'] == 'sha256:' + expected_sha)
        if sha(data) != 'sha256:' + expected_sha or frozen['installCandidate'] is not True:
            raise ValueError('冻结独立包或安装状态不符: ' + name)
        files = unpack(data)
        pkg = json.loads(files['package.json'])
        patch_path = pkg.get('dsh', {}).get('bundle', {}).get('patch', '').removeprefix('./')
        if patch_path not in files or b'- insert:' not in files[patch_path] or 'LICENSE' not in files:
            raise ValueError('冻结包缺少独立插入补丁或许可: ' + name)
        candidate = {'path': 'ready/' + filename, 'packageName': name, 'version': pkg['version'],
                     'sha256': sha(data), 'bytes': len(data), 'metadataDigest': sha(files['package.json']),
                     'installCandidate': True, 'kind': 'reuse-existing-frozen-release',
                     'frozenPath': str(root / frozen['path']), 'frozenReleaseId': frozen.get('releaseId'),
                     'newlyRecoveredRelease': False, 'runtimeVerification': 'not-tested',
                     'downloadUrl': None, 'bundlePatch': patch_path}
        report['installCandidates'].append(candidate)
        artifacts.append(candidate)
        save(output / candidate['path'], data)
    report['summary'] = {'memberCount': 14, 'unchangedStandaloneInstallableMembers': 0,
                         'existingFrozenInstallCandidates': 2, 'newInstallableReleases': 0,
                         'firstPartyMetadataOnlyCandidates': ['dsh-viewport-lock', 'dsh-eac-locale-compat'],
                         'rawArchivesAreNotInstallCandidates': True}
    save(output / 'components.json', encode(report))
    save(output / 'artifacts.json', encode({'artifacts': artifacts}))
    save(output / 'SHA256SUMS.txt', ''.join(a['sha256'][7:] + '  ' + a['path'] + '\n' for a in artifacts).encode())

    if args.verify:
        checks = []
        for item in report['components']:
            name = item['packageName']
            data = (output / item['artifact']['path']).read_bytes()
            if unpack(data) != component_files[name] or pack(component_files[name]) != data:
                raise ValueError('成员字节保全/确定性失败: ' + name)
            checks.append({'packageName': name, 'check': 'all-member-bytes-and-deterministic-tgz',
                           'status': 'pass', 'files': len(component_files[name])})
        for candidate in report['installCandidates']:
            data = (output / candidate['path']).read_bytes()
            files = unpack(data)
            if data != Path(candidate['frozenPath']).read_bytes():
                raise ValueError('候选必须等于冻结归档')
            # 实际执行文件和现成补丁应与聚合成员完全相同；许可全文另外保留原样。
            nested = component_files[candidate['packageName']]
            execution = [p for p in nested if p.startswith('lib/') and p.endswith(('.js', '.mjs'))]
            for path in execution + ['cordis.patch.yml']:
                if nested[path] != files[path]:
                    raise ValueError('候选不是同一执行实现: ' + path)
            checks.append({'packageName': candidate['packageName'], 'check': 'frozen-release-bundle-and-runtime-byte-identity',
                           'status': 'pass', 'executionFiles': execution,
                           'licenseFiles': [material(p, files[p]) for p in license_paths(files)]})
        # 全部危险功能仍不可选安装；不靠遗漏展示来躲开已知私桥问题。
        blocked = {'dsh-eac-core-bridge', '@dsh-eac/plugin-manager', 'dsh-plugin-shield',
                   'dsh-file-drop-eac', '@dsh-eac/client-file-changes', 'dsh-unified-market', 'dsh-compact'}
        if blocked.intersection(a['packageName'] for a in report['installCandidates']):
            raise ValueError('已知阻碍组件误开放')
        checks.append({'check': 'unresolved-bridges-and-assembly-remain-blocked', 'status': 'pass'})
        save(output / 'validation.json', encode({'kind': 'OneTargetedStaticMaterialCheck',
             'status': 'passed-static-only', 'network': False, 'packageCodeExecuted': False,
             'runtimeVerification': 'not-tested', 'checks': checks}))
    print(json.dumps({'output': str(output), **report['summary'], 'targetedCheck': args.verify}, ensure_ascii=False))


if __name__ == '__main__':
    main()
