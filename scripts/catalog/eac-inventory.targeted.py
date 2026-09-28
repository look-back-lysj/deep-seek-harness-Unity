"""Check derived payloads against the exact beta bytes without running any JS."""
import importlib.util
import json
from pathlib import Path
import re
import sys

spec = importlib.util.spec_from_file_location('inventory_builder', Path(__file__).with_name('eac-inventory.py'))
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)
root = Path(sys.argv[1] if len(sys.argv) > 1 else 'D:/eac-market-verify/distribution-20260928/inventory-v3')
ledger = json.loads((root / 'artifacts.json').read_bytes())['artifacts']
config = json.loads((root / 'sources/inventory-config.json').read_bytes())
checks = []
for name, expected_blob in config['derivedClients'].items():
    derived = next(a for a in ledger if a['packageName'] == name and a['kind'] == 'derived-built-repack')
    old = next(a for a in ledger if a['packageName'] == name and a['version'] == '1.1.0')
    files = builder.unpack((root / derived['path']).read_bytes())
    old_files = builder.unpack((root / old['path']).read_bytes())
    prefix = root / 'extracted/latest-beta' / derived['sourcePath']
    source = {p.relative_to(prefix).as_posix(): p.read_bytes() for p in prefix.rglob('*') if p.is_file()}
    assert builder.git_digest(source['lib/client.js']) == expected_blob
    assert files['lib/client.js'] != old_files['lib/client.js']
    assert set(files) == set(source) | {'UPSTREAM-PACKAGE.json', 'EAC-DERIVATION.json'}
    for path, data in source.items():
        if path not in ['package.json', 'lib/client.js']:
            assert files[path] == data, 'Changed executable or license: ' + path
    assert files['UPSTREAM-PACKAGE.json'] == source['package.json']
    metadata = json.loads(files['package.json'])
    upstream = json.loads(source['package.json'])
    assert metadata['name'] == upstream['name']
    assert metadata['version'] == '1.1.1-eac.dc22280.2'
    assert metadata['dsh']['skin']['version'] == metadata['version']
    # Independently locate the runtime identity and reverse precisely its value.
    # Equality against the Git-verified upstream client catches ANY other edit.
    client_bytes = files['lib/client.js']
    identity = list(re.finditer(rb'(?ms)^var SKIN_META = \{\r?\n(.*?)^\};', client_bytes))
    assert len(identity) == 1
    versions = list(re.finditer(rb'(?m)^  version: "([^"\r\n]+)",\r?$', identity[0].group(1)))
    assert len(versions) == 1
    registered_version = versions[0].group(1).decode('ascii')
    assert registered_version == metadata['version'] == derived['version']
    start, end = (identity[0].start(1) + position for position in versions[0].span(1))
    reverted = client_bytes[:start] + upstream['version'].encode('ascii') + client_bytes[end:]
    assert reverted == source['lib/client.js'], 'Runtime version must be the only changed client bytes'
    registration = list(re.finditer(rb'(?ms)ctx\.uiSkinLoader\.registerSkin\(\{\r?\n(.*?)^  \}\);', client_bytes))
    assert len(registration) == 1 and registration[0].group(1).startswith(b'    ...SKIN_META,')
    assert not re.search(rb'\bversion\s*:', registration[0].group(1))
    derivation = json.loads(files['EAC-DERIVATION.json'])
    patch = derivation['runtimeVersionPatch']
    assert patch['matches'] == 1 and patch['byteOffset'] == start
    assert patch['derivedSha256'] == builder.digest(client_bytes)
    assert patch['derivedGitBlob'] == builder.git_digest(client_bytes)
    assert patch['upstreamSha256'] == builder.digest(source['lib/client.js'])
    # Exactly these two metadata fields may differ; all upstream identity and
    # dependency/license fields remain intact and independently recoverable.
    metadata['version'] = upstream['version']
    metadata['dsh']['skin']['version'] = upstream['dsh']['skin']['version']
    assert metadata == upstream
    assert builder.pack(files) == (root / derived['path']).read_bytes(), 'Repack bytes must reproduce exactly'
    client = files['lib/client.js'].decode('utf-8')
    if name.endswith('miku'):
        assert 'const bodyStyleBefore' in client
        assert re.search(r'finally\s*\{\s*restoreBodyStyle\(\);', client)
        assert 'document.body.setAttribute("style", bodyStyleBefore)' in client
    else:
        script_creation = r'createElement\(\s*[\'"]script[\'"]\s*\)'
        assert re.search(script_creation, old_files['lib/client.js'].decode('utf-8'))
        assert not re.search(script_creation, client)
    # Regression: ambiguity, an unexpected old version and an overriding
    # registerSkin version must all fail closed, rather than broad replacement.
    upstream_client = source['lib/client.js']
    invalid = [upstream_client + b'\nvar SKIN_META = {};\n',
               upstream_client.replace(b'  version: "1.1.0",', b'  version: "9.9.9",', 1),
               upstream_client.replace(b'    ...SKIN_META,', b'    ...SKIN_META,\n    version: "9.9.9",', 1)]
    for candidate in invalid:
        try:
            builder.synchronize_skin_version(candidate, '1.1.0', derived['version'], upstream['dsh']['skin']['id'])
            raise AssertionError('Ambiguous or changed runtime context was accepted')
        except ValueError:
            pass
    checks.append({'packageName': name, 'version': derived['version'], 'upstreamClientGitBlob': expected_blob,
                   'derivedClientGitBlob': builder.git_digest(client_bytes), 'derivedClientSha256': builder.digest(client_bytes),
                   'actualRegisterSkinVersion': registered_version, 'reverseOnlyRuntimeVersionEqualsLatestBeta': True,
                   'allOtherFilesAndLicensesUnchanged': True, 'invalidPatchContextsRejected': 3, 'upstreamMetadataPreserved': True,
                   'deterministicRepack': True, 'specificKnownFixMarkers': 'pass', 'runtimeExecuted': False})
report = {'status': 'passed-targeted-static-checks', 'packages': checks,
          'limits': 'Static byte/structure/fix-marker checks only. No third-party code was imported or executed; no Desktop runtime claim.'}
# A harmless fixture verifies the cache cannot smuggle different bytes under
# an approved SHA. This only creates files inside this evidence batch.
cache = root / 'validation-fixtures/blob-cache'
data = b'EAC inventory local blob-cache test fixture; not plugin code.\n'
sha = builder.git_digest(data)
builder.save(cache / sha, data)
objects = builder.GitObjects(config['repository'], cache)
objects.preload([sha])
assert objects.cache[sha] == data
bad_cache = root / 'validation-fixtures/corrupt-blob-cache'
builder.save(bad_cache / sha, b'Wrong bytes; deliberately invalid test fixture.\n')
try:
    builder.GitObjects(config['repository'], bad_cache).preload([sha])
    raise AssertionError('A cached object with the wrong digest was accepted')
except ValueError as error:
    assert 'digest mismatch' in str(error)
report['blobCache'] = {'verifiedExactBytes': True, 'rejectedDifferentBytesAtSameSha': True,
                       'fixtureOnly': True, 'gitRepositoryWritten': False}
builder.save_json(root / 'targeted-validation.json', report)
print(json.dumps(report, ensure_ascii=False))
