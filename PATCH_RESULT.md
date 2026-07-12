# Item flow patch result

- patch: failed
- npm ci: 99
- unit: 99
- build: 99

## Patch error
```text
Traceback (most recent call last):
  File "/home/runner/work/Yut/Yut/scripts/apply-item-flow-fix.py", line 506, in <module>
    patch_reducer()
  File "/home/runner/work/Yut/Yut/scripts/apply-item-flow-fix.py", line 328, in patch_reducer
    replace_once(
  File "/home/runner/work/Yut/Yut/scripts/apply-item-flow-fix.py", line 21, in replace_once
    raise RuntimeError(f'{path}: expected one literal match, found {count}: {old[:100]!r}')
RuntimeError: src/features/room/services/roomAuthoritativeReducer.ts: expected one literal match, found 2: '      pendingGoldenYutSelection: null,\n'
```
