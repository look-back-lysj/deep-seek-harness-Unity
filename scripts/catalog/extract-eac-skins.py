"""Extract pinned EAC release blobs from an already-local Git object database.

No network, build, profile mutation or code execution. Original tgz bytes and
their bundled license notices are retained. Output is a local testing catalog,
not a public mirror or a claim that these packages passed this machine's UI QA.
"""
from pathlib import Path, PurePosixPath
from datetime import datetime, timezone
import argparse
import base64
import hashlib
import io
import json
import subprocess
import tarfile

REF = 'afa947215a862a9c3304f6fff7a812efe5a42fdc'
UPSTREAM = 'https://github.com/DSH-EAC/dsh-ui-skin-loader'
ARCHIVE_DIR = '.verify/pkgs-v1.1.0-final'
HELD_PACKAGES = {
    '@dsh-eac/skin-miku': '原归档缺少最新 EAC beta 的激活失败背景恢复修复，暂缓安装。',
    '@dsh-eac/skin-trading': '原归档仍有最新 EAC beta 已移除的远程脚本取数行为，暂缓安装。',
}

def sha(content):
    return 'sha256:' + hashlib.sha256(content).hexdigest()

def save_new(path, data):
    if path.exists():
        if path.read_bytes() != data:
            raise ValueError('Refusing to overwrite different output: ' + str(path))
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

parser = argparse.ArgumentParser()
parser.add_argument('--repo', required=True)
parser.add_argument('--output', required=True)
args = parser.parse_args()
repo, output = Path(args.repo).resolve(), Path(args.output).resolve()
def git_blob(path):
    return subprocess.check_output(['git', 'show', REF + ':' + path], cwd=repo)

commit = json.loads(subprocess.check_output(['git', 'show', '-s', '--format={"commit":"%H","date":"%cI"}', REF], cwd=repo))
checksum_bytes = git_blob(ARCHIVE_DIR + '/SHA256SUMS.txt')
checksums = []
for line in checksum_bytes.decode('utf-8').splitlines():
    digest, filename = line.split(maxsplit=1)
    filename = filename.lstrip('*')
    if PurePosixPath(filename).name != filename or not filename.endswith('.tgz'):
        raise ValueError('Unexpected artifact filename')
    checksums.append((digest, filename))
checksums.sort(key=lambda item: (0 if 'ui-skin-loader' in item[1] else 1, item[1]))
if len(checksums) != 14:
    raise ValueError('The pinned release must contain exactly one loader and thirteen skins')

generated = datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
index = dict(schemaVersion='2', revision='local-eac-skins-1.1.0-reviewed-' + REF[:12], generatedAt=generated,
             publication={'sourceId': 'local-eac-skins', 'sequence': 2},
             plugins=[], packs=[], presentations=[], deliveries=[], releases=[], releaseStatuses=[], recommendations=[], collections=[])
ledger = []
for digest, filename in checksums:
    blob = git_blob(ARCHIVE_DIR + '/' + filename)
    if hashlib.sha256(blob).hexdigest() != digest:
        raise ValueError('Upstream SHA256SUMS mismatch: ' + filename)
    with tarfile.open(fileobj=io.BytesIO(blob), mode='r:gz') as archive:
        files = []
        total = 0
        for member in archive.getmembers():
            name = PurePosixPath(member.name)
            if name.is_absolute() or '..' in name.parts or not name.parts or name.parts[0] != 'package' or member.issym() or member.islnk():
                raise ValueError('Unsafe archive member')
            if member.isfile():
                total += member.size
                if total > 500 * 1024 * 1024:
                    raise ValueError('Archive exceeds inspection limit')
                files.append('/'.join(name.parts[1:]))
        raw_metadata = archive.extractfile('package/package.json').read()
        package = json.loads(raw_metadata)
        for name in ['LICENSE', 'NOTICE', 'THIRD-PARTY-NOTICES.md']:
            if name not in files:
                raise ValueError('Missing license/attribution: ' + filename + '/' + name)
        license_text = archive.extractfile('package/LICENSE').read().decode('utf-8')
        notices = archive.extractfile('package/THIRD-PARTY-NOTICES.md').read().decode('utf-8')
        readme = archive.extractfile('package/README.md').read().decode('utf-8')
    is_loader = package['name'] == '@dsh-eac/ui-skin-loader'
    skin = package.get('dsh', {}).get('skin', {})
    if package['version'] != '1.1.0' or not package.get('dsh', {}).get('bundle', {}).get('patch'):
        raise ValueError('Not the expected official bundle')
    plugin_id = 'dev.eac.ui-skin-loader' if is_loader else 'dev.eac.skin-' + package['name'].split('/skin-', 1)[1]
    display = 'EAC 皮肤管理器' if is_loader else skin.get('name', package['name'])
    summary = '统一管理已安装皮肤、切换外观，并可恢复 DSH 默认外观。' if is_loader else skin.get('description', package.get('description', display))
    hold_reason = HELD_PACKAGES.get(package['name'])
    if hold_reason:
        summary = hold_reason
    artifact_digest = sha(blob)
    release_id = 'release-' + hashlib.sha256(json.dumps([plugin_id, package['name'], '1.1.0', artifact_digest], ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()
    presentation_id = plugin_id + '@local-1.1.0'
    source_path = 'packages/loader' if is_loader else 'packages/skins/' + package['name'].split('/skin-', 1)[1]
    source_url = UPSTREAM + '/tree/' + REF + '/' + source_path
    author = 'DSH-EAC' if is_loader else skin.get('author', 'DSH-EAC')
    index['plugins'].append(dict(id=plugin_id, name=display, packageName=package['name'], version='1.1.0', summary=summary,
        author=author, sourceUrl=source_url, license=package.get('license', 'MIT'), distribution='unclassified',
        capabilityTier='appearance', verification='unverified', installability='bundle-installable', artifactDigest=artifact_digest,
        presentationId=presentation_id, categories=['皮肤管理'] if is_loader else ['外观皮肤'], screenshots=[],
        enabledPolicy='default-on', requiresRestart=False, requiresSetup=False, largeExternalResource=False,
        releaseId=release_id, metadata={'kind':'official-bundle','packageJson':{'contentBase64':base64.b64encode(raw_metadata).decode(),'sha256':sha(raw_metadata)},'files':files}))
    instructions = ('先安装并启用本管理器，再按需安装皮肤。安装皮肤仅登记可选外观，不自动切换；请打开 DSH 的皮肤控制台选择。' if is_loader
                    else '请先安装并启用「EAC 皮肤管理器」，再安装本皮肤。在皮肤控制台选择它才会切换外观；可随时恢复默认外观。')
    markdown = f'# {display}\n\n{summary}\n\n## 使用顺序\n\n{instructions}\n\n适配官方 DSH 0.1.7-rc.2，Node.js 24 或以上。本机已备好原版发行包，安装时不需要重新拉取源码；其他依赖仍由官方安装器处理。\n\n本条目完成了来源、文件和摘要核验，真实换肤效果仍待你安装测试，因此保留“未验证”标记。\n\n## 来源与许可\n\n原作者：{author}\n\n版本：1.1.0\n\n许可：{package.get("license", "MIT")}\n\n[固定源码]({source_url})\n\n原包的 LICENSE、NOTICE 和第三方声明均完整保留。深海女仆工坊等含非商业图片许可的作品应遵循原包注明的条款。\n\n## 原作者说明\n\n{readme}\n\n## 第三方声明\n\n{notices}'
    index['presentations'].append(dict(id=presentation_id, revision='local-1.1.0', title=display, summary=summary, markdown=markdown, media=[], sourceUrl=source_url, sourceCommit=REF))
    index['deliveries'].append(dict(pluginId=plugin_id, packageName=package['name'], version='1.1.0', artifactDigest=artifact_digest,
        sources=[dict(kind='cache', ref=artifact_digest, priority=0, size=len(blob))]))
    index['releases'].append(dict(schemaVersion='1',releaseId=release_id,pluginId=plugin_id,packageName=package['name'],version='1.1.0',artifactDigest=artifact_digest,metadataDigest=sha(raw_metadata),size=len(blob),
        provenance=dict(kind='author-release',repositoryUrl=UPSTREAM,commit=REF,license=package.get('license','MIT'),
            authorization=dict(basis='license',reference=source_url+'/LICENSE ; bundled THIRD-PARTY-NOTICES.md (local evaluation, original bytes)',redistribution=True),
            releaseUrl=UPSTREAM+'/blob/'+REF+'/'+ARCHIVE_DIR+'/'+filename)))
    index['releaseStatuses'].append(dict(releaseId=release_id,sequence=1,status='active',reason='用户要求导入原版1.1.0，本机手动安装验证；未公开发布',effectiveAt=generated))
    if hold_reason:
        index['releaseStatuses'].append(dict(releaseId=release_id, sequence=2, status='withdrawn', reason=hold_reason, effectiveAt=generated))
    save_new(output/'artifacts'/filename,blob)
    save_new(output/'licenses'/package['name'].split('/')[-1]/'LICENSE',license_text.encode())
    save_new(output/'licenses'/package['name'].split('/')[-1]/'THIRD-PARTY-NOTICES.md',notices.encode())
    ledger.append(dict(filename=filename,name=package['name'],version=package['version'],bytes=len(blob),sha256=digest,sourceCommit=REF))
save_new(output/'SHA256SUMS.txt',checksum_bytes)
save_new(output/'market-index.json',(json.dumps(index,ensure_ascii=False,indent=2)+'\n').encode())
save_new(output/'artifacts.json',(json.dumps({'source':UPSTREAM,'commit':commit,'artifacts':ledger,'localOnly':True},ensure_ascii=False,indent=2)+'\n').encode())
print(json.dumps({'output':str(output),'packages':len(ledger),'bytes':sum(p['bytes'] for p in ledger),'loader':ledger[0]},ensure_ascii=True))
