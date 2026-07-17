# Item turn patch result

- patch: 1
- npm ci: 99
- build: 99
- unit: 99

## .patch.log
```text
Traceback (most recent call last):
  File "/home/runner/work/Yut/Yut/scripts/agent_item_turn_patch.py", line 557, in <module>
    replace_once(
  File "/home/runner/work/Yut/Yut/scripts/agent_item_turn_patch.py", line 22, in replace_once
    raise RuntimeError(f"pattern not found in {path}: {old[:120]!r}")
RuntimeError: pattern not found in src/app/App.tsx: '       pendingTrapPlacement: null,\n       rollLockUntil: 0,'
```
