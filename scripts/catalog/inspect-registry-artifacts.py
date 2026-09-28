"""Inspect downloaded author archives without executing them or extracting links.

The registry's integrity and original metadata are evidence, not a runtime QA
claim. Reuse the untouched archives for mirrors; never silently insert a patch.
"""
from pathlib import Path, PurePosixPath
import argparse, base64, hashlib, io, json, re, tarfile

parser=argparse.ArgumentParser()
parser.add_argument('batch')
parser.add_argument('--official-source', default=None)
args=parser.parse_args()
root=Path(args.batch).resolve()
records=json.loads((root/'registry-discoveries.json').read_text(encoding='utf-8'))
output=[]
officialNames=set()
if args.official_source:
    for p in list((Path(args.official_source)/'packages').rglob('package.json')) + list((Path(args.official_source)/'vendor').rglob('package.json')):
        if 'node_modules' not in p.parts:
            try: officialNames.add(json.loads(p.read_text(encoding='utf8'))['name'])
            except (ValueError,KeyError): pass
for record in records:
    if record['status']!=200: continue
    filename=record['packageName'].lstrip('@').replace('/','-')+'-'+record['version']+'.tgz'
    path=root/'author-artifacts'/filename
    result={'packageName':record['packageName'],'version':record['version'],'filename':filename}
    if not path.is_file() or path.with_suffix(path.suffix+'.aria2').exists():
        result['status']='download-pending';output.append(result);continue
    data=path.read_bytes()
    try:
        algorithm, expected=record['dist']['integrity'].split('-',1)
        if algorithm not in ['sha512','sha256']: raise ValueError('Unsupported registry integrity')
        if base64.b64encode(hashlib.new(algorithm,data).digest()).decode()!=expected: raise ValueError('Registry integrity mismatch')
        if hashlib.sha1(data).hexdigest()!=record['dist']['shasum']: raise ValueError('Registry sha1 mismatch')
        files={};seen=set();expanded=0
        with tarfile.open(fileobj=io.BytesIO(data),mode='r:gz') as tar:
            for member in tar:
                name=PurePosixPath(member.name)
                if name.is_absolute() or '..' in name.parts or not name.parts or name.parts[0]!='package' or member.issym() or member.islnk(): raise ValueError('Unsafe archive member')
                if member.isdir(): continue
                if not member.isfile(): raise ValueError('Unsupported archive member')
                relative='/'.join(name.parts[1:])
                if relative.lower() in seen: raise ValueError('Case collision')
                seen.add(relative.lower());expanded+=member.size
                if len(seen)>20000 or expanded>500*1024*1024: raise ValueError('Archive exceeds limit')
                files[relative]=tar.extractfile(member).read()
        raw=files['package.json'];package=json.loads(raw)
        if package.get('name')!=record['packageName'] or package.get('version')!=record['version']: raise ValueError('Package identity mismatch')
        patch=package.get('dsh',{}).get('bundle',{}).get('patch')
        patchPaths=patch if isinstance(patch,list) else [patch] if patch else []
        bundle=bool(patchPaths) and all(p.removeprefix('./') in files for p in patchPaths)
        licenses=[p for p in files if re.search(r'(^|/)(license|licence|notice|copying|third.party|asset.license)',p,re.I)]
        # Full notices and README accompany each original archive, never a new blanket license.
        evidence=root/'author-materials'/filename.removesuffix('.tgz');evidence.mkdir(parents=True,exist_ok=True)
        (evidence/'package.json').write_bytes(raw)
        for p in licenses + [p for p in files if p.lower() in ('readme.md','readme')]+[p.removeprefix('./') for p in patchPaths if p.removeprefix('./') in files]:
            target=evidence/p;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(files[p])
        references=[]
        imports=set()
        for p,b in files.items():
            if p.endswith(('.js','.mjs','.cjs')) and not p.endswith('.map'):
                t=b.decode('utf-8','replace')
                refs=sorted(set(re.findall(r'window\.dshDesktop|DSH_DESKTOP_PROFILE|DSH_EAC_BRIDGE_URL|\bweb-desktop\b',t)))
                if refs:references.append({'file':p,'references':refs})
                if not p.startswith(('test/','tests/','scripts/','node_modules/')):
                    imports.update(re.findall(r'(?:from\s*|require\s*\(\s*|import\s*\(\s*)[\"\'](@deepseek-ai/[^\"\']+)',t))
        declared=package.get('dsh',{}).get('client',{}).get('inject',[])
        packageOf=lambda s: '/'.join(s.split('/')[:2])
        missing=sorted({packageOf(s) for s in list(imports)+declared if isinstance(s,str) and s.startswith('@deepseek-ai/') and packageOf(s) not in officialNames}) if officialNames else []
        result.update(status='inspected',size=len(data),sha256=hashlib.sha256(data).hexdigest(),
            metadataDigest='sha256:'+hashlib.sha256(raw).hexdigest(),metadata={'kind':'official-bundle','packageJson':{'contentBase64':base64.b64encode(raw).decode(),'sha256':'sha256:'+hashlib.sha256(raw).hexdigest()},'files':sorted(files)},
            license=package.get('license'),licenseFiles=licenses,bundle=bundle,patch=patch,
            patchContent={p:files[p.removeprefix('./')].decode('utf8','replace') for p in patchPaths if p.removeprefix('./') in files},
            bridgeReferences=references,dependencies=package.get('dependencies',{}),peerDependencies=package.get('peerDependencies',{}),
            engines=package.get('engines',{}),packageScripts=package.get('scripts',{}),author=package.get('author'),description=package.get('description'),repository=package.get('repository'),
            requiredEntryFiles={k:v for k,v in package.get('exports',{}).items() if k in ('.','./client','./typert','./client/typert')},
            registryIntegrity=record['dist']['integrity'],registryTarball=record['dist']['tarball'],
            officialImports=sorted(imports),missingOfficialPackages=missing)
    except Exception as error:result.update(status='rejected',reason=str(error))
    output.append(result)
(root/'author-inspection.json').write_text(json.dumps(output,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps([{k:r.get(k) for k in ['packageName','status','bundle','licenseFiles','size','bridgeReferences','reason']} for r in output],ensure_ascii=True))
