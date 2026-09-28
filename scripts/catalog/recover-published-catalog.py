"""Replace research placeholders with inspected, immutable author releases.

Inputs are downloaded tgz inspections, real source refs, and mirror receipts.
No plugin code executes here. Missing current official modules remain blocked,
even when a mirror file is available for maintainers to investigate.
"""
from pathlib import Path
import argparse, base64, hashlib, json

parser=argparse.ArgumentParser()
parser.add_argument('batch')
parser.add_argument('--previous',required=True)
parser.add_argument('--output',required=True)
args=parser.parse_args()
root=Path(args.batch).resolve()
read=lambda p:json.loads(Path(p).read_text(encoding='utf-8-sig'))
doc=read(args.previous)
inspections=read(root/'author-inspection.json')
refs={r['packageName']:r for r in read(root/'author-source-refs.json')}
uploads={r['packageName']:r for r in read(root/'author-mirror-uploads.json') if r.get('commit')}
if (root/'anonymous-mirror-status.json').exists():
    unavailable={r['packageName'] for r in read(root/'anonymous-mirror-status.json') if r['status']!=200}
    uploads={k:v for k,v in uploads.items() if k not in unavailable}
inventory=read(Path(__file__).resolve().parents[2]/'catalog-source/eac-inventory/inventory.json')
original={r['packageName']:r for r in inventory['plugins']}
now=__import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')
sequence=doc['publication']['sequence']+1
doc.update(revision=f'eac-published-20260928-{sequence}',generatedAt=now)
doc['publication']['sequence']=sequence
oldByName={p['packageName']:p for p in doc['plugins']+doc.get('listings',[])}
recovered=[]
notes={}
for p in inspections:
    if p['status']!='inspected':continue
    name=p['packageName'];source=refs[name]
    if not source.get('commit'):raise ValueError('Missing pinned source: '+name)
    if source.get('tagPackage') and source['tagPackage']!={'name':name,'version':p['version']}:raise ValueError('Tag metadata identity mismatch: '+name)
    if not p['licenseFiles']:raise ValueError('Missing original license material: '+name)
    sourceUrl='https://github.com/'+source['repository']
    metadata=json.loads(base64.b64decode(p['metadata']['packageJson']['contentBase64']))
    if p['license'] not in ['MIT','BSD-3-Clause','SEE LICENSE IN ASSET_LICENSE.md']:raise ValueError('License needs review: '+name)
    if name=='dsh-dafeiyu':
        assetNotice=(root/'author-materials'/p['filename'].removesuffix('.tgz')/'ASSET_LICENSE.md').read_text(encoding='utf8')
        if 'are MIT-licensed as well' not in assetNotice or any(f.startswith('legacy/dafeiyu/') for f in p['metadata']['files']):raise ValueError('Restricted legacy asset found')
        if 'assets/dsh-pet-LICENSE.txt' not in p['metadata']['files']:raise ValueError('Missing asset notice')
    old=oldByName[name];pid=old['id'];version=p['version']
    blockers=[]
    if p['missingOfficialPackages']:blockers.append('官方 0.1.7-rc.2 缺少此包依赖的模块：'+', '.join(p['missingOfficialPackages'])+'。需要作者适配后再安装。')
    if not p['bundle']:blockers.append('作者包没有完整的官方 bundle 加载声明。')
    extraBlockers=read(root/'runtime-review.json') if (root/'runtime-review.json').exists() else {}
    blockers.extend(extraBlockers.get(name,[]))
    description=original[name]['function']
    displayNames={'dsh-prompt-stash':'输入暂存','@tt-a1i/archify-dsh':'架构图生成','dsh-file-claim':'文件协作保护','dsh-find-plugin':'插件搜索助手','dsh-status-rotator':'状态文案轮播','dsh-web-attention-badge':'浏览器完成提醒'}
    title=displayNames.get(name,description if len(description)<25 else name)
    author=metadata.get('author')
    author=author.get('name') if isinstance(author,dict) else author
    author=author or source['repository'].split('/')[0]
    presentation=pid+'@published-'+version
    digest='sha256:'+p['sha256']
    rid='release-'+hashlib.sha256(json.dumps([pid,name,version,digest],ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
    release={'schemaVersion':'1','releaseId':rid,'pluginId':pid,'packageName':name,'version':version,'artifactDigest':digest,
        'metadataDigest':p['metadataDigest'],'size':p['size'],'provenance':{'kind':'author-release','repositoryUrl':sourceUrl,
        'commit':source['commit'],'license':p['license'],'authorization':{'basis':'license','reference':'Original archive '+', '.join(p['licenseFiles'])+'; retained without modification','redistribution':True},'releaseUrl':p['registryTarball']}}
    noAuto={'computer-user','picturereader','dsh-dafeiyu','dsh-better-sidebar','@nanmicoder/dsh-agent-teams','dsh-undo-savepoint'}
    entry={'id':pid,'name':title,'packageName':name,'version':version,'summary':description if not blockers else description+'；'+blockers[0],
        'author':author,'sourceUrl':sourceUrl+'/tree/'+source['commit'],'license':p['license'],'distribution':old.get('distribution','external'),
        'capabilityTier':'feature','verification':'hard-incompatible' if blockers else 'unverified','installability':'hard-blocked' if blockers else 'bundle-installable',
        'artifactDigest':digest,'presentationId':presentation,'categories':['工具与效率'],'screenshots':[],
        'enabledPolicy':'default-off' if name in noAuto else 'default-on','requiresRestart':True,'requiresSetup':name in noAuto,
        'largeExternalResource':p['size']>40*1024*1024,'releaseId':rid,'metadata':p['metadata']}
    authorReadme=root/'author-materials'/p['filename'].removesuffix('.tgz')/'README.md'
    readme=authorReadme.read_text(encoding='utf8') if authorReadme.exists() else ''
    # Text-only author body; the renderer already handles unsafe HTML/links.
    intro=f'# {title}\n\n{description}\n\n## 版本与安装\n\n本条目使用作者正式发布的 **{version}**，不是 EAC 登记版本 {original[name].get("version") or "未知"} 的同字节替代品。安装前显示确切版本。\n\n'
    intro+=('暂不能在当前官方版安装：'+'；'.join(blockers) if blockers else '已取得原始发行包并核验摘要、元数据和加载文件；未逐项完成真实业务验证，需明确勾选尝试安装。官方安装器处理依赖及所需授权。')+'\n\n'
    if name in noAuto:intro+='默认安装后保持停用。阅读作者说明、完成所需设置后，在“我的插件”主动启用。\n\n'
    if name=='dsh-dafeiyu':intro+='包含约160 MiB的原生辅助程序和资源；当前从作者原始发布站获取，大文件尚未复制到 Gitee。\n\n'
    intro+=f'## 原作者与许可\n\n作者：{author}；许可：{p["license"]}。原始许可与署名保留在下载包中。\n\n[作者仓库]({sourceUrl}) · [作者原版下载]({p["registryTarball"]})\n\n## 作者使用说明\n\n'+readme[:30000]
    # Keep historical release/status objects unchanged, even when the browse row moves to a newer version.
    doc['plugins']=[x for x in doc['plugins'] if x['packageName']!=name]+[entry]
    doc['listings']=[x for x in doc.get('listings',[]) if x['packageName']!=name]
    doc['presentations']=[x for x in doc['presentations'] if x['id']!=old.get('presentationId')]
    doc['presentations'].append({'id':presentation,'revision':f'published-{sequence}','title':title,'summary':entry['summary'],'markdown':intro,'media':[],'sourceUrl':sourceUrl,'sourceCommit':source['commit']})
    known=next((r for r in doc['releases'] if r['releaseId']==rid),None)
    if known:
        if known!=release:raise ValueError('Refusing changed frozen release: '+name)
    else:
        doc['releases'].append(release)
        doc['releaseStatuses'].append({'releaseId':rid,'sequence':1,'status':'active','reason':'作者原包已核验；兼容性门禁独立保留','effectiveAt':now})
    sources=[]
    mirror=uploads.get(name)
    if mirror:
        if mirror['sha256']!=p['sha256'] or mirror['version']!=version:raise ValueError('Mirror mismatch: '+name)
        sources.append({'kind':'https-artifact','ref':'https://gitee.com/flowing-shadows-like-scenes/deep-seek-harness-unity-mirror/raw/'+mirror['commit']+'/'+mirror['path'],'size':p['size'],'priority':0})
    sources.append({'kind':'registry-tarball','ref':p['registryTarball'],'priority':len(sources),'size':p['size']})
    doc['deliveries']=[x for x in doc['deliveries'] if x['packageName']!=name]+[{'pluginId':pid,'packageName':name,'version':version,'artifactDigest':digest,'sources':sources}]
    recovered.append({'packageName':name,'version':version,'installability':entry['installability'],'blockers':blockers,'mirrored':bool(mirror),'artifactDigest':digest})
    for licensePath in p['licenseFiles']:
        notice=root/'author-materials'/p['filename'].removesuffix('.tgz')/licensePath
        if notice.exists():notes[name+'/'+licensePath]=notice.read_text(encoding='utf8',errors='replace')
out=Path(args.output);out.parent.mkdir(parents=True,exist_ok=True)
out.write_text(json.dumps(doc,ensure_ascii=False,indent=2)+'\n',encoding='utf8',newline='\n')
(root/'recovered-records.json').write_text(json.dumps(recovered,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
(root/'AUTHOR-NOTICES.json').write_text(json.dumps({'source':'Original author releases; each package retains its license','notices':notes},ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print(json.dumps({'recovered':len(recovered),'newInstallable':sum(r['installability']=='bundle-installable' for r in recovered),'mirrored':sum(r['mirrored'] for r in recovered),'sequence':sequence},ensure_ascii=True))
